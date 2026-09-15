-- Smoke test for 0128 — retry waiting leads only when something changed.
--
-- ⚠️ GATED: every check goes through coalesce(..., false) into smoke_checks, and
-- the final block raises unless exactly the expected number were recorded and
-- all are true.
--
-- ⚠️ ONE WORKSPACE PER SCENARIO. A rule change or a membership change is
-- workspace-wide, so two scenarios sharing a workspace would each trigger the
-- other and every "not retried" check would fail — or worse, pass for the
-- wrong reason.
--
-- ⚠️ `now()` IS FROZEN FOR THE WHOLE TRANSACTION, so every "before" and "after"
-- here is an explicit offset from it, and every rule and membership is inserted
-- with explicit timestamps. A default `now()` on those rows would count as a
-- change made after every decision.
--
-- Run it with:
--   scripts/check-migration.sh supabase/migrations/0128_crm_routing_retry.sql \
--     supabase/migrations/smoke/0128_crm_routing_retry.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
) on commit drop;

create temp table ran (
  label text primary key,
  res   jsonb not null
) on commit drop;

-- People: M owns every workspace; A to F are setters.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'owner.m@example.com'),
  ('00000000-0000-4000-8000-0000000000a1', 'a@example.com'),
  ('00000000-0000-4000-8000-0000000000b1', 'b@example.com'),
  ('00000000-0000-4000-8000-0000000000c1', 'c@example.com'),
  ('00000000-0000-4000-8000-0000000000d1', 'd@example.com'),
  ('00000000-0000-4000-8000-0000000000e1', 'e@example.com'),
  ('00000000-0000-4000-8000-0000000000f1', 'f@example.com');

/*
 * Workspaces, one per scenario:
 *   w1 nothing changed      w2 rule changed       w3 review is due
 *   w4 return date arrived  w5 filters            w6 still nobody
 *   w7 limit                w8 another tenant's change
 *   w9 member added         w10 away date cleared
 */
insert into public.workspaces (id, name, owner_user_id)
select format('00000000-0000-4000-8000-%s', lpad((100 + g)::text, 12, '0'))::uuid, format('W%s', g), '00000000-0000-4000-8000-00000000000a'
  from generate_series(1, 10) as g;

/*
 * ⚠️ EVERY MEMBERSHIP AND RULE IS FOUR DAYS OLD, OLDER THAN EVERY DECISION,
 * unless a scenario says otherwise. A fixture dated after a decision is itself
 * a "change since", and would retry the lead for the wrong reason — which is
 * how a first draft of this file let the scheduled review be deleted unnoticed.
 */
insert into public.workspace_memberships (workspace_id, user_id, role, away_until, created_at, updated_at)
select w.id, '00000000-0000-4000-8000-00000000000a', 'owner', null, now() - interval '4 days', now() - interval '4 days'
  from public.workspaces w
 where w.name ~ '^W[0-9]+$';

insert into public.workspace_memberships (workspace_id, user_id, role, away_until, created_at, updated_at) values
  -- w1: A is STILL away. A future return date is not a change that could help.
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-0000000000a1', 'setter', now() + interval '1 day', now() - interval '4 days', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-0000000000a1', 'setter', null, now() - interval '4 days', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-0000000000b1', 'setter', null, now() - interval '4 days', now() - interval '4 days'),
  -- w4: C was away until half an hour ago, set days ago.
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-0000000000c1', 'setter', now() - interval '30 minutes', now() - interval '4 days', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-0000000000a1', 'setter', null, now() - interval '4 days', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-0000000000d1', 'setter', null, now() - interval '4 days', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000107', '00000000-0000-4000-8000-0000000000a1', 'setter', null, now() - interval '4 days', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000108', '00000000-0000-4000-8000-0000000000a1', 'setter', null, now() - interval '4 days', now() - interval '4 days'),
  -- w9: E joined an hour ago, after the decision.
  ('00000000-0000-4000-8000-000000000109', '00000000-0000-4000-8000-0000000000e1', 'setter', null, now() - interval '1 hour', now() - interval '1 hour'),
  -- w10: F has been a member for days; an admin cleared F's away date an hour ago.
  ('00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-0000000000f1', 'setter', null, now() - interval '4 days', now() - interval '1 hour');

/*
 * One live pool rule per workspace, four days old — EXCEPT w2, whose rule was
 * edited an hour ago. w6's pool is D with a cap of 1, and D already owns one
 * contact there, so nobody is ever eligible.
 */
insert into public.crm_routing_rules (workspace_id, name, position, kind, member_ids, max_open_workload, status, published_at, created_at, updated_at) values
  ('00000000-0000-4000-8000-000000000101', 'Pool', 0, 'pool', array['00000000-0000-4000-8000-0000000000a1']::uuid[], null, 'published', now() - interval '4 days', now() - interval '4 days', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000102', 'Pool', 0, 'pool', array['00000000-0000-4000-8000-0000000000a1']::uuid[], null, 'published', now() - interval '4 days', now() - interval '4 days', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-000000000103', 'Pool', 0, 'pool', array['00000000-0000-4000-8000-0000000000b1']::uuid[], null, 'published', now() - interval '3 days',  now() - interval '3 days',  now() - interval '3 days'),
  ('00000000-0000-4000-8000-000000000104', 'Pool', 0, 'pool', array['00000000-0000-4000-8000-0000000000c1']::uuid[], null, 'published', now() - interval '4 days', now() - interval '4 days', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000105', 'Pool', 0, 'pool', array['00000000-0000-4000-8000-0000000000a1']::uuid[], null, 'published', now() - interval '4 days', now() - interval '4 days', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000106', 'Pool', 0, 'pool', array['00000000-0000-4000-8000-0000000000d1']::uuid[], 1,    'published', now() - interval '4 days', now() - interval '4 days', now() - interval '3 days'),
  ('00000000-0000-4000-8000-000000000107', 'Pool', 0, 'pool', array['00000000-0000-4000-8000-0000000000a1']::uuid[], null, 'published', now() - interval '3 days',  now() - interval '3 days',  now() - interval '3 days'),
  ('00000000-0000-4000-8000-000000000108', 'Pool', 0, 'pool', array['00000000-0000-4000-8000-0000000000a1']::uuid[], null, 'published', now() - interval '4 days', now() - interval '4 days', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000109', 'Pool', 0, 'pool', array['00000000-0000-4000-8000-0000000000e1']::uuid[], null, 'published', now() - interval '4 days', now() - interval '4 days', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000110', 'Pool', 0, 'pool', array['00000000-0000-4000-8000-0000000000f1']::uuid[], null, 'published', now() - interval '4 days', now() - interval '4 days', now() - interval '4 days');

-- Contacts. Unowned csv_import unless stated.
insert into public.crm_contacts (id, workspace_id, full_name, owner_user_id, source, deleted_at) values
  ('c0000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101', 'W1 nothing changed', null, 'csv_import', null),
  ('c0000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000102', 'W2 rule changed',    null, 'csv_import', null),
  ('c0000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000103', 'W3 review due',      null, 'lead_engine', null),
  ('c0000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000104', 'W4 C is back',       null, 'csv_import', null),
  ('c0000000-0000-4000-8000-000000000151', '00000000-0000-4000-8000-000000000105', 'W5 now owned',       '00000000-0000-4000-8000-0000000000a1', 'csv_import', null),
  ('c0000000-0000-4000-8000-000000000152', '00000000-0000-4000-8000-000000000105', 'W5 deleted',         null, 'csv_import', now() - interval '10 minutes'),
  ('c0000000-0000-4000-8000-000000000153', '00000000-0000-4000-8000-000000000105', 'W5 newer decision',  null, 'csv_import', null),
  ('c0000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000106', 'W6 stuck',           null, 'csv_import', null),
  ('c0000000-0000-4000-8000-000000000160', '00000000-0000-4000-8000-000000000106', 'W6 D already owns',  '00000000-0000-4000-8000-0000000000d1', 'csv_import', null),
  ('c0000000-0000-4000-8000-000000000171', '00000000-0000-4000-8000-000000000107', 'W7 older',           null, 'csv_import', null),
  ('c0000000-0000-4000-8000-000000000172', '00000000-0000-4000-8000-000000000107', 'W7 newer',           null, 'csv_import', null),
  ('c0000000-0000-4000-8000-000000000108', '00000000-0000-4000-8000-000000000108', 'W8 isolated',        null, 'csv_import', null),
  ('c0000000-0000-4000-8000-000000000154', '00000000-0000-4000-8000-000000000105', 'W5 added by hand',   null, 'manual', null),
  ('c0000000-0000-4000-8000-000000000109', '00000000-0000-4000-8000-000000000109', 'W9 E joined',        null, 'csv_import', null),
  ('c0000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000110', 'W10 F is back',      null, 'csv_import', null);

/*
 * Latest decisions — all "unassigned" two hours ago, except where the scenario
 * needs otherwise. (w5's third lead has a NEWER already_owned decision on top.)
 */
insert into public.crm_routing_decisions (workspace_id, contact_id, intake_key, source, outcome, reason, created_at) values
  ('00000000-0000-4000-8000-000000000101', 'c0000000-0000-4000-8000-000000000101', 'seed:101', 'csv_import', 'unassigned', 'no_eligible_owner', now() - interval '2 hours'),
  ('00000000-0000-4000-8000-000000000102', 'c0000000-0000-4000-8000-000000000102', 'seed:102', 'csv_import', 'unassigned', 'no_eligible_owner', now() - interval '2 hours'),
  ('00000000-0000-4000-8000-000000000103', 'c0000000-0000-4000-8000-000000000103', 'seed:103', 'lead_engine', 'unassigned', 'no_eligible_owner', now() - interval '26 hours'),
  ('00000000-0000-4000-8000-000000000104', 'c0000000-0000-4000-8000-000000000104', 'seed:104', 'csv_import', 'unassigned', 'no_eligible_owner', now() - interval '2 hours'),
  ('00000000-0000-4000-8000-000000000105', 'c0000000-0000-4000-8000-000000000151', 'seed:151', 'csv_import', 'unassigned', 'no_eligible_owner', now() - interval '30 hours'),
  ('00000000-0000-4000-8000-000000000105', 'c0000000-0000-4000-8000-000000000152', 'seed:152', 'csv_import', 'unassigned', 'no_eligible_owner', now() - interval '30 hours'),
  ('00000000-0000-4000-8000-000000000105', 'c0000000-0000-4000-8000-000000000153', 'seed:153a', 'csv_import', 'unassigned', 'no_eligible_owner', now() - interval '30 hours'),
  ('00000000-0000-4000-8000-000000000105', 'c0000000-0000-4000-8000-000000000153', 'seed:153b', 'csv_import', 'already_owned', 'already_owned', now() - interval '29 hours'),
  ('00000000-0000-4000-8000-000000000106', 'c0000000-0000-4000-8000-000000000106', 'seed:106', 'csv_import', 'unassigned', 'no_eligible_owner', now() - interval '26 hours'),
  ('00000000-0000-4000-8000-000000000107', 'c0000000-0000-4000-8000-000000000171', 'seed:171', 'csv_import', 'unassigned', 'no_eligible_owner', now() - interval '50 hours'),
  ('00000000-0000-4000-8000-000000000107', 'c0000000-0000-4000-8000-000000000172', 'seed:172', 'csv_import', 'unassigned', 'no_eligible_owner', now() - interval '49 hours'),
  ('00000000-0000-4000-8000-000000000108', 'c0000000-0000-4000-8000-000000000108', 'seed:108', 'csv_import', 'unassigned', 'no_eligible_owner', now() - interval '2 hours'),
  -- A lead whose contact is now marked hand-added: never system intake again.
  ('00000000-0000-4000-8000-000000000105', 'c0000000-0000-4000-8000-000000000154', 'seed:154', 'csv_import', 'unassigned', 'no_eligible_owner', now() - interval '30 hours'),
  ('00000000-0000-4000-8000-000000000109', 'c0000000-0000-4000-8000-000000000109', 'seed:109', 'csv_import', 'unassigned', 'no_eligible_owner', now() - interval '2 hours'),
  ('00000000-0000-4000-8000-000000000110', 'c0000000-0000-4000-8000-000000000110', 'seed:110', 'csv_import', 'unassigned', 'no_eligible_owner', now() - interval '2 hours');

-- ---------------------------------------------------------------------------
-- Limits refused
-- ---------------------------------------------------------------------------
do $$
declare v boolean := false;
begin
  begin
    perform public.crm_retry_waiting_leads(0);
  exception when invalid_parameter_value then v := true;
  end;
  insert into smoke_checks (label, ok) values ('a limit below one is refused', v);
end $$;

do $$
declare v boolean := false;
begin
  begin
    perform public.crm_retry_waiting_leads(10, interval '5 minutes');
  exception when invalid_parameter_value then v := true;
  end;
  insert into smoke_checks (label, ok) values ('a review interval shorter than an hour is refused', v);
end $$;

-- ---------------------------------------------------------------------------
-- w7 first, with a limit of one: only the OLDER lead is retried.
-- ---------------------------------------------------------------------------
insert into ran values ('limit', (
  select public.crm_retry_waiting_leads(1)
));

insert into smoke_checks (label, ok)
select 'the limit is respected, and the oldest waiting lead in the whole queue goes first',
       coalesce((res ->> 'retried')::int = 1, false)
  from ran where label = 'limit';

/*
 * The oldest waiting lead anywhere is w5's "now owned" or "deleted" (30 hours)
 * — but those are filtered — then w7's older lead (50 hours) is actually the
 * oldest eligible. It is the only one retried.
 */
insert into smoke_checks (label, ok)
select 'the one retried is w7''s older lead, not its newer one',
       (select owner_user_id from public.crm_contacts where id = 'c0000000-0000-4000-8000-000000000171') is not null
       and (select owner_user_id from public.crm_contacts where id = 'c0000000-0000-4000-8000-000000000172') is null;

-- ---------------------------------------------------------------------------
-- The main run.
-- ---------------------------------------------------------------------------
insert into ran values ('first', (
  select public.crm_retry_waiting_leads(100)
));

insert into smoke_checks (label, ok)
select 'w1: nothing changed, a member is still away, and no review is due, so it is not retried',
       (select count(id) from public.crm_routing_decisions
         where contact_id = 'c0000000-0000-4000-8000-000000000101') = 1
       and (select owner_user_id from public.crm_contacts
             where id = 'c0000000-0000-4000-8000-000000000101') is null;

insert into smoke_checks (label, ok)
select 'w2: a rule edited after the decision triggers a retry, and it is placed',
       coalesce((select owner_user_id from public.crm_contacts
                  where id = 'c0000000-0000-4000-8000-000000000102') = '00000000-0000-4000-8000-0000000000a1', false);

insert into smoke_checks (label, ok)
select 'w3: a decision older than the review interval is retried with nothing changed',
       coalesce((select owner_user_id from public.crm_contacts
                  where id = 'c0000000-0000-4000-8000-000000000103') = '00000000-0000-4000-8000-0000000000b1', false);

insert into smoke_checks (label, ok)
select 'w4: a return date that arrived after the decision triggers a retry, and C gets it',
       coalesce((select owner_user_id from public.crm_contacts
                  where id = 'c0000000-0000-4000-8000-000000000104') = '00000000-0000-4000-8000-0000000000c1', false);

insert into smoke_checks (label, ok)
select 'w5: an owned lead, a deleted lead, a hand-added lead, and a lead whose latest decision is not unassigned are never retried',
       (select count(id) from public.crm_routing_decisions
         where workspace_id = '00000000-0000-4000-8000-000000000105') = 5
       and (select owner_user_id from public.crm_contacts
             where id = 'c0000000-0000-4000-8000-000000000153') is null;

insert into smoke_checks (label, ok)
select 'w6: a review that still finds nobody writes exactly one new decision',
       (select count(id) from public.crm_routing_decisions
         where contact_id = 'c0000000-0000-4000-8000-000000000106') = 2
       and (select owner_user_id from public.crm_contacts
             where id = 'c0000000-0000-4000-8000-000000000106') is null;

insert into smoke_checks (label, ok)
select 'the retry of w6 used the previous decision''s id as its key',
       exists (
         select 1 from public.crm_routing_decisions new_d
           join public.crm_routing_decisions old_d
             on old_d.intake_key = 'seed:106'
          where new_d.contact_id = 'c0000000-0000-4000-8000-000000000106'
            and new_d.intake_key = format('retry:%s', old_d.id)
       );

insert into smoke_checks (label, ok)
select 'w9: a member added after the decision triggers a retry, and gets the lead',
       coalesce((select owner_user_id from public.crm_contacts
                  where id = 'c0000000-0000-4000-8000-000000000109') = '00000000-0000-4000-8000-0000000000e1', false);

insert into smoke_checks (label, ok)
select 'w10: a membership changed after the decision triggers a retry, and F gets the lead',
       coalesce((select owner_user_id from public.crm_contacts
                  where id = 'c0000000-0000-4000-8000-000000000110') = '00000000-0000-4000-8000-0000000000f1', false);

insert into smoke_checks (label, ok)
select 'w8: another workspace''s rule change does not retry this one',
       (select count(id) from public.crm_routing_decisions
         where contact_id = 'c0000000-0000-4000-8000-000000000108') = 1;

insert into smoke_checks (label, ok)
select 'the run reports what it did: w2, w3, w4, w9, w10 and w7''s newer lead placed; w6 still waiting',
       coalesce((res ->> 'retried')::int = 7
                and (res ->> 'assigned')::int = 6
                and (res ->> 'unassigned')::int = 1
                and (res ->> 'failed')::int = 0, false)
  from ran where label = 'first';

insert into smoke_checks (label, ok)
select 'every new assignment is listed once, with its workspace, for the caller to announce',
       coalesce(jsonb_array_length(res -> 'assignments') = 6
                and (select bool_and(a ? 'workspace_id' and a ? 'activity_id' and a ? 'owner')
                       from jsonb_array_elements(res -> 'assignments') as a), false)
  from ran where label = 'first';

insert into smoke_checks (label, ok)
select 'a placed lead got a real OWNER_ASSIGNED activity',
       exists (select 1 from public.crm_activities
                where contact_id = 'c0000000-0000-4000-8000-000000000102'
                  and activity_type = 'OWNER_ASSIGNED');

-- ---------------------------------------------------------------------------
-- ⚠️ THE NEXT POLL. Nothing has changed since the run above, so NOTHING is
-- retried — this is the check the whole design exists for.
-- ---------------------------------------------------------------------------
insert into ran values ('second', (
  select public.crm_retry_waiting_leads(100)
));

insert into smoke_checks (label, ok)
select 'polling again straight away retries nothing',
       coalesce((res ->> 'retried')::int = 0
                and jsonb_array_length(res -> 'assignments') = 0, false)
  from ran where label = 'second';

insert into smoke_checks (label, ok)
select 'the still-unplaceable w6 lead gained no further decision from the second poll',
       (select count(id) from public.crm_routing_decisions
         where contact_id = 'c0000000-0000-4000-8000-000000000106') = 2;

-- ---------------------------------------------------------------------------
-- A change after the new decision makes w6 eligible again — once.
-- ---------------------------------------------------------------------------
update public.crm_contacts
   set owner_user_id = null
 where id = 'c0000000-0000-4000-8000-000000000160';

/*
 * D's load dropped, but nothing SIGNALS that — which is what the review is
 * for. Freeing capacity alone must not retry yet.
 */
insert into ran values ('capacity-freed', (
  select public.crm_retry_waiting_leads(100)
));

insert into smoke_checks (label, ok)
select 'freed capacity alone does not retry before the review is due',
       coalesce((res ->> 'retried')::int = 0, false)
  from ran where label = 'capacity-freed';

/*
 * An admin edits w6's rule. The trigger stamps updated_at with now() — the
 * frozen transaction time — which is AFTER the retry decision only if that
 * decision was written earlier; it was written by the first run in this same
 * transaction, at now(). So the rule is stamped strictly later by hand.
 */
/*
 * ⚠️ The set_updated_at trigger would stamp now() — equal to, not after, the
 * decision written earlier in this same transaction. It is switched off for
 * this one statement so the edit can be dated a second later, as it would be
 * in real time. The transaction rolls back, trigger state included.
 */
alter table public.crm_routing_rules disable trigger crm_routing_rules_set_updated_at;

update public.crm_routing_rules
   set name = 'Pool (edited)',
       updated_at = now() + interval '1 second'
 where workspace_id = '00000000-0000-4000-8000-000000000106';

alter table public.crm_routing_rules enable trigger crm_routing_rules_set_updated_at;

insert into ran values ('after-edit', (
  select public.crm_retry_waiting_leads(100)
));

insert into smoke_checks (label, ok)
select 'after the rule is edited, the stuck lead is retried and placed',
       coalesce((res ->> 'assigned')::int = 1
                and (select owner_user_id from public.crm_contacts
                      where id = 'c0000000-0000-4000-8000-000000000106') = '00000000-0000-4000-8000-0000000000d1', false)
  from ran where label = 'after-edit';

-- ---------------------------------------------------------------------------
-- Faults: a lead whose routing raises, and a retry that replays another tick's.
--
-- Neither happens in a serial test on its own — one needs broken data, the
-- other two ticks selecting the same lead at once — so `crm_route_contact` is
-- swapped for a stand-in, inside this transaction only (it rolls back):
--   • lead 111a: raises
--   • lead 112:  routed, then routed AGAIN with the same key, returning the
--                replay — exactly what the slower of two overlapping ticks sees
--   • anything else: routed normally
--
-- w11 and w12 are created only now, so no earlier run can have seen them.
-- ---------------------------------------------------------------------------
insert into public.workspaces (id, name, owner_user_id) values
  ('00000000-0000-4000-8000-000000000111', 'Faults',  '00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-000000000112', 'Replay',  '00000000-0000-4000-8000-00000000000a');

insert into public.workspace_memberships (workspace_id, user_id, role, away_until, created_at, updated_at) values
  ('00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-00000000000a', 'owner',  null, now() - interval '4 days', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-0000000000a1', 'setter', null, now() - interval '4 days', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000112', '00000000-0000-4000-8000-00000000000a', 'owner',  null, now() - interval '4 days', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000112', '00000000-0000-4000-8000-0000000000a1', 'setter', null, now() - interval '4 days', now() - interval '4 days');

insert into public.crm_routing_rules (workspace_id, name, position, kind, member_ids, max_open_workload, status, published_at, created_at, updated_at) values
  ('00000000-0000-4000-8000-000000000111', 'Pool', 0, 'pool', array['00000000-0000-4000-8000-0000000000a1']::uuid[], null, 'published', now() - interval '4 days', now() - interval '4 days', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000112', 'Pool', 0, 'pool', array['00000000-0000-4000-8000-0000000000a1']::uuid[], null, 'published', now() - interval '4 days', now() - interval '4 days', now() - interval '4 days');

insert into public.crm_contacts (id, workspace_id, full_name, owner_user_id, source, deleted_at) values
  ('c0000000-0000-4000-8000-00000000111a', '00000000-0000-4000-8000-000000000111', 'W11 raises',  null, 'csv_import', null),
  ('c0000000-0000-4000-8000-00000000111b', '00000000-0000-4000-8000-000000000111', 'W11 fine',    null, 'csv_import', null),
  ('c0000000-0000-4000-8000-000000000112', '00000000-0000-4000-8000-000000000112', 'W12 replays', null, 'csv_import', null);

-- All three are due for review. 111a is oldest, so it is attempted first.
insert into public.crm_routing_decisions (workspace_id, contact_id, intake_key, source, outcome, reason, created_at) values
  ('00000000-0000-4000-8000-000000000111', 'c0000000-0000-4000-8000-00000000111a', 'seed:111a', 'csv_import', 'unassigned', 'no_eligible_owner', now() - interval '28 hours'),
  ('00000000-0000-4000-8000-000000000111', 'c0000000-0000-4000-8000-00000000111b', 'seed:111b', 'csv_import', 'unassigned', 'no_eligible_owner', now() - interval '27 hours'),
  ('00000000-0000-4000-8000-000000000112', 'c0000000-0000-4000-8000-000000000112', 'seed:112',  'csv_import', 'unassigned', 'no_eligible_owner', now() - interval '26 hours');

alter function public.crm_route_contact(uuid, uuid, text, public.crm_record_source)
  rename to crm_route_contact_real;

create function public.crm_route_contact(
  p_workspace_id uuid, p_contact_id uuid, p_intake_key text, p_source public.crm_record_source
)
returns jsonb
language plpgsql
as $$
begin
  if p_contact_id = 'c0000000-0000-4000-8000-00000000111a' then
    raise exception 'smoke: this lead cannot be routed';
  end if;

  if p_contact_id = 'c0000000-0000-4000-8000-000000000112' then
    perform public.crm_route_contact_real(p_workspace_id, p_contact_id, p_intake_key, p_source);
  end if;

  return public.crm_route_contact_real(p_workspace_id, p_contact_id, p_intake_key, p_source);
end;
$$;

/*
 * ⚠️ AN EXCEPTION IS CAUGHT AND RECORDED, NOT LEFT TO ABORT THE SCRIPT. If the
 * retry lets one lead's error escape, this run must show up as failed checks —
 * an aborted script would say nothing about which rule broke.
 */
do $$
declare v jsonb;
begin
  begin
    v := public.crm_retry_waiting_leads(100);
  exception when others then
    v := jsonb_build_object('raised', sqlerrm);
  end;
  insert into ran values ('faults', v);
end $$;

drop function public.crm_route_contact(uuid, uuid, text, public.crm_record_source);
alter function public.crm_route_contact_real(uuid, uuid, text, public.crm_record_source)
  rename to crm_route_contact;

insert into smoke_checks (label, ok)
select 'a lead whose routing raises is counted as failed, and the rest of the run carries on',
       coalesce((res ->> 'failed')::int = 1
                and (select owner_user_id from public.crm_contacts
                      where id = 'c0000000-0000-4000-8000-00000000111b') = '00000000-0000-4000-8000-0000000000a1', false)
  from ran where label = 'faults';

insert into smoke_checks (label, ok)
select 'the lead that raised gained no decision and is still waiting',
       (select count(id) from public.crm_routing_decisions
         where contact_id = 'c0000000-0000-4000-8000-00000000111a') = 1
       and (select owner_user_id from public.crm_contacts
             where id = 'c0000000-0000-4000-8000-00000000111a') is null;

insert into smoke_checks (label, ok)
select 'a retry that replays another tick''s is counted as placed, but announced only by the tick that placed it',
       coalesce((res ->> 'assigned')::int = 2
                and jsonb_array_length(res -> 'assignments') = 1
                and not exists (
                  select 1 from jsonb_array_elements(res -> 'assignments') as a
                   where a ->> 'contact_id' = 'c0000000-0000-4000-8000-000000000112'
                ), false)
  from ran where label = 'faults';

-- ---------------------------------------------------------------------------
-- Who may run it
-- ---------------------------------------------------------------------------
insert into smoke_checks (label, ok)
select 'only the service role can run it',
       has_function_privilege('service_role', 'public.crm_retry_waiting_leads(integer,interval)', 'execute')
       and not has_function_privilege('authenticated', 'public.crm_retry_waiting_leads(integer,interval)', 'execute')
       and not has_function_privilege('anon', 'public.crm_retry_waiting_leads(integer,interval)', 'execute');

insert into smoke_checks (label, ok)
select 'the waiting-lead index exists',
       exists (select 1 from pg_indexes
                where schemaname = 'public'
                  and indexname = 'crm_routing_decisions_waiting_idx');

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 26;
  v_total    integer;
  v_failed   text;
begin
  select count(n), string_agg(label, '; ' order by n) filter (where ok is not true)
    into v_total, v_failed
    from smoke_checks;

  if v_total <> v_expected then
    raise exception 'SMOKE FAILED: expected % checks, recorded %', v_expected, v_total;
  end if;

  if v_failed is not null then
    raise exception 'SMOKE FAILED: %', v_failed;
  end if;

  raise notice 'SMOKE PASSED: % of % checks', v_total, v_expected;
end $$;

rollback;
