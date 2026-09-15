-- ---------------------------------------------------------------------------
-- 0129 — owner changes from bulk assignment and member handover leave history
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  TWO PATHS CHANGED OWNERSHIP WITHOUT RECORDING IT.                        ║
-- ║                                                                           ║
-- ║  Assigning ONE contact goes through crm_assign_contact_owner (0123): the  ║
-- ║  owner change and its OWNER_ASSIGNED activity commit together. But        ║
-- ║                                                                           ║
-- ║    - bulk assignment ran `update crm_contacts set owner_user_id`, and     ║
-- ║    - removing a member ran four separate updates (contacts, companies,    ║
-- ║      deals, open tasks)                                                   ║
-- ║                                                                           ║
-- ║  so a contact's timeline never showed it changing hands, reports that     ║
-- ║  count assignments missed every bulk one, "on assigned" flows never       ║
-- ║  fired, and a handover that failed half way left a book split between     ║
-- ║  two people with no record of which half moved.                           ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ CONTACTS GO THROUGH crm_assign_contact_owner ITSELF, row by row, in a
-- stable order. The lock, the no-op for "already theirs" and the activity's
-- shape stay defined in one place; a set-based copy here would drift from it.
--
-- ⚠️ TASKS WRITE TASK_REASSIGNED (0126's type and shape). Companies and deals
-- have NO owner-change activity type anywhere in this schema — assigning a
-- single one records nothing either — so the handover moves them in the same
-- transaction but cannot give them history. That is a separate decision.
--
-- ⚠️ NO `select` WITH A STAR AND NO DOUBLE-PIPE: pasted by hand.
--
-- ⚠️ VALIDATE BEFORE APPLYING:
--   scripts/check-migration.sh supabase/migrations/0129_crm_owner_change_history.sql \
--     supabase/migrations/smoke/0129_crm_owner_change_history.smoke.sql
--
-- ⚠️ APPLY THIS BEFORE MERGING THE CODE THAT CALLS IT.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Bulk assignment
-- ---------------------------------------------------------------------------
create or replace function public.crm_bulk_assign_contacts(
  p_workspace_id uuid,
  p_contact_ids  uuid[],
  p_new_owner    uuid,
  p_actor_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_requested  integer;
  v_id         uuid;
  v_result     jsonb;
  v_changed    integer := 0;
  v_unchanged  integer := 0;
  v_found      integer := 0;
  v_items      jsonb[] := '{}';
begin
  select count(distinct x) into v_requested
    from unnest(coalesce(p_contact_ids, '{}'::uuid[])) as x
   where x is not null;

  /*
   * ⚠️ BOUNDED HERE TOO. The action refuses more than 200 ids, but this is a
   * security definer function; an unbounded call is one statement that rewrites
   * a workspace's whole book.
   */
  if v_requested > 200 then
    raise exception 'crm_bulk_assign_contacts: at most 200 contacts at a time'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * ⚠️ THE NEW OWNER MUST BE A MEMBER. The id comes from a form, and a contact
   * owned by an outsider is owned legitimately by someone this workspace cannot
   * see. NULL means unassign, and is allowed.
   */
  if p_new_owner is not null and not exists (
    select 1 from public.workspace_memberships
     where workspace_id = p_workspace_id
       and user_id = p_new_owner
  ) then
    raise exception 'crm_bulk_assign_contacts: new owner is not a member of this workspace'
      using errcode = 'check_violation';
  end if;

  /*
   * Only this workspace's live contacts. An id from another workspace, or a
   * deleted contact, is counted as skipped rather than raising — one stale row
   * in a selection must not refuse the other 199. Ordered by id so two
   * overlapping bulk assignments lock rows in the same order and cannot
   * deadlock.
   */
  for v_id in
    select c.id
      from public.crm_contacts c
     where c.workspace_id = p_workspace_id
       and c.deleted_at is null
       and c.id = any (p_contact_ids)
     order by c.id
  loop
    v_found := v_found + 1;
    v_result := public.crm_assign_contact_owner(p_workspace_id, v_id, p_new_owner, p_actor_id);

    if coalesce((v_result ->> 'changed')::boolean, false) then
      v_changed := v_changed + 1;
      v_items := array_append(v_items, jsonb_build_object(
        'contact_id', v_id,
        'from', v_result -> 'from',
        'activity_id', v_result ->> 'activity_id'
      ));
    else
      v_unchanged := v_unchanged + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'changed', v_changed,
    'unchanged', v_unchanged,
    'skipped', v_requested - v_found,
    'assignments', to_jsonb(v_items)
  );
end;
$$;

comment on function public.crm_bulk_assign_contacts(uuid, uuid[], uuid, uuid) is
  'Assigns up to 200 of a workspace''s live contacts through crm_assign_contact_owner, so each change writes OWNER_ASSIGNED. Returns {changed, unchanged, skipped, assignments}.';

-- ---------------------------------------------------------------------------
-- Member handover
-- ---------------------------------------------------------------------------
create or replace function public.crm_handover_member_records(
  p_workspace_id uuid,
  p_from_user    uuid,
  p_to_user      uuid,
  p_actor_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task        record;
  v_contact_id  uuid;
  v_owner       uuid;
  v_result      jsonb;
  v_contacts    integer := 0;
  v_deleted     integer := 0;
  v_companies   integer := 0;
  v_deals       integer := 0;
  v_tasks       integer := 0;
  v_items       jsonb[] := '{}';
begin
  if p_from_user is null then
    raise exception 'crm_handover_member_records: a departing member is required'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_to_user is not null and not exists (
    select 1 from public.workspace_memberships
     where workspace_id = p_workspace_id
       and user_id = p_to_user
  ) then
    raise exception 'crm_handover_member_records: the new owner is not in this workspace'
      using errcode = 'check_violation';
  end if;

  -- Handing a book to the person it already belongs to changes nothing.
  if p_to_user is not distinct from p_from_user then
    return jsonb_build_object(
      'contacts', 0, 'companies', 0, 'opportunities', 0, 'tasks', 0,
      'assignments', '[]'::jsonb
    );
  end if;

  /*
   * ⚠️ TASKS FIRST, so each TASK_REASSIGNED records the contact's owner as it
   * was when the handover began — the departing member — not the successor the
   * contact is about to move to.
   *
   * ⚠️ OPEN TASKS ONLY. A completed task records who completed it; moving it
   * would credit the successor with finished work.
   */
  for v_task in
    select t.id, t.contact_id, t.company_id, t.opportunity_id, t.title, t.deleted_at
      from public.crm_tasks t
     where t.workspace_id = p_workspace_id
       and t.assigned_to_user_id = p_from_user
       and t.status = 'open'
     order by t.id
       for update
  loop
    v_owner := null;
    if v_task.contact_id is not null then
      select owner_user_id into v_owner
        from public.crm_contacts
       where id = v_task.contact_id
         and workspace_id = p_workspace_id;
    end if;

    -- The snooze was the previous assignee's own choice; see 0126.
    update public.crm_tasks
       set assigned_to_user_id = p_to_user,
           snoozed_until       = null
     where id = v_task.id
       and workspace_id = p_workspace_id;

    v_tasks := v_tasks + 1;

    -- A deleted task moves, so it points at no departed member, but has no timeline to write to.
    if v_task.deleted_at is null then
      insert into public.crm_activities (
        workspace_id, contact_id, company_id, activity_type, channel,
        actor_user_id, owner_user_id_at_event, refs, metadata
      )
      values (
        p_workspace_id, v_task.contact_id, v_task.company_id, 'TASK_REASSIGNED', 'system',
        p_actor_id, v_owner,
        jsonb_strip_nulls(jsonb_build_object('task_id', v_task.id, 'opportunity_id', v_task.opportunity_id)),
        jsonb_build_object(
          'title', v_task.title,
          'from', p_from_user,
          'to', p_to_user,
          'reason', 'member_handover'
        )
      );
    end if;
  end loop;

  -- Live contacts, one at a time through the function that writes their history.
  for v_contact_id in
    select c.id
      from public.crm_contacts c
     where c.workspace_id = p_workspace_id
       and c.owner_user_id = p_from_user
       and c.deleted_at is null
     order by c.id
  loop
    v_result := public.crm_assign_contact_owner(p_workspace_id, v_contact_id, p_to_user, p_actor_id);
    if coalesce((v_result ->> 'changed')::boolean, false) then
      v_contacts := v_contacts + 1;
      v_items := array_append(v_items, jsonb_build_object(
        'contact_id', v_contact_id,
        'activity_id', v_result ->> 'activity_id'
      ));
    end if;
  end loop;

  /*
   * Deleted contacts still move, so a restored one never belongs to someone who
   * left, but crm_assign_contact_owner refuses deleted rows and a deleted
   * contact shows no timeline.
   */
  with moved as (
    update public.crm_contacts
       set owner_user_id = p_to_user
     where workspace_id = p_workspace_id
       and owner_user_id = p_from_user
       and deleted_at is not null
    returning id
  )
  select count(id) into v_deleted from moved;

  -- No owner-change activity type exists for these; see the header.
  with moved as (
    update public.crm_companies
       set owner_user_id = p_to_user
     where workspace_id = p_workspace_id
       and owner_user_id = p_from_user
    returning id
  )
  select count(id) into v_companies from moved;

  with moved as (
    update public.crm_opportunities
       set owner_user_id = p_to_user
     where workspace_id = p_workspace_id
       and owner_user_id = p_from_user
    returning id
  )
  select count(id) into v_deals from moved;

  return jsonb_build_object(
    'contacts', v_contacts + v_deleted,
    'companies', v_companies,
    'opportunities', v_deals,
    'tasks', v_tasks,
    'assignments', to_jsonb(v_items)
  );
end;
$$;

comment on function public.crm_handover_member_records(uuid, uuid, uuid, uuid) is
  'Moves everything a member owns to another member or to nobody, in one transaction. Contacts write OWNER_ASSIGNED and open tasks write TASK_REASSIGNED. Returns counts and the new contact assignments.';

/*
 * ⚠️ SERVICE ROLE ONLY. Both are security definer and trust their caller's
 * permission check: `crm.contact.assign` for bulk assignment, and
 * `workspace.member.manage` for removing a member.
 */
revoke all on function public.crm_bulk_assign_contacts(uuid, uuid[], uuid, uuid) from public;
revoke all on function public.crm_bulk_assign_contacts(uuid, uuid[], uuid, uuid) from anon;
revoke all on function public.crm_bulk_assign_contacts(uuid, uuid[], uuid, uuid) from authenticated;
grant execute on function public.crm_bulk_assign_contacts(uuid, uuid[], uuid, uuid) to service_role;

revoke all on function public.crm_handover_member_records(uuid, uuid, uuid, uuid) from public;
revoke all on function public.crm_handover_member_records(uuid, uuid, uuid, uuid) from anon;
revoke all on function public.crm_handover_member_records(uuid, uuid, uuid, uuid) from authenticated;
grant execute on function public.crm_handover_member_records(uuid, uuid, uuid, uuid) to service_role;
