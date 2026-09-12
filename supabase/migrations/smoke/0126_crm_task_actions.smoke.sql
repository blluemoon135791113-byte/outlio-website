-- Smoke test for 0126 — complete with outcome, snooze, reassign.
--
-- ⚠️ "APPLIES CLEANLY" PROVES NOTHING ABOUT A PLPGSQL BODY (see 0072). Every
-- function below is executed against real rows.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️ EVERY CHECK IS RECORDED AND GATED, BECAUSE PRINTING `ok` WAS NOT A     ║
-- ║  TEST. Found by breaking the functions on purpose:                        ║
-- ║                                                                           ║
-- ║   • `fn(...) ->> 'reason' = 'stale'` is NULL — not false — when a broken  ║
-- ║     function SUCCEEDS, because there is no `reason` key. Removing the     ║
-- ║     snooze stale check left zero checks reading `f`.                      ║
-- ║   • `scripts/rehearse-migration.mjs` counts a NULL `ok` as a PASS.        ║
-- ║   • `scripts/check-migration.sh` exits 0 even when checks print `f`; it   ║
-- ║     only fails on a SQL error. Seven false checks, exit 0.                ║
-- ║   • A check whose `from … where` matches no rows prints nothing at all,  ║
-- ║     which is indistinguishable from a check that was never written.       ║
-- ║                                                                           ║
-- ║  So each check is inserted into `smoke_checks` through `coalesce(…,       ║
-- ║  false)`, and the final block RAISES — failing the harness run — unless   ║
-- ║  exactly the expected number of checks were recorded and every one is    ║
-- ║  true.                                                                    ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ `now()` IS FROZEN FOR THIS WHOLE TRANSACTION, which is the reason 0126 uses
-- a version counter rather than `updated_at`. Every stale-edit check here works
-- from `version`, and would be vacuous if it used timestamps.
--
-- Run it with:
--   scripts/check-migration.sh supabase/migrations/0126_crm_task_actions.sql \
--     supabase/migrations/smoke/0126_crm_task_actions.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
) on commit drop;

-- ---------------------------------------------------------------------------
-- Two setters, a manager, and someone who is NOT a member.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'setter.one@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'setter.two@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'manager@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'outsider@example.com');

insert into public.workspaces (id, name, owner_user_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Smoke', '33333333-3333-3333-3333-333333333333');

insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'setter'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'setter');

insert into public.crm_contacts (id, workspace_id, full_name, owner_user_id)
values ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Ada Okonkwo', '11111111-1111-1111-1111-111111111111');

-- All open and assigned to setter one unless stated. T1 has NO contact.
insert into public.crm_tasks (id, workspace_id, contact_id, title, assigned_to_user_id, status, created_by) values
  ('7a500000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null,
   'Contactless follow-up', '11111111-1111-1111-1111-111111111111', 'open', '11111111-1111-1111-1111-111111111111'),
  ('7a500000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c0000000-0000-4000-8000-000000000001',
   'Call Ada', '11111111-1111-1111-1111-111111111111', 'open', '11111111-1111-1111-1111-111111111111'),
  ('7a500000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null,
   'Not setter two''s', '11111111-1111-1111-1111-111111111111', 'open', '11111111-1111-1111-1111-111111111111'),
  ('7a500000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null,
   'Snooze me', '11111111-1111-1111-1111-111111111111', 'open', '11111111-1111-1111-1111-111111111111'),
  ('7a500000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null,
   'Hand me over', '11111111-1111-1111-1111-111111111111', 'open', '11111111-1111-1111-1111-111111111111'),
  ('7a500000-0000-4000-8000-000000000007', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null,
   'Stale edit target', '11111111-1111-1111-1111-111111111111', 'open', '11111111-1111-1111-1111-111111111111');

insert into public.crm_tasks (id, workspace_id, title, assigned_to_user_id, status, completed_at, created_by)
values ('7a500000-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Already done', '11111111-1111-1111-1111-111111111111', 'completed', now(),
        '11111111-1111-1111-1111-111111111111');

insert into smoke_checks (label, ok)
select 'existing rows start at version 1', coalesce(bool_and(version = 1), false)
  from public.crm_tasks where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- ---------------------------------------------------------------------------
-- 1. REGRESSION — a task with NO contact completes AND gets its history row.
--    This is the case setTaskDone fails today.
-- ---------------------------------------------------------------------------
insert into smoke_checks (label, ok)
select 'contactless task completes',
       coalesce((public.crm_complete_task(
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7a500000-0000-4000-8000-000000000001',
          '11111111-1111-1111-1111-111111111111', '  Booked a demo  ', 1, null
        ) ->> 'ok') = 'true', false);

insert into smoke_checks (label, ok)
select 'contactless task is completed, outcome trimmed, version bumped',
       coalesce(status = 'completed' and completed_at is not null
                and outcome = 'Booked a demo' and version = 2, false)
  from public.crm_tasks where id = '7a500000-0000-4000-8000-000000000001';

insert into smoke_checks (label, ok)
select 'contactless completion wrote TASK_COMPLETED with refs.task_id',
       count(*) = 1
  from public.crm_activities
 where activity_type = 'TASK_COMPLETED'
   and refs ->> 'task_id' = '7a500000-0000-4000-8000-000000000001'
   and contact_id is null
   and metadata ->> 'outcome' = 'Booked a demo';

-- ---------------------------------------------------------------------------
-- 2. A task WITH a contact freezes the contact's owner onto the event.
-- ---------------------------------------------------------------------------
select public.crm_complete_task(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7a500000-0000-4000-8000-000000000002',
  '11111111-1111-1111-1111-111111111111', null, 1, '11111111-1111-1111-1111-111111111111');

insert into smoke_checks (label, ok)
select 'owner at event is frozen from the contact; blank outcome stored as null',
       coalesce(a.owner_user_id_at_event = '11111111-1111-1111-1111-111111111111'
                and a.contact_id = 'c0000000-0000-4000-8000-000000000001'
                and t.outcome is null, false)
  from public.crm_activities a
  join public.crm_tasks t on t.id = '7a500000-0000-4000-8000-000000000002'
 where a.refs ->> 'task_id' = '7a500000-0000-4000-8000-000000000002'
   and a.activity_type = 'TASK_COMPLETED';

-- ---------------------------------------------------------------------------
-- 3. Refusals return a reason and change NOTHING.
-- ---------------------------------------------------------------------------
insert into smoke_checks (label, ok)
select 'a stale version is refused',
       coalesce(public.crm_complete_task(
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7a500000-0000-4000-8000-000000000003',
         '11111111-1111-1111-1111-111111111111', null, 99, null) ->> 'reason' = 'stale', false);

insert into smoke_checks (label, ok)
select 'another setter''s task reads as not found',
       coalesce(public.crm_complete_task(
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7a500000-0000-4000-8000-000000000003',
         '22222222-2222-2222-2222-222222222222', null, 1,
         '22222222-2222-2222-2222-222222222222') ->> 'reason' = 'not_found', false);

insert into smoke_checks (label, ok)
select 'a task from another workspace reads as not found',
       coalesce(public.crm_complete_task(
         'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '7a500000-0000-4000-8000-000000000003',
         '11111111-1111-1111-1111-111111111111', null, 1, null) ->> 'reason' = 'not_found', false);

insert into smoke_checks (label, ok)
select 'an outcome over 500 characters is refused',
       coalesce(public.crm_complete_task(
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7a500000-0000-4000-8000-000000000003',
         '11111111-1111-1111-1111-111111111111', repeat('x', 501), 1, null) ->> 'reason' = 'invalid_outcome', false);

insert into smoke_checks (label, ok)
select 'completing an already-completed task is not_open',
       coalesce(public.crm_complete_task(
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7a500000-0000-4000-8000-000000000006',
         '11111111-1111-1111-1111-111111111111', null, 1, null) ->> 'reason' = 'not_open', false);

insert into smoke_checks (label, ok)
select 'every refusal left T3 open, unversioned, with no activity',
       coalesce(t.status = 'open' and t.version = 1
                and not exists (select 1 from public.crm_activities
                                 where refs ->> 'task_id' = '7a500000-0000-4000-8000-000000000003'), false)
  from public.crm_tasks t where t.id = '7a500000-0000-4000-8000-000000000003';

insert into smoke_checks (label, ok)
select 'no second TASK_COMPLETED for the already-completed task',
       not exists (select 1 from public.crm_activities
                    where refs ->> 'task_id' = '7a500000-0000-4000-8000-000000000006');

-- ---------------------------------------------------------------------------
-- 4. Snooze.
-- ---------------------------------------------------------------------------
insert into smoke_checks (label, ok)
select 'a snooze into the past is refused',
       coalesce(public.crm_snooze_task(
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7a500000-0000-4000-8000-000000000004',
         '11111111-1111-1111-1111-111111111111', now() - interval '1 hour', 1, null) ->> 'reason' = 'invalid_until', false);

insert into smoke_checks (label, ok)
select 'a snooze beyond a year is refused',
       coalesce(public.crm_snooze_task(
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7a500000-0000-4000-8000-000000000004',
         '11111111-1111-1111-1111-111111111111', now() + interval '366 days', 1, null) ->> 'reason' = 'invalid_until', false);

insert into smoke_checks (label, ok)
select 'a snooze to tomorrow succeeds',
       coalesce(public.crm_snooze_task(
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7a500000-0000-4000-8000-000000000004',
         '11111111-1111-1111-1111-111111111111', now() + interval '1 day', 1,
         '11111111-1111-1111-1111-111111111111') ->> 'ok' = 'true', false);

insert into smoke_checks (label, ok)
select 'snoozed_until set, status still open, due_at untouched, TASK_SNOOZED written',
       coalesce(t.snoozed_until = now() + interval '1 day' and t.status = 'open'
                and t.due_at is null and t.version = 2
                and (select count(*) from public.crm_activities
                      where refs ->> 'task_id' = '7a500000-0000-4000-8000-000000000004'
                        and activity_type = 'TASK_SNOOZED') = 1, false)
  from public.crm_tasks t where t.id = '7a500000-0000-4000-8000-000000000004';

-- ---------------------------------------------------------------------------
-- 5. Reassign.
-- ---------------------------------------------------------------------------
insert into smoke_checks (label, ok)
select 'reassigning to a non-member is refused',
       coalesce(public.crm_reassign_task(
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7a500000-0000-4000-8000-000000000005',
         '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 1) ->> 'reason' = 'not_a_member', false);

insert into smoke_checks (label, ok)
select 'unassigning is refused',
       coalesce(public.crm_reassign_task(
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7a500000-0000-4000-8000-000000000005',
         '33333333-3333-3333-3333-333333333333', null, 1) ->> 'reason' = 'invalid_assignee', false);

insert into smoke_checks (label, ok)
select 'reassigning to a member succeeds',
       coalesce(public.crm_reassign_task(
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7a500000-0000-4000-8000-000000000005',
         '33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 1) ->> 'changed' = 'true', false);

insert into smoke_checks (label, ok)
select 'reassigning to the current assignee is a no-op: no bump, no second activity',
       coalesce((public.crm_reassign_task(
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7a500000-0000-4000-8000-000000000005',
          '33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 2) ->> 'changed') = 'false', false);

insert into smoke_checks (label, ok)
select 'reassignment recorded once, from and to, version 2',
       coalesce(t.assigned_to_user_id = '22222222-2222-2222-2222-222222222222' and t.version = 2
                and (select count(*) from public.crm_activities
                      where refs ->> 'task_id' = '7a500000-0000-4000-8000-000000000005'
                        and activity_type = 'TASK_REASSIGNED'
                        and metadata ->> 'from' = '11111111-1111-1111-1111-111111111111'
                        and metadata ->> 'to'   = '22222222-2222-2222-2222-222222222222') = 1, false)
  from public.crm_tasks t where t.id = '7a500000-0000-4000-8000-000000000005';

/*
 * ⚠️ THE CALL AND THE READ ARE SEPARATE STATEMENTS, AND THEY HAVE TO BE. Every
 * part of one statement reads the snapshot taken when the statement STARTED, so
 * a read in the same `select` as the call cannot see the update the call made.
 */
create temp table reassign_snoozed on commit drop as
select public.crm_reassign_task(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7a500000-0000-4000-8000-000000000004',
  '33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 2) as res;

insert into smoke_checks (label, ok)
select 'reassigning a snoozed task succeeds', coalesce(res ->> 'ok' = 'true', false)
  from reassign_snoozed;

insert into smoke_checks (label, ok)
select 'reassigning clears the previous assignee''s snooze', snoozed_until is null
  from public.crm_tasks where id = '7a500000-0000-4000-8000-000000000004';

-- ---------------------------------------------------------------------------
-- 6. PHASE 4 ACCEPTANCE — "stale UI edit cannot overwrite reassignment".
--    The first person's screen still holds version 1 for T7.
-- ---------------------------------------------------------------------------
select public.crm_reassign_task(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7a500000-0000-4000-8000-000000000007',
  '33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 1);

insert into smoke_checks (label, ok)
select 'a snooze from the pre-reassignment screen is stale',
       coalesce(public.crm_snooze_task(
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7a500000-0000-4000-8000-000000000007',
         '33333333-3333-3333-3333-333333333333', now() + interval '1 day', 1, null) ->> 'reason' = 'stale', false);

insert into smoke_checks (label, ok)
select 'the old assignee can no longer complete it even with a fresh version',
       coalesce(public.crm_complete_task(
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7a500000-0000-4000-8000-000000000007',
         '11111111-1111-1111-1111-111111111111', null, 2,
         '11111111-1111-1111-1111-111111111111') ->> 'reason' = 'not_found', false);

-- ---------------------------------------------------------------------------
-- 7. THE TRIGGER COVERS WRITERS THAT ARE NOT THESE FUNCTIONS.
--    lib/workspaces/handover.ts reassigns with a plain update. An in-function
--    bump would leave the version at 1 here and let the stale edit through.
-- ---------------------------------------------------------------------------
update public.crm_tasks
   set assigned_to_user_id = '22222222-2222-2222-2222-222222222222'
 where id = '7a500000-0000-4000-8000-000000000003';

insert into smoke_checks (label, ok)
select 'a plain bulk-style update bumps the version', version = 2
  from public.crm_tasks where id = '7a500000-0000-4000-8000-000000000003';

-- A writer that sets `version` itself must be overridden, not trusted.
update public.crm_tasks set version = 1, title = 'Forced'
 where id = '7a500000-0000-4000-8000-000000000003';

insert into smoke_checks (label, ok)
select 'forcing version back to 1 still lands on 3', version = 3
  from public.crm_tasks where id = '7a500000-0000-4000-8000-000000000003';

insert into smoke_checks (label, ok)
select 'completing with the version from before that update is stale',
       coalesce(public.crm_complete_task(
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '7a500000-0000-4000-8000-000000000003',
         '33333333-3333-3333-3333-333333333333', null, 1, null) ->> 'reason' = 'stale', false);

-- ---------------------------------------------------------------------------
-- 8. THE REOPEN TRAP. A reopen that forgets the outcome must FAIL.
-- ---------------------------------------------------------------------------
do $$
declare
  v_raised boolean := false;
begin
  begin
    update public.crm_tasks
       set status = 'open', completed_at = null, completed_by = null
     where id = '7a500000-0000-4000-8000-000000000001';
  exception when check_violation then
    v_raised := true;
  end;
  insert into smoke_checks (label, ok) values ('a reopen that keeps its outcome is refused', v_raised);
end $$;

update public.crm_tasks
   set status = 'open', completed_at = null, completed_by = null, outcome = null
 where id = '7a500000-0000-4000-8000-000000000001';

insert into smoke_checks (label, ok)
select 'a reopen that clears the outcome succeeds, and the original event survives',
       coalesce(t.status = 'open' and t.outcome is null
                and (select count(*) from public.crm_activities
                      where refs ->> 'task_id' = '7a500000-0000-4000-8000-000000000001'
                        and activity_type = 'TASK_COMPLETED'
                        and metadata ->> 'outcome' = 'Booked a demo') = 1, false)
  from public.crm_tasks t where t.id = '7a500000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- 9. Nobody but the service role may call these.
-- ---------------------------------------------------------------------------
insert into smoke_checks (label, ok)
select 'authenticated and anon cannot execute any of the three',
       not has_function_privilege('authenticated', 'public.crm_complete_task(uuid,uuid,uuid,text,integer,uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.crm_snooze_task(uuid,uuid,uuid,timestamptz,integer,uuid)', 'execute')
       and not has_function_privilege('authenticated', 'public.crm_reassign_task(uuid,uuid,uuid,uuid,integer)', 'execute')
       and not has_function_privilege('anon', 'public.crm_complete_task(uuid,uuid,uuid,text,integer,uuid)', 'execute');

insert into smoke_checks (label, ok)
select 'service_role can execute all three',
       has_function_privilege('service_role', 'public.crm_complete_task(uuid,uuid,uuid,text,integer,uuid)', 'execute')
       and has_function_privilege('service_role', 'public.crm_snooze_task(uuid,uuid,uuid,timestamptz,integer,uuid)', 'execute')
       and has_function_privilege('service_role', 'public.crm_reassign_task(uuid,uuid,uuid,uuid,integer)', 'execute');

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 32;
  v_total    integer;
  v_failed   text;
begin
  select count(*),
         string_agg(label, '; ' order by n) filter (where ok is not true)
    into v_total, v_failed
    from smoke_checks;

  /*
   * ⚠️ THE COUNT IS PART OF THE TEST. A check whose `from … where` matched no
   * rows inserts nothing, so it would pass by being absent. Adding or removing
   * a check means changing this number, on purpose.
   */
  if v_total <> v_expected then
    raise exception 'SMOKE FAILED: expected % checks, recorded %', v_expected, v_total;
  end if;

  if v_failed is not null then
    raise exception 'SMOKE FAILED: %', v_failed;
  end if;

  raise notice 'SMOKE PASSED: % of % checks', v_total, v_expected;
end $$;

rollback;
