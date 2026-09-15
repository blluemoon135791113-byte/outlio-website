-- ---------------------------------------------------------------------------
-- 0128 — retry waiting leads, only when something could change the answer
--
-- F02: "No eligible owner → Unassigned queue; retry only after relevant
-- availability change or scheduled review." F06, in the same table: "never
-- generate a new alert on every poll."
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️ EVERY ROUTING ATTEMPT WRITES AN APPEND-ONLY ROW.                       ║
-- ║                                                                           ║
-- ║  A retry that simply re-routed the Unassigned queue on every tick would   ║
-- ║  add one "still unassigned" decision per waiting lead every five minutes, ║
-- ║  forever — 288 rows a day per lead, none of which can be deleted, all     ║
-- ║  saying the same thing.                                                   ║
-- ║                                                                           ║
-- ║  So a waiting lead is retried only when, AFTER its latest decision:       ║
-- ║    • a routing rule in its workspace changed (published, edited,          ║
-- ║      reordered, taken offline, deleted — each bumps `updated_at`)         ║
-- ║    • a membership was added or changed (an away date set or cleared)      ║
-- ║    • someone's return date arrived                                        ║
-- ║    • or `p_review_after` passed — the scheduled review, for the one       ║
-- ║      change nothing signals: a member's workload dropping                 ║
-- ║                                                                           ║
-- ║  A lead that still cannot be placed gets ONE new decision, and that       ║
-- ║  decision is now its latest — so it is not retried again until the next  ║
-- ║  change or the next review. At most one extra row per lead per day.       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ THE INTAKE KEY IS THE PREVIOUS DECISION'S ID. Two overlapping ticks that
-- select the same lead build the same `retry:<decision id>` key; the second
-- replays the first under 0127's once-per-intake constraint instead of routing
-- twice. A key built from the clock would not protect against that.
--
-- ⚠️ CROSSES WORKSPACES IN ONE CALL, SAFELY. Each lead is routed with its OWN
-- decision's `workspace_id`, and every change signal is joined on that same
-- workspace, so a rule edited in one tenant can never retry another's leads.
-- Service role only.
--
-- ⚠️ NO `select` WITH A STAR AND NO DOUBLE-PIPE: pasted by hand.
--
-- ⚠️ VALIDATE BEFORE APPLYING:
--   scripts/check-migration.sh supabase/migrations/0128_crm_routing_retry.sql \
--     supabase/migrations/smoke/0128_crm_routing_retry.smoke.sql
--
-- ⚠️ APPLY THIS BEFORE MERGING THE CODE THAT CALLS IT.
-- ---------------------------------------------------------------------------

/*
 * Finding waiting leads reads only unassigned decisions, oldest first. Without
 * this the scan would walk every decision ever recorded, and that table only
 * grows.
 */
create index if not exists crm_routing_decisions_waiting_idx
  on public.crm_routing_decisions (created_at, id)
  where outcome = 'unassigned';

create or replace function public.crm_retry_waiting_leads(
  p_limit        integer,
  p_review_after interval default interval '24 hours'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row         record;
  v_result      jsonb;
  v_retried     integer := 0;
  v_assigned    integer := 0;
  v_unassigned  integer := 0;
  v_owned       integer := 0;
  v_failed      integer := 0;
  v_items       jsonb[] := '{}';
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'crm_retry_waiting_leads: limit must be between 1 and 500'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_review_after is null or p_review_after < interval '1 hour' then
    raise exception 'crm_retry_waiting_leads: review interval must be at least an hour'
      using errcode = 'invalid_parameter_value';
  end if;

  for v_row in
    select d.id as decision_id, d.workspace_id, d.contact_id, c.source
      from public.crm_routing_decisions d
      join public.crm_contacts c
        on c.id = d.contact_id
       and c.workspace_id = d.workspace_id
     where d.outcome = 'unassigned'
       -- Still waiting: unowned, not deleted, and never member-added intake.
       and c.owner_user_id is null
       and c.deleted_at is null
       and c.source <> 'manual'
       /*
        * ⚠️ ONLY THE LEAD'S LATEST DECISION. An older "unassigned" followed by
        * a newer one of any outcome is history, not a waiting lead — and a
        * lead retried once already has a newer decision, which is what stops
        * it being retried on the next poll.
        */
       and not exists (
         select 1
           from public.crm_routing_decisions later
          where later.workspace_id = d.workspace_id
            and later.contact_id = d.contact_id
            and (later.created_at, later.id) > (d.created_at, d.id)
       )
       and (
         -- The scheduled review.
         d.created_at < now() - p_review_after
         -- A rule in THIS workspace changed since.
         or exists (
           select 1 from public.crm_routing_rules r
            where r.workspace_id = d.workspace_id
              and r.updated_at > d.created_at
         )
         /*
          * A member of THIS workspace was added, or their membership changed.
          * One column covers both: `updated_at` defaults to now() on insert and
          * is bumped by trigger on every update (0070), so a new member's row
          * is never older than their joining.
          */
         or exists (
           select 1 from public.workspace_memberships m
            where m.workspace_id = d.workspace_id
              and m.updated_at > d.created_at
         )
         -- Someone's return date arrived since.
         or exists (
           select 1 from public.workspace_memberships m
            where m.workspace_id = d.workspace_id
              and m.away_until > d.created_at
              and m.away_until <= now()
         )
       )
     -- Oldest waiting first, so no lead is starved by newer arrivals.
     order by d.created_at, d.id
     limit p_limit
  loop
    /*
     * ⚠️ ONE LEAD'S FAILURE IS RECORDED, NOT RAISED. A single unroutable row
     * must not stop every other waiting lead in every other workspace for this
     * tick — the same rule the tick applies between whole jobs.
     */
    begin
      v_result := public.crm_route_contact(
        v_row.workspace_id,
        v_row.contact_id,
        format('retry:%s', v_row.decision_id),
        v_row.source
      );
    exception when others then
      v_failed := v_failed + 1;
      continue;
    end;

    v_retried := v_retried + 1;

    if v_result ->> 'outcome' = 'assigned' then
      v_assigned := v_assigned + 1;
      if not coalesce((v_result ->> 'replayed')::boolean, false) then
        v_items := array_append(v_items, jsonb_build_object(
          'workspace_id', v_row.workspace_id,
          'contact_id', v_row.contact_id,
          'owner', v_result ->> 'chosen_owner',
          'activity_id', v_result ->> 'activity_id'
        ));
      end if;
    elsif v_result ->> 'outcome' = 'unassigned' then
      v_unassigned := v_unassigned + 1;
    elsif v_result ->> 'outcome' = 'already_owned' then
      v_owned := v_owned + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'retried', v_retried,
    'assigned', v_assigned,
    'unassigned', v_unassigned,
    'already_owned', v_owned,
    'failed', v_failed,
    'assignments', to_jsonb(v_items)
  );
end;
$$;

comment on function public.crm_retry_waiting_leads(integer, interval) is
  'Re-routes waiting leads whose workspace changed since their latest decision, or whose decision is older than the review interval. Oldest first, bounded, once per decision.';

revoke all on function public.crm_retry_waiting_leads(integer, interval) from public;
revoke all on function public.crm_retry_waiting_leads(integer, interval) from anon;
revoke all on function public.crm_retry_waiting_leads(integer, interval) from authenticated;
grant execute on function public.crm_retry_waiting_leads(integer, interval) to service_role;
