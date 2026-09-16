-- Smoke test for 0125 — does round robin actually spread, and is the decision
-- serialised?
--
-- ⚠️ "APPLIES CLEANLY" DOES NOT PROVE THIS. `check_function_bodies` syntax-checks
-- a plpgsql body; it does not resolve table or column names inside it. A column
-- that does not exist creates the function happily and fails the first time an
-- intake run assigns a lead — at which point the failure is in production, on
-- the path that decides who owns a customer relationship.
--
-- ⚠️ AND "IT ASSIGNED SOMEBODY" DOES NOT PROVE IT EITHER. The broken version
-- assigned somebody too. Every assertion below is about WHICH somebody.
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. These checks used to be printed
-- `select … as ok` rows, and printing `f` failed nothing: check-migration.sh
-- exited 0 regardless. So each check goes into `smoke_checks` through
-- `coalesce(…, false)`, and the gate at the end raises unless exactly the
-- expected number were recorded and every one is true.
--
-- Run it with:
--   scripts/check-migration.sh supabase/migrations/0125_crm_round_robin_assign.sql \
--     supabase/migrations/smoke/0125_crm_round_robin_assign.smoke.sql
-- or against the real database, always rolled back:
--   node scripts/rehearse-migration.mjs \
--     supabase/migrations/0125_crm_round_robin_assign.sql \
--     supabase/migrations/smoke/0125_crm_round_robin_assign.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

-- ---------------------------------------------------------------------------
-- A workspace, three members, and four unassigned leads.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alex@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'sam@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'robin@example.com');

insert into public.workspaces (id, name, owner_user_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Smoke',
        '11111111-1111-1111-1111-111111111111');

insert into public.crm_contacts (id, workspace_id, full_name, owner_user_id) values
  ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lead One',   null),
  ('c0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lead Two',   null),
  ('c0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lead Three', null),
  ('c0000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lead Four',  null);

-- A second workspace, whose contacts must not affect anyone's load here.
insert into public.workspaces (id, name, owner_user_id)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Other',
        '11111111-1111-1111-1111-111111111111');

insert into public.crm_contacts (id, workspace_id, full_name, owner_user_id) values
  ('c0000000-0000-4000-8000-0000000000f1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Other A', '22222222-2222-2222-2222-222222222222'),
  ('c0000000-0000-4000-8000-0000000000f2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Other B', '22222222-2222-2222-2222-222222222222'),
  ('c0000000-0000-4000-8000-0000000000f3', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Other C', '22222222-2222-2222-2222-222222222222');

-- ---------------------------------------------------------------------------
-- 1. Three leads across three idle people must land one each.
--
--    ⚠️ THIS IS THE TEST THE OLD CODE FAILS. Sequential calls in one
--    transaction see each other's writes, so each count reflects the previous
--    assignment — which is precisely what the advisory lock guarantees for
--    calls in SEPARATE transactions. If the function counted nothing, or
--    counted the wrong workspace, all three would go to Alex.
--
--    The calls are `perform`ed rather than selected: a printed jsonb row is
--    not a check, and rehearse-migration.mjs would judge it as one.
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.crm_round_robin_assign(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'c0000000-0000-4000-8000-000000000001',
    array['11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
          '33333333-3333-3333-3333-333333333333']::uuid[]);

  perform public.crm_round_robin_assign(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'c0000000-0000-4000-8000-000000000002',
    array['11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
          '33333333-3333-3333-3333-333333333333']::uuid[]);

  perform public.crm_round_robin_assign(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'c0000000-0000-4000-8000-000000000003',
    array['11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
          '33333333-3333-3333-3333-333333333333']::uuid[]);
end $$;

insert into smoke_checks (label, ok)
select 'three leads, three distinct owners',
       coalesce(count(distinct owner_user_id) = 3, false)
  from public.crm_contacts
 where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and id in ('c0000000-0000-4000-8000-000000000001',
              'c0000000-0000-4000-8000-000000000002',
              'c0000000-0000-4000-8000-000000000003');

-- ---------------------------------------------------------------------------
-- 2. The other workspace's three contacts must not have made Sam look busy.
--    If load were counted across tenants, Sam would have been last rather than
--    second and the ordering above would differ.
-- ---------------------------------------------------------------------------
insert into smoke_checks (label, ok)
values ('load is counted per workspace',
        coalesce((select owner_user_id
                    from public.crm_contacts
                   where id = 'c0000000-0000-4000-8000-000000000002')
                 = '22222222-2222-2222-2222-222222222222', false));

-- ---------------------------------------------------------------------------
-- 3. The fourth lead goes to whoever is level again — everyone now has one, so
--    the tie breaks on pool order and Alex takes it.
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.crm_round_robin_assign(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'c0000000-0000-4000-8000-000000000004',
    array['11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
          '33333333-3333-3333-3333-333333333333']::uuid[]);
end $$;

insert into smoke_checks (label, ok)
values ('a tie breaks on pool order',
        coalesce((select owner_user_id
                    from public.crm_contacts
                   where id = 'c0000000-0000-4000-8000-000000000004')
                 = '11111111-1111-1111-1111-111111111111', false));

-- ---------------------------------------------------------------------------
-- 4. Every assignment wrote its audit row, because the write goes through
--    0123 rather than reimplementing it.
-- ---------------------------------------------------------------------------
insert into smoke_checks (label, ok)
select 'four assignments, four OWNER_ASSIGNED activities',
       coalesce(count(*) = 4, false)
  from public.crm_activities
 where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and activity_type = 'OWNER_ASSIGNED';

-- ---------------------------------------------------------------------------
-- 5. Somebody with no contacts at all is still a candidate.
--
--    ⚠️ AN INNER JOIN WOULD DROP THEM. A brand new joiner has no rows in
--    crm_contacts, so joining load onto the pool the obvious way removes them
--    from the candidate list entirely and they never receive a lead. The
--    function uses `left join` for exactly this.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values ('44444444-4444-4444-4444-444444444444', 'newjoiner@example.com');

insert into public.crm_contacts (id, workspace_id, full_name, owner_user_id)
values ('c0000000-0000-4000-8000-000000000005',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lead Five', null);

do $$
begin
  perform public.crm_round_robin_assign(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'c0000000-0000-4000-8000-000000000005',
    array['11111111-1111-1111-1111-111111111111',
          '44444444-4444-4444-4444-444444444444']::uuid[]);
end $$;

insert into smoke_checks (label, ok)
values ('a member with no contacts is chosen first',
        coalesce((select owner_user_id
                    from public.crm_contacts
                   where id = 'c0000000-0000-4000-8000-000000000005')
                 = '44444444-4444-4444-4444-444444444444', false));

-- ---------------------------------------------------------------------------
-- 6. A deleted contact does not count towards anyone's load.
-- ---------------------------------------------------------------------------
insert into public.crm_contacts (id, workspace_id, full_name, owner_user_id, deleted_at)
values ('c0000000-0000-4000-8000-0000000000d1',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Deleted Lead',
        '44444444-4444-4444-4444-444444444444', now());

insert into public.crm_contacts (id, workspace_id, full_name, owner_user_id)
values ('c0000000-0000-4000-8000-000000000006',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lead Six', null);

-- Alex has 2 live, the new joiner has 1 live + 1 deleted. Counting the deleted
-- one would make them level and hand this to Alex on pool order.
do $$
begin
  perform public.crm_round_robin_assign(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'c0000000-0000-4000-8000-000000000006',
    array['11111111-1111-1111-1111-111111111111',
          '44444444-4444-4444-4444-444444444444']::uuid[]);
end $$;

insert into smoke_checks (label, ok)
values ('a deleted contact is not load',
        coalesce((select owner_user_id
                    from public.crm_contacts
                   where id = 'c0000000-0000-4000-8000-000000000006')
                 = '44444444-4444-4444-4444-444444444444', false));

-- ---------------------------------------------------------------------------
-- 7. An empty pool is refused rather than silently assigning nobody.
--
--    ⚠️ RECORDED INSIDE THE BLOCK. This used to be followed by
--    `select … true as ok`, a check that could not print anything else.
-- ---------------------------------------------------------------------------
do $$
declare
  v_raised boolean := false;
begin
  begin
    perform public.crm_round_robin_assign(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'c0000000-0000-4000-8000-000000000006',
      array[]::uuid[]);
  exception when others then
    v_raised := true;
  end;

  insert into smoke_checks (label, ok)
  values ('an empty pool is refused', coalesce(v_raised, false));
end $$;

-- ---------------------------------------------------------------------------
-- 8. A contact from another workspace is refused — 0123's check, reached
--    through this function.
-- ---------------------------------------------------------------------------
do $$
declare
  v_raised boolean := false;
begin
  begin
    perform public.crm_round_robin_assign(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'c0000000-0000-4000-8000-0000000000f1',  -- lives in the other workspace
      array['11111111-1111-1111-1111-111111111111']::uuid[]);
  exception when others then
    v_raised := true;
  end;

  insert into smoke_checks (label, ok)
  values ('a cross-tenant contact is refused', coalesce(v_raised, false));
end $$;

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 8;
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
