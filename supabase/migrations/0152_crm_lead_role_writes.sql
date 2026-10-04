-- ---------------------------------------------------------------------------
-- 0152 — Account workspace, build step 4: writing a lead's roles
--
-- Two writers over 0148's tables, each one transaction:
--
--   crm_apply_auto_roles(workspace, rows)      the classifier's suggestions, in
--                                              BATCHES (an ingest is hundreds of
--                                              leads; one round trip each would
--                                              be hundreds of round trips).
--   crm_set_contact_roles(workspace, contact,  a PERSON's choice. Pins the lead:
--                         roles, actor)        suggestions never touch it again.
--                                              NULL roles = "back to automatic".
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  THE MANUAL CHECK IS INSIDE THE LOCK.                                     ║
-- ║                                                                           ║
-- ║  "Skip leads someone edited" checked in TypeScript and then written in a  ║
-- ║  second call is a race: a person saves their choice between the check    ║
-- ║  and the write, and the classifier overwrites it a moment later. Here the ║
-- ║  state row is locked first, `manual_at` is read under that lock, and the  ║
-- ║  manual writer takes the same lock — so one of them always waits.        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ VALIDATE BEFORE APPLYING:
--   scripts/check-migration.sh supabase/migrations/0152_crm_lead_role_writes.sql \
--     supabase/migrations/smoke/0152_crm_lead_role_writes.smoke.sql
--
-- ⚠️ APPLY THIS BEFORE MERGING THE CODE THAT CALLS IT. Functions only; every
-- statement is `create or replace` or a grant, so applying it twice is harmless.
--
-- ROLLBACK (functions only; no data):
--   drop function if exists public.crm_set_contact_roles(uuid, uuid, uuid[], uuid);
--   drop function if exists public.crm_apply_auto_roles(uuid, jsonb);
-- ---------------------------------------------------------------------------

/*
 * Locks (creating if needed) a lead's role-state row and returns its manual
 * flag. Both writers call this first, which is what serialises them.
 */
create or replace function public.crm_lock_contact_role_state(p_workspace_id uuid, p_contact_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_manual timestamptz;
begin
  insert into public.crm_contact_role_state (workspace_id, contact_id)
  values (p_workspace_id, p_contact_id)
  on conflict (contact_id) do nothing;

  select manual_at into v_manual
    from public.crm_contact_role_state
   where contact_id = p_contact_id
     and workspace_id = p_workspace_id
   for update;

  if not found then
    -- The row exists but for another workspace: the contact id is not ours.
    raise exception 'crm_lock_contact_role_state: no such lead in workspace %', p_workspace_id
      using errcode = 'no_data_found';
  end if;

  return v_manual;
end;
$$;

-- ---------------------------------------------------------------------------
-- crm_apply_auto_roles
--
-- p_rows: [{ "contact_id": uuid, "title": text|null, "role_ids": [uuid, ...] }]
-- Returns { applied, skipped_manual, missing }.
-- ---------------------------------------------------------------------------

create or replace function public.crm_apply_auto_roles(p_workspace_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row      jsonb;
  v_contact  uuid;
  v_roles    uuid[];
  v_manual   timestamptz;
  v_applied  integer := 0;
  v_skipped  integer := 0;
  v_missing  integer := 0;
begin
  /*
   * ⚠️ IN CONTACT-ID ORDER, ALWAYS. Every row's state lock is held until the
   * batch commits; two batches that lock overlapping leads in different orders
   * deadlock (an import racing "Refresh suggestions", or two imports). One
   * global order makes that impossible.
   */
  for v_row in
    select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
     order by value ->> 'contact_id'
  loop
    v_contact := (v_row ->> 'contact_id')::uuid;

    -- A lead deleted (or never ours) since the caller read it is skipped, not an error.
    if not exists (
      select 1 from public.crm_contacts
       where id = v_contact and workspace_id = p_workspace_id and deleted_at is null
    ) then
      v_missing := v_missing + 1;
      continue;
    end if;

    v_manual := public.crm_lock_contact_role_state(p_workspace_id, v_contact);
    if v_manual is not null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_roles := array(
      select distinct r.id
        from jsonb_array_elements_text(coalesce(v_row -> 'role_ids', '[]'::jsonb)) x
        join public.crm_lead_roles r
          on r.id = x::uuid and r.workspace_id = p_workspace_id and r.is_active
    );

    -- Automatic rows only. A manual lead was skipped above, so every row here
    -- is the classifier's own.
    delete from public.crm_contact_role_assignments
     where contact_id = v_contact
       and workspace_id = p_workspace_id
       and not role_id = any (v_roles);

    insert into public.crm_contact_role_assignments (workspace_id, contact_id, role_id, is_auto)
    select p_workspace_id, v_contact, x, true from unnest(v_roles) x
    on conflict (contact_id, role_id) do nothing;

    update public.crm_contact_role_state
       set auto_title = nullif(trim(v_row ->> 'title'), ''),
           auto_classified_at = now()
     where contact_id = v_contact;

    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object('applied', v_applied, 'skipped_manual', v_skipped, 'missing', v_missing);
end;
$$;

-- ---------------------------------------------------------------------------
-- crm_set_contact_roles
--
-- p_role_ids NOT NULL: these roles exactly, all marked manual; the lead is
--   pinned. A disabled role already on the lead may stay; one cannot be added.
-- p_role_ids NULL: unpin — every role row goes and the lead is automatic
--   again; the caller re-runs the classifier for it.
-- ---------------------------------------------------------------------------

create or replace function public.crm_set_contact_roles(
  p_workspace_id uuid,
  p_contact_id   uuid,
  p_role_ids     uuid[],
  p_actor_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wanted uuid[];
begin
  if not exists (
    select 1 from public.crm_contacts
     where id = p_contact_id and workspace_id = p_workspace_id and deleted_at is null
  ) then
    raise exception 'crm_set_contact_roles: no such lead in workspace %', p_workspace_id
      using errcode = 'no_data_found';
  end if;

  perform public.crm_lock_contact_role_state(p_workspace_id, p_contact_id);

  if p_role_ids is null then
    delete from public.crm_contact_role_assignments
     where contact_id = p_contact_id and workspace_id = p_workspace_id;
    update public.crm_contact_role_state
       set manual_at = null, manual_by = null, auto_title = null, auto_classified_at = null
     where contact_id = p_contact_id;
    return jsonb_build_object('manual', false);
  end if;

  v_wanted := array(select distinct x from unnest(p_role_ids) x where x is not null);

  if exists (
    select 1 from unnest(v_wanted) x
     where not exists (
       select 1 from public.crm_contact_role_assignments a
        where a.contact_id = p_contact_id and a.role_id = x
     )
       and not exists (
       select 1 from public.crm_lead_roles r
        where r.id = x and r.workspace_id = p_workspace_id and r.is_active
     )
  ) then
    raise exception 'crm_set_contact_roles: a role is unknown or disabled in this workspace'
      using errcode = 'check_violation';
  end if;

  delete from public.crm_contact_role_assignments
   where contact_id = p_contact_id
     and workspace_id = p_workspace_id
     and not role_id = any (v_wanted);

  update public.crm_contact_role_assignments
     set is_auto = false
   where contact_id = p_contact_id and workspace_id = p_workspace_id;

  insert into public.crm_contact_role_assignments (workspace_id, contact_id, role_id, is_auto, created_by)
  select p_workspace_id, p_contact_id, x, false, p_actor_id from unnest(v_wanted) x
  on conflict (contact_id, role_id) do nothing;

  update public.crm_contact_role_state
     set manual_at = now(), manual_by = p_actor_id
   where contact_id = p_contact_id;

  return jsonb_build_object('manual', true, 'roles', to_jsonb(v_wanted));
end;
$$;

/*
 * ⚠️ SERVICE ROLE ONLY. These trust their caller's `crm.contact.edit` and
 * contact-visibility check (lib/crm/lead-role-service.ts).
 */
revoke all on function public.crm_lock_contact_role_state(uuid, uuid) from public, anon, authenticated;
revoke all on function public.crm_apply_auto_roles(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.crm_apply_auto_roles(uuid, jsonb) to service_role;
revoke all on function public.crm_set_contact_roles(uuid, uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.crm_set_contact_roles(uuid, uuid, uuid[], uuid) to service_role;

comment on function public.crm_apply_auto_roles(uuid, jsonb) is
  'Writes classifier role suggestions for many leads in one transaction. Never touches a lead with manual_at set; that check is made under the state-row lock.';
comment on function public.crm_set_contact_roles(uuid, uuid, uuid[], uuid) is
  'A person''s role choice for one lead (pins it), or NULL to return it to automatic.';
