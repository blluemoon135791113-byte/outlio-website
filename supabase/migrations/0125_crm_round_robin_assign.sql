-- ---------------------------------------------------------------------------
-- 0125 — crm_round_robin_assign
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ROUND ROBIN WAS A READ, A DECISION AND A WRITE, WITH NOTHING HELD        ║
-- ║  BETWEEN THEM.                                                            ║
-- ║                                                                           ║
-- ║  `lib/flows/actions/crm.ts` roundRobin did:                               ║
-- ║                                                                           ║
-- ║      1. count open contacts for every candidate   (N separate queries)    ║
-- ║      2. pick the least loaded                                             ║
-- ║      3. update crm_contacts.owner_user_id                                 ║
-- ║                                                                           ║
-- ║  Two flow runs that start together both finish step 1 before either       ║
-- ║  reaches step 3. They see identical totals, pick the same person, and     ║
-- ║  both assign to them. The least-loaded member receives the whole batch —  ║
-- ║  the exact opposite of what round robin is for.                           ║
-- ║                                                                           ║
-- ║  ⚠️ IT NEVER ERRORS. Both updates succeed, both runs report ok, both write ║
-- ║  a truthful OWNER_ASSIGNED activity. No failed job, no exception, no      ║
-- ║  alert — only a distribution that is quietly unfair, which a team         ║
-- ║  notices weeks later as "why does everything go to Sam".                  ║
-- ║                                                                           ║
-- ║  ⚠️ BURSTS ARE THE NORMAL CASE. Intake runs on imports, list adds and     ║
-- ║  form submissions — the three moments leads arrive in bulk. The window    ║
-- ║  is widest precisely when it matters most.                                ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ AN ADVISORY LOCK, NOT A ROW LOCK, AND THAT DISTINCTION IS THE FIX.
--
-- `for update` on the contact is what 0123 takes, and it is useless here: two
-- concurrent runs assign DIFFERENT contacts, so they lock different rows, never
-- block each other, and both still count stale totals. The contention is not
-- over a row. It is over the DISTRIBUTION, which is a workspace-level
-- invariant, so the lock has to be taken on the workspace.
--
-- `pg_advisory_xact_lock` releases at transaction end with no unlock call and
-- no leak on error, which `pg_advisory_lock` cannot promise.
--
-- ⚠️ THE AUDITED WRITE IS NOT REIMPLEMENTED HERE. This calls
-- `crm_assign_contact_owner` (0123), which already holds the row, writes the
-- OWNER_ASSIGNED activity and updates the owner in one transaction. Copying
-- that logic would give the two paths a chance to drift, and the append-only
-- guard makes a wrong audit row permanently uncorrectable.
--
-- ⚠️ VALIDATE BEFORE APPLYING. A plpgsql body is not name-resolved at creation
-- time; 0072 shipped an ambiguous one that created cleanly and failed on first
-- call. Run:
--
--   node scripts/rehearse-migration.mjs \
--     supabase/migrations/0125_crm_round_robin_assign.sql \
--     supabase/migrations/smoke/0125_crm_round_robin_assign.smoke.sql
--
-- ⚠️ APPLY THIS BEFORE MERGING THE CODE THAT CALLS IT. Until the function
-- exists, every round-robin step fails.
-- ---------------------------------------------------------------------------

create or replace function public.crm_round_robin_assign(
  p_workspace_id uuid,
  p_contact_id   uuid,
  p_user_ids     uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_chosen uuid;
  v_result jsonb;
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    raise exception 'crm_round_robin_assign: empty candidate pool'
      using errcode = 'invalid_parameter_value';
  end if;

  /*
   * ⚠️ TAKEN BEFORE THE COUNT, NOT AFTER. The whole point is that the count,
   * the decision and the write happen with nobody else deciding in between.
   * Acquiring it after counting would serialise the writes and still let both
   * runs choose the same person, which is the bug rather than the fix.
   *
   * `hashtextextended` narrows the workspace uuid to the bigint the advisory
   * lock space uses. Two different workspaces CAN collide and briefly
   * serialise against each other; that costs a little throughput on a rare
   * operation and costs correctness nothing.
   */
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0));

  /*
   * Least loaded wins; ties break on the pool's own order, so the result is
   * deterministic rather than dependent on how the planner happened to group.
   * That matches the behaviour the TypeScript had, which people may already be
   * relying on.
   *
   * ⚠️ `left join`, NOT `join`. Somebody with zero contacts is the person this
   * should pick most eagerly, and an inner join drops them from the candidate
   * list entirely — so a brand new joiner would never receive a lead.
   */
  select pool.user_id
    into v_chosen
    from unnest(p_user_ids) with ordinality as pool(user_id, ord)
    left join public.crm_contacts owned
      on owned.workspace_id  = p_workspace_id
     and owned.owner_user_id = pool.user_id
     and owned.deleted_at is null
   group by pool.user_id, pool.ord
   order by count(owned.id), pool.ord
   limit 1;

  if v_chosen is null then
    raise exception 'crm_round_robin_assign: no candidate could be chosen'
      using errcode = 'no_data_found';
  end if;

  /*
   * 0123 holds the contact row, verifies the workspace, refuses a deleted
   * contact, writes the activity and updates the owner — all inside THIS
   * transaction, so the advisory lock above still covers it.
   */
  v_result := public.crm_assign_contact_owner(
    p_workspace_id,
    p_contact_id,
    v_chosen,
    null
  );

  return v_result || jsonb_build_object('assigned_to', v_chosen);
end;
$$;

comment on function public.crm_round_robin_assign(uuid, uuid, uuid[]) is
  'Least-loaded assignment, serialised per workspace by an advisory lock so '
  'concurrent intake runs cannot all choose the same person. Delegates the '
  'audited write to crm_assign_contact_owner (0123).';

/*
 * ⚠️ SERVICE ROLE ONLY, for the same reason 0123 is. This is `security
 * definer` and does not check the caller's permission — the flow engine runs
 * under the service role and the step's config was gated at publish time.
 * Granting it to `authenticated` would let any signed-in user reassign any
 * contact in a workspace they can reach, and pick the recipient.
 */
revoke all on function public.crm_round_robin_assign(uuid, uuid, uuid[]) from public;
revoke all on function public.crm_round_robin_assign(uuid, uuid, uuid[]) from anon;
revoke all on function public.crm_round_robin_assign(uuid, uuid, uuid[]) from authenticated;
grant execute on function public.crm_round_robin_assign(uuid, uuid, uuid[]) to service_role;
