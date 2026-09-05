-- Smoke test for 0093 — the Flow engine (M7 Phase 20).
--
-- Four of M7's five criteria are decided by this schema, and all four are
-- asserted here:
--   1. a killed worker never duplicates an action
--   2. loop protection halts AND says why
--   3. editing a published flow leaves in-flight runs on the old version
--   5. the execution log shows every step

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','o@example.com') on conflict do nothing;
insert into public.workspaces (id, name, owner_user_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Acme','11111111-1111-1111-1111-111111111111')
on conflict do nothing;
insert into public.workspace_memberships (workspace_id, user_id, role)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','owner')
on conflict do nothing;

insert into public.crm_contacts (id, workspace_id, first_name, last_name, full_name)
values ('c0000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'Dana','Reyes','Dana Reyes');

insert into public.flows (id, workspace_id, name, max_runs_per_contact_per_day, max_chain_depth)
values ('f0000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'New lead handling', 2, 3);

-- ---------------------------------------------------------------------------
-- CRITERION 3 — publishing, then editing, then publishing again.
-- ---------------------------------------------------------------------------

select 'PUBLISH creates version 1' as check,
       public.flow_publish(
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','f0000000-0000-0000-0000-000000000001',
         '{"steps":[{"id":"assign","type":"ASSIGN_OWNER"}]}'::jsonb
       ) is not null as pass;

-- A run starts on version 1 and PINS it.
insert into public.flow_runs (workspace_id, flow_id, version_id, trigger_type, contact_id, current_step)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','f0000000-0000-0000-0000-000000000001',
       f.published_version_id, 'contact_created', 'c0000000-0000-0000-0000-000000000001', 'assign'
from public.flows f where f.id = 'f0000000-0000-0000-0000-000000000001';

-- Now the flow is edited and re-published while that run is mid-flight.
select 'RE-PUBLISH creates version 2' as check,
       public.flow_publish(
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','f0000000-0000-0000-0000-000000000001',
         '{"steps":[{"id":"assign","type":"ASSIGN_OWNER"},{"id":"email","type":"SEND_EMAIL"}]}'::jsonb
       ) is not null as pass;

select 'CRITERION 3: the in-flight run still points at VERSION 1' as check,
       v.version = 1 as pass,
       -- ...and version 1's definition is untouched: still one step.
       jsonb_array_length(v.definition -> 'steps') = 1 as old_definition_intact
from public.flow_runs r
join public.flow_versions v on v.id = r.version_id
where r.flow_id = 'f0000000-0000-0000-0000-000000000001';

select 'The FLOW now points at version 2' as check,
       v.version = 2 as pass
from public.flows f join public.flow_versions v on v.id = f.published_version_id
where f.id = 'f0000000-0000-0000-0000-000000000001';

-- A published version cannot be edited at all.
do $$
begin
  update public.flow_versions
     set definition = '{"steps":[]}'::jsonb
   where flow_id = 'f0000000-0000-0000-0000-000000000001' and version = 1;
  raise exception 'FAIL: a published version was edited';
exception
  when check_violation then
    raise notice 'PASS a published version is immutable';
end
$$;

-- ---------------------------------------------------------------------------
-- CRITERION 1 — a step is claimed exactly once.
-- ---------------------------------------------------------------------------

create temporary table run_ref on commit drop as
  select id from public.flow_runs where flow_id = 'f0000000-0000-0000-0000-000000000001' limit 1;

select 'FIRST claim of a step succeeds' as check,
       public.flow_claim_step(
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', (select id from run_ref),
         'send-email','SEND_EMAIL','{"to":"dana@buyer.example"}'::jsonb) = true as pass;

/*
 * ⚠️ THE CASE THAT MATTERS. The worker is killed after sending the email but
 * before recording success. On restart it claims again — and gets FALSE, so it
 * does NOT send a second email. This is criterion 1.
 */
select 'CRITERION 1: a retry after a kill does NOT re-claim the step' as check,
       bool_and(result = false) as pass
from (
  select public.flow_claim_step(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', (select id from run_ref),
    'send-email','SEND_EMAIL','{"to":"dana@buyer.example"}'::jsonb) as result
  from generate_series(1,4)
) retries;

select 'EXACTLY ONE step row exists' as check,
       count(*) = 1 as pass
from public.flow_step_runs where step_id = 'send-email';

-- A DIFFERENT step in the same run is claimable.
select 'A DIFFERENT step is still claimable' as check,
       public.flow_claim_step(
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', (select id from run_ref),
         'create-task','CREATE_TASK') = true as pass;

-- ---------------------------------------------------------------------------
-- Trigger idempotency — one event fires one run.
-- ---------------------------------------------------------------------------

insert into public.flow_runs
  (workspace_id, flow_id, version_id, trigger_type, contact_id, idempotency_key)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','f0000000-0000-0000-0000-000000000001',
       f.published_version_id,'webhook','c0000000-0000-0000-0000-000000000001','evt-abc'
from public.flows f where f.id = 'f0000000-0000-0000-0000-000000000001';

do $$
begin
  insert into public.flow_runs
    (workspace_id, flow_id, version_id, trigger_type, contact_id, idempotency_key)
  select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','f0000000-0000-0000-0000-000000000001',
         f.published_version_id,'webhook','c0000000-0000-0000-0000-000000000001','evt-abc'
  from public.flows f where f.id = 'f0000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: a redelivered trigger started a second run';
exception
  when unique_violation then
    raise notice 'PASS a redelivered trigger produces one run, not two';
end
$$;

-- ---------------------------------------------------------------------------
-- CRITERION 2 — loop protection halts AND explains.
-- ---------------------------------------------------------------------------

select 'DEPTH within the limit is allowed' as check,
       public.flow_check_loop_protection(
         'f0000000-0000-0000-0000-000000000001', null, 2) is null as pass;

select 'CRITERION 2: a self-triggering flow is halted WITH a reason' as check,
       public.flow_check_loop_protection(
         'f0000000-0000-0000-0000-000000000001', null, 4) is not null as halted,
       -- The reason must name the cause, not just say "stopped".
       public.flow_check_loop_protection(
         'f0000000-0000-0000-0000-000000000001', null, 4) like '%triggered itself%' as explains_why;

-- Two runs already exist today for this contact; the limit is 2.
select 'PER-CONTACT limit halts with its own reason' as check,
       public.flow_check_loop_protection(
         'f0000000-0000-0000-0000-000000000001',
         'c0000000-0000-0000-0000-000000000001', 0) like '%already entered this flow%' as pass;

-- A halted run cannot be recorded without saying why.
do $$
begin
  update public.flow_runs set status = 'halted'
   where id = (select id from run_ref);
  raise exception 'FAIL: a run halted with no reason';
exception
  when check_violation then
    raise notice 'PASS a halted run must record its reason';
end
$$;

-- ---------------------------------------------------------------------------
-- CRITERION 5 — the execution log.
-- ---------------------------------------------------------------------------

update public.flow_step_runs
   set status = 'succeeded', finished_at = now(), duration_ms = 42,
       output = '{"assigned_to":"someone"}'::jsonb
 where step_id = 'send-email';

update public.flow_step_runs
   set status = 'failed', finished_at = now(), duration_ms = 7,
       error_code = 'TASK_FAILED', error_message = 'Could not create the task.'
 where step_id = 'create-task';

select 'CRITERION 5: every step has status, duration and error detail' as check,
       count(*) = 2 as both_steps_logged,
       count(*) filter (where status = 'succeeded') = 1 as success_logged,
       count(*) filter (where status = 'failed' and error_code is not null) = 1 as failure_explained,
       count(*) filter (where duration_ms is not null) = 2 as durations_recorded,
       -- Deterministic steps cost nothing; only Hubble steps ever will.
       count(*) filter (where credits_used = 0) = 2 as deterministic_steps_are_free
from public.flow_step_runs where run_id = (select id from run_ref);

rollback;
