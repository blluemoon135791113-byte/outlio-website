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
-- Run it with:
--   node scripts/rehearse-migration.mjs \
--     supabase/migrations/0125_crm_round_robin_assign.sql \
--     supabase/migrations/smoke/0125_crm_round_robin_assign.smoke.sql

\set ON_ERROR_STOP on

begin;

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
-- ---------------------------------------------------------------------------
select public.crm_round_robin_assign(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'c0000000-0000-4000-8000-000000000001',
  array['11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333']::uuid[]);

select public.crm_round_robin_assign(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'c0000000-0000-4000-8000-000000000002',
  array['11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333']::uuid[]);

select public.crm_round_robin_assign(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'c0000000-0000-4000-8000-000000000003',
  array['11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333']::uuid[]);

select 'three leads, three distinct owners' as check,
       count(distinct owner_user_id) = 3 as ok
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
select 'load is counted per workspace' as check,
       (select owner_user_id
          from public.crm_contacts
         where id = 'c0000000-0000-4000-8000-000000000002')
       = '22222222-2222-2222-2222-222222222222' as ok;

-- ---------------------------------------------------------------------------
-- 3. The fourth lead goes to whoever is level again — everyone now has one, so
--    the tie breaks on pool order and Alex takes it.
-- ---------------------------------------------------------------------------
select public.crm_round_robin_assign(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'c0000000-0000-4000-8000-000000000004',
  array['11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333']::uuid[]);

select 'a tie breaks on pool order' as check,
       (select owner_user_id
          from public.crm_contacts
         where id = 'c0000000-0000-4000-8000-000000000004')
       = '11111111-1111-1111-1111-111111111111' as ok;

-- ---------------------------------------------------------------------------
-- 4. Every assignment wrote its audit row, because the write goes through
--    0123 rather than reimplementing it.
-- ---------------------------------------------------------------------------
select 'four assignments, four OWNER_ASSIGNED activities' as check,
       count(*) = 4 as ok
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

select public.crm_round_robin_assign(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'c0000000-0000-4000-8000-000000000005',
  array['11111111-1111-1111-1111-111111111111',
        '44444444-4444-4444-4444-444444444444']::uuid[]);

select 'a member with no contacts is chosen first' as check,
       (select owner_user_id
          from public.crm_contacts
         where id = 'c0000000-0000-4000-8000-000000000005')
       = '44444444-4444-4444-4444-444444444444' as ok;

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
select public.crm_round_robin_assign(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'c0000000-0000-4000-8000-000000000006',
  array['11111111-1111-1111-1111-111111111111',
        '44444444-4444-4444-4444-444444444444']::uuid[]);

select 'a deleted contact is not load' as check,
       (select owner_user_id
          from public.crm_contacts
         where id = 'c0000000-0000-4000-8000-000000000006')
       = '44444444-4444-4444-4444-444444444444' as ok;

-- ---------------------------------------------------------------------------
-- 7. An empty pool is refused rather than silently assigning nobody.
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

  if not v_raised then
    raise exception 'an empty pool was accepted';
  end if;
end $$;

select 'an empty pool is refused' as check, true as ok;

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

  if not v_raised then
    raise exception 'a cross-tenant contact was assigned';
  end if;
end $$;

select 'a cross-tenant contact is refused' as check, true as ok;

rollback;
