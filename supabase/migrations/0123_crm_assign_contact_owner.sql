-- ---------------------------------------------------------------------------
-- 0123 — crm_assign_contact_owner
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  AN OWNERSHIP CHANGE AND ITS AUDIT ROW WERE TWO STATEMENTS, AND THE       ║
-- ║  AUDIT ROW WENT FIRST.                                                    ║
-- ║                                                                           ║
-- ║  `lib/crm/activities.ts` assignContact did:                               ║
-- ║                                                                           ║
-- ║      1. select owner_user_id                                              ║
-- ║      2. insert OWNER_ASSIGNED into crm_activities   <- committed          ║
-- ║      3. update crm_contacts.owner_user_id           <- may fail           ║
-- ║                                                                           ║
-- ║  When 3 failed, 2 had already committed. `crm_activities` is append-only  ║
-- ║  (0075's crm_guard_append_only refuses UPDATE and DELETE), so the false   ║
-- ║  row CANNOT be deleted or corrected. The timeline permanently asserts a   ║
-- ║  handover that never happened, the contact still belongs to the old       ║
-- ║  owner, and reporting credits work to somebody who never received it.     ║
-- ║                                                                           ║
-- ║  ⚠️ REORDERING WOULD NOT HAVE FIXED IT. Update-then-insert trades a false ║
-- ║  audit row for a missing one. Both are wrong; only one statement pair can ║
-- ║  be right, and that requires a transaction.                               ║
-- ║                                                                           ║
-- ║  ⚠️ THERE WAS A SECOND DEFECT IN THE SAME FUNCTION. The read at 1 and the ║
-- ║  update at 3 were separate, so a concurrent reassignment between them     ║
-- ║  made the recorded `from` wrong AND was silently overwritten. `for        ║
-- ║  update` below closes that too — the same lost-update guard               ║
-- ║  crm_move_opportunity_stage takes.                                        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- Modelled on `crm_move_opportunity_stage` (0076), which is this repository's
-- reference for "domain change and its history row commit together".
--
-- ⚠️ VALIDATE BEFORE APPLYING. A plpgsql body is not name-resolved at creation
-- time; 0072 shipped an ambiguous one that created cleanly and failed on first
-- call. Run:
--
--   scripts/check-migration.sh supabase/migrations/0123_crm_assign_contact_owner.sql \
--     supabase/migrations/smoke/0123_crm_assign_contact_owner.smoke.sql
--
-- ⚠️ APPLY THIS BEFORE MERGING THE CODE THAT CALLS IT. Until the function
-- exists, a caller would fail on every assignment.
-- ---------------------------------------------------------------------------

create or replace function public.crm_assign_contact_owner(
  p_workspace_id uuid,
  p_contact_id   uuid,
  p_new_owner    uuid,
  p_actor_id     uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contact     public.crm_contacts%rowtype;
  v_activity_id uuid;
begin
  /*
   * `for update` holds the row for the rest of the transaction, so the owner
   * read below and the update at the end cannot straddle somebody else's
   * reassignment.
   */
  select * into v_contact
    from public.crm_contacts
   where id = p_contact_id
     and workspace_id = p_workspace_id
   for update;

  if v_contact.id is null then
    raise exception 'crm_assign_contact_owner: no such contact in workspace %',
      p_workspace_id using errcode = 'no_data_found';
  end if;

  if v_contact.deleted_at is not null then
    raise exception 'crm_assign_contact_owner: contact % is deleted', p_contact_id
      using errcode = 'check_violation';
  end if;

  /*
   * ⚠️ `is not distinct from`, NOT `=`. NULL is a legitimate owner — that is
   * what unassigned means — and `null = null` is null, so `=` would treat
   * "already unassigned" as a change and write an activity saying nothing
   * happened. Matches the caller's own `===` check, which this replaces.
   */
  if v_contact.owner_user_id is not distinct from p_new_owner then
    return jsonb_build_object('changed', false, 'activity_id', null, 'from', v_contact.owner_user_id);
  end if;

  /*
   * The audit row and the update, in that order, inside one transaction. The
   * order no longer matters for correctness — either both land or neither
   * does — but the insert stays first so `owner_user_id_at_event` is read from
   * the locked row rather than from the value we are about to write.
   */
  insert into public.crm_activities (
    workspace_id,
    contact_id,
    activity_type,
    channel,
    actor_user_id,
    owner_user_id_at_event,
    metadata
  )
  values (
    p_workspace_id,
    p_contact_id,
    'OWNER_ASSIGNED',
    'system',
    p_actor_id,
    v_contact.owner_user_id,
    jsonb_build_object('from', v_contact.owner_user_id, 'to', p_new_owner)
  )
  returning id into v_activity_id;

  update public.crm_contacts
     set owner_user_id = p_new_owner
   where id = p_contact_id
     and workspace_id = p_workspace_id;

  return jsonb_build_object(
    'changed', true,
    'activity_id', v_activity_id,
    'from', v_contact.owner_user_id
  );
end;
$$;

comment on function public.crm_assign_contact_owner(uuid, uuid, uuid, uuid) is
  'Reassigns a contact and writes its OWNER_ASSIGNED activity in one transaction. '
  'Returns {changed, activity_id, from}. `changed` is false when the owner is '
  'already the requested one, and no activity is written in that case.';

/*
 * ⚠️ SERVICE ROLE ONLY. The function is `security definer` and does not check
 * the caller's permission — `lib/crm/contact-actions.ts` gates on
 * `crm.contact.assign` before it gets here, exactly as it does for
 * crm_move_opportunity_stage. Granting this to `authenticated` would let any
 * signed-in user reassign any contact in a workspace they can reach.
 */
revoke all on function public.crm_assign_contact_owner(uuid, uuid, uuid, uuid) from public;
revoke all on function public.crm_assign_contact_owner(uuid, uuid, uuid, uuid) from anon;
revoke all on function public.crm_assign_contact_owner(uuid, uuid, uuid, uuid) from authenticated;
grant execute on function public.crm_assign_contact_owner(uuid, uuid, uuid, uuid) to service_role;
