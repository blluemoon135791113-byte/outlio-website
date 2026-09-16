-- Smoke test for 0093 — the Flow engine (M7 Phase 20).
--
-- Four of M7's five criteria are decided by this schema, and all four are
-- asserted here:
--   1. a killed worker never duplicates an action
--   2. loop protection halts AND says why
--   3. editing a published flow leaves in-flight runs on the old version
--   5. the execution log shows every step
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. The `select … as pass` rows here used
-- to fail nothing: an `f` printed and the harness exited 0. Each check now goes
-- into `smoke_checks` through `coalesce(…, false)`, and the gate at the end
-- raises unless exactly the expected number were recorded and every one is true.

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

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

insert into smoke_checks (label, ok)
values ('PUBLISH creates version 1',
        public.flow_publish(
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','f0000000-0000-0000-0000-000000000001',
          '{"steps":[{"id":"assign","type":"ASSIGN_OWNER"}]}'::jsonb
        ) is not null);

-- A run starts on version 1 and PINS it.
insert into public.flow_runs (workspace_id, flow_id, version_id, trigger_type, contact_id, current_step)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','f0000000-0000-0000-0000-000000000001',
       f.published_version_id, 'contact_created', 'c0000000-0000-0000-0000-000000000001', 'assign'
from public.flows f where f.id = 'f0000000-0000-0000-0000-000000000001';

-- Now the flow is edited and re-published while that run is mid-flight.
insert into smoke_checks (label, ok)
values ('RE-PUBLISH creates version 2',
        public.flow_publish(
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','f0000000-0000-0000-0000-000000000001',
          '{"steps":[{"id":"assign","type":"ASSIGN_OWNER"},{"id":"email","type":"SEND_EMAIL"}]}'::jsonb
        ) is not null);

insert into smoke_checks (label, ok) values
  ('CRITERION 3: the in-flight run still points at VERSION 1',
   coalesce((select v.version = 1
               from public.flow_runs r
               join public.flow_versions v on v.id = r.version_id
              where r.flow_id = 'f0000000-0000-0000-0000-000000000001'), false)),
  -- ...and version 1's definition is untouched: still one step.
  ('CRITERION 3: version 1''s definition is intact (one step)',
   coalesce((select jsonb_array_length(v.definition -> 'steps') = 1
               from public.flow_runs r
               join public.flow_versions v on v.id = r.version_id
              where r.flow_id = 'f0000000-0000-0000-0000-000000000001'), false));

insert into smoke_checks (label, ok)
values ('The FLOW now points at version 2',
        coalesce((select v.version = 2
                    from public.flows f join public.flow_versions v on v.id = f.published_version_id
                   where f.id = 'f0000000-0000-0000-0000-000000000001'), false));

-- A published version cannot be edited at all.
do $$
declare
  v_rejected boolean := false;
begin
  begin
    update public.flow_versions
       set definition = '{"steps":[]}'::jsonb
     where flow_id = 'f0000000-0000-0000-0000-000000000001' and version = 1;
  exception
    when check_violation then
      v_rejected := true;
  end;

  insert into smoke_checks (label, ok)
  values ('A PUBLISHED version is immutable', v_rejected);
end
$$;

-- ---------------------------------------------------------------------------
-- CRITERION 1 — a step is claimed exactly once.
-- ---------------------------------------------------------------------------

create temporary table run_ref on commit drop as
  select id from public.flow_runs where flow_id = 'f0000000-0000-0000-0000-000000000001' limit 1;

insert into smoke_checks (label, ok)
values ('FIRST claim of a step succeeds',
        coalesce(public.flow_claim_step(
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', (select id from run_ref),
          'send-email','SEND_EMAIL','{"to":"dana@buyer.example"}'::jsonb) = true, false));

/*
 * ⚠️ THE CASE THAT MATTERS. The worker is killed after sending the email but
 * before recording success. On restart it claims again — and gets FALSE, so it
 * does NOT send a second email. This is criterion 1.
 */
insert into smoke_checks (label, ok)
select 'CRITERION 1: a retry after a kill does NOT re-claim the step',
       coalesce(bool_and(result = false), false)
from (
  select public.flow_claim_step(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', (select id from run_ref),
    'send-email','SEND_EMAIL','{"to":"dana@buyer.example"}'::jsonb) as result
  from generate_series(1,4)
) retries;

insert into smoke_checks (label, ok)
select 'EXACTLY ONE step row exists', coalesce(count(*) = 1, false)
from public.flow_step_runs where step_id = 'send-email';

-- A DIFFERENT step in the same run is claimable.
insert into smoke_checks (label, ok)
values ('A DIFFERENT step is still claimable',
        coalesce(public.flow_claim_step(
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', (select id from run_ref),
          'create-task','CREATE_TASK') = true, false));

-- ---------------------------------------------------------------------------
-- Trigger idempotency — one event fires one run.
-- ---------------------------------------------------------------------------

insert into public.flow_runs
  (workspace_id, flow_id, version_id, trigger_type, contact_id, idempotency_key)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','f0000000-0000-0000-0000-000000000001',
       f.published_version_id,'webhook','c0000000-0000-0000-0000-000000000001','evt-abc'
from public.flows f where f.id = 'f0000000-0000-0000-0000-000000000001';

do $$
declare
  v_rejected boolean := false;
begin
  begin
    insert into public.flow_runs
      (workspace_id, flow_id, version_id, trigger_type, contact_id, idempotency_key)
    select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','f0000000-0000-0000-0000-000000000001',
           f.published_version_id,'webhook','c0000000-0000-0000-0000-000000000001','evt-abc'
    from public.flows f where f.id = 'f0000000-0000-0000-0000-000000000001';
  exception
    when unique_violation then
      v_rejected := true;
  end;

  insert into smoke_checks (label, ok)
  values ('A REDELIVERED trigger produces one run, not two', v_rejected);
end
$$;

-- ---------------------------------------------------------------------------
-- CRITERION 2 — loop protection halts AND explains.
-- ---------------------------------------------------------------------------

insert into smoke_checks (label, ok)
values ('DEPTH within the limit is allowed',
        public.flow_check_loop_protection(
          'f0000000-0000-0000-0000-000000000001', null, 2) is null);

insert into smoke_checks (label, ok) values
  ('CRITERION 2: a self-triggering flow is halted',
   public.flow_check_loop_protection(
     'f0000000-0000-0000-0000-000000000001', null, 4) is not null),
  -- The reason must name the cause, not just say "stopped".
  ('CRITERION 2: the halt explains that the flow triggered itself',
   coalesce(public.flow_check_loop_protection(
     'f0000000-0000-0000-0000-000000000001', null, 4) like '%triggered itself%', false));

-- Two runs already exist today for this contact; the limit is 2.
insert into smoke_checks (label, ok)
values ('PER-CONTACT limit halts with its own reason',
        coalesce(public.flow_check_loop_protection(
          'f0000000-0000-0000-0000-000000000001',
          'c0000000-0000-0000-0000-000000000001', 0) like '%already entered this flow%', false));

-- A halted run cannot be recorded without saying why.
do $$
declare
  v_rejected boolean := false;
begin
  begin
    update public.flow_runs set status = 'halted'
     where id = (select id from run_ref);
  exception
    when check_violation then
      v_rejected := true;
  end;

  insert into smoke_checks (label, ok)
  values ('A HALTED run must record its reason', v_rejected);
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

insert into smoke_checks (label, ok)
select 'CRITERION 5: both steps are logged', coalesce(count(*) = 2, false)
from public.flow_step_runs where run_id = (select id from run_ref);

insert into smoke_checks (label, ok)
select 'CRITERION 5: the success is logged',
       coalesce(count(*) filter (where status = 'succeeded') = 1, false)
from public.flow_step_runs where run_id = (select id from run_ref);

insert into smoke_checks (label, ok)
select 'CRITERION 5: the failure is logged with its error',
       coalesce(count(*) filter (where status = 'failed' and error_code is not null) = 1, false)
from public.flow_step_runs where run_id = (select id from run_ref);

insert into smoke_checks (label, ok)
select 'CRITERION 5: every step records its duration',
       coalesce(count(*) filter (where duration_ms is not null) = 2, false)
from public.flow_step_runs where run_id = (select id from run_ref);

-- Deterministic steps cost nothing; only Hubble steps ever will.
insert into smoke_checks (label, ok)
select 'CRITERION 5: deterministic steps are free',
       coalesce(count(*) filter (where credits_used = 0) = 2, false)
from public.flow_step_runs where run_id = (select id from run_ref);

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 21;
  v_total    integer;
  v_failed   text;
begin
  select count(*),
         string_agg(label, '; ' order by n) filter (where ok is not true)
    into v_total, v_failed
    from smoke_checks;

  -- ⚠️ THE COUNT IS PART OF THE TEST. A check that never ran records nothing,
  -- so it would pass by being absent. Adding or removing a check means
  -- changing this number, on purpose.
  if v_total <> v_expected then
    raise exception 'SMOKE FAILED: expected % checks, recorded %', v_expected, v_total;
  end if;

  if v_failed is not null then
    raise exception 'SMOKE FAILED: %', v_failed;
  end if;

  raise notice 'SMOKE PASSED: % of % checks', v_total, v_expected;
end $$;

rollback;
