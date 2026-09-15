-- Smoke test for 0124 — does the composite FK actually refuse a cross-tenant deal?
--
-- ⚠️ "APPLIES CLEANLY" PROVES ALMOST NOTHING HERE. An `alter table ... add
-- column` that creates a plain nullable column looks identical, in the apply
-- log, to one whose constraint was never created — `add constraint` inside a
-- DO block is skipped silently when the guard is wrong. The property worth
-- having is that a task CANNOT point at another workspace's deal, and the only
-- way to know is to try it.
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. Each check goes into `smoke_checks`
-- through `coalesce(…, false)`, and the gate at the end raises unless exactly
-- the expected number were recorded and every one is true — a raise that a
-- NULL comparison skips is not a check.
--
-- Run it with:
--   scripts/check-migration.sh supabase/migrations/0124_crm_tasks_opportunity.sql \
--     supabase/migrations/smoke/0124_crm_tasks_opportunity.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

-- ---------------------------------------------------------------------------
-- Two workspaces, each with a pipeline, a stage and a deal. Two is the whole
-- point: one workspace cannot demonstrate a tenancy boundary.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'owner-b@example.com');

insert into public.workspaces (id, name, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Workspace A', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Workspace B', '22222222-2222-2222-2222-222222222222');

insert into public.crm_pipelines (id, workspace_id, name) values
  ('aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Sales A'),
  ('bbbbbbbb-1111-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'Sales B');

insert into public.crm_pipeline_stages (id, workspace_id, pipeline_id, name, kind, sort_order) values
  ('aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-1111-0000-0000-000000000001', 'New', 'open', 1),
  ('bbbbbbbb-2222-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-1111-0000-0000-000000000002', 'New', 'open', 1);

insert into public.crm_opportunities (id, workspace_id, pipeline_id, stage_id, title) values
  ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-000000000001', 'Deal in A'),
  ('bbbbbbbb-3333-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-1111-0000-0000-000000000002', 'bbbbbbbb-2222-0000-0000-000000000002', 'Deal in B');

-- ---------------------------------------------------------------------------
-- 1. A task in A may link to A's deal.
-- ---------------------------------------------------------------------------
insert into public.crm_tasks (id, workspace_id, title, opportunity_id)
values ('aaaaaaaa-4444-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001',
        'Send the proposal',
        'aaaaaaaa-3333-0000-0000-000000000001');

insert into smoke_checks (label, ok)
select 'a task in the same workspace links to its deal', coalesce(count(*) = 1, false)
  from public.crm_tasks
 where opportunity_id = 'aaaaaaaa-3333-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- 2. ⚠️ THE POINT OF THE COMPOSITE KEY. A task in A must NOT be able to name
--    B's deal. Without `workspace_id` in the foreign key this insert succeeds,
--    and one workspace's task list quietly references another's pipeline.
-- ---------------------------------------------------------------------------
do $$
declare v_refused boolean := false;
begin
  begin
    insert into public.crm_tasks (workspace_id, title, opportunity_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            'Cross-tenant task',
            'bbbbbbbb-3333-0000-0000-000000000002');
  exception when foreign_key_violation then
    v_refused := true;
  end;

  insert into smoke_checks (label, ok)
  values ('a task in workspace A cannot link to a deal in workspace B',
          coalesce(v_refused, false));
end $$;

-- ---------------------------------------------------------------------------
-- 3. NULL stays legal. Most tasks are about a person, not a deal, and every
--    task that exists today has no deal at all — a NOT NULL column here would
--    have made this migration unappliable.
-- ---------------------------------------------------------------------------
insert into public.crm_tasks (workspace_id, title, opportunity_id)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Call them back', null);

-- ---------------------------------------------------------------------------
-- 4. Deleting the deal takes its tasks with it, as it does for a contact.
-- ---------------------------------------------------------------------------
delete from public.crm_opportunities
 where id = 'aaaaaaaa-3333-0000-0000-000000000001';

insert into smoke_checks (label, ok)
select 'the task is deleted with its deal', coalesce(count(*) = 0, false)
  from public.crm_tasks
 where id = 'aaaaaaaa-4444-0000-0000-000000000001';

-- The deal-less task is untouched: the cascade must not be a table sweep.
insert into smoke_checks (label, ok)
select 'the cascade leaves the task that had no deal', coalesce(count(*) = 1, false)
  from public.crm_tasks
 where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and opportunity_id is null;

-- ---------------------------------------------------------------------------
-- 5. The index exists. A partial index that was never created is invisible
--    until somebody profiles the query it was meant to serve.
-- ---------------------------------------------------------------------------
insert into smoke_checks (label, ok)
values ('crm_tasks_opportunity_idx was created',
        exists (select 1 from pg_indexes
                 where schemaname = 'public' and indexname = 'crm_tasks_opportunity_idx'));

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 5;
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
