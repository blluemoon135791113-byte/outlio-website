-- Smoke test for 0074 — merging two contacts that are really one person.
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. This file used to print values for a
-- person to read, so a wrong count exited 0. Each check now goes into
-- `smoke_checks` through `coalesce(…, false)`, and the gate at the end raises
-- unless exactly the expected number were recorded and every one is true.
--
-- Run it with:
--   scripts/check-migration.sh supabase/migrations/0074_crm_deduplication.sql \
--     supabase/smoke/0074_merge.sql

\set ON_ERROR_STOP on
begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

-- Two users, one workspace, two contacts that are really one person.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111','a@example.com');
insert into public.profiles (id, email) values
  ('11111111-1111-4111-8111-111111111111','a@example.com');
insert into public.workspaces (id, owner_user_id, name) values
  ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','WS');

insert into public.crm_contacts (id, workspace_id, full_name, linkedin_identity_key)
values ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','Survivor', null),
       ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','Loser','li:in:loser');

insert into public.crm_contact_emails (workspace_id, contact_id, address, identity_key, is_primary) values
  ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','s@x.com','s@x.com',true),
  ('22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444','l@x.com','l@x.com',true);

insert into public.crm_contact_phones (workspace_id, contact_id, raw, e164, is_primary) values
  ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','+14155550100','+14155550100',true),
  ('22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444','+14155550100','+14155550100',true),
  ('22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444','+14155550199','+14155550199',false);

insert into public.crm_tags (id, workspace_id, name, normalized_name) values
  ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','Hot','hot');
insert into public.crm_contact_tags (workspace_id, contact_id, tag_id) values
  ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','55555555-5555-4555-8555-555555555555'),
  ('22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555');

create temp table merge_result as
select public.crm_merge_contacts(
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444') as result;

-- The survivor takes only what it lacks: the loser's email and second phone
-- move; the shared phone and the shared tag are not copied.
insert into smoke_checks (label, ok)
select 'the merge reports 1 email, 1 phone and 0 tags moved',
       coalesce((result #>> '{moved,emails}')::int = 1
                and (result #>> '{moved,phones}')::int = 1
                and (result #>> '{moved,tags}')::int = 0, false)
  from merge_result;

insert into smoke_checks (label, ok)
select 'the survivor has 2 emails', coalesce(count(*) = 2, false)
  from public.crm_contact_emails where contact_id = '33333333-3333-4333-8333-333333333333';

insert into smoke_checks (label, ok)
select 'the survivor has 2 phones, not 3', coalesce(count(*) = 2, false)
  from public.crm_contact_phones where contact_id = '33333333-3333-4333-8333-333333333333';

insert into smoke_checks (label, ok)
select 'the survivor has 1 tag, not 2', coalesce(count(*) = 1, false)
  from public.crm_contact_tags where contact_id = '33333333-3333-4333-8333-333333333333';

-- The loser is retired, points at the survivor, and releases its key, which
-- the survivor inherits.
insert into smoke_checks (label, ok) values
  ('the merged contact is retired',
   coalesce((select deleted_at is not null from public.crm_contacts
              where id = '44444444-4444-4444-8444-444444444444'), false)),
  ('the merged contact points at the survivor',
   coalesce((select merged_into_id = '33333333-3333-4333-8333-333333333333' from public.crm_contacts
              where id = '44444444-4444-4444-8444-444444444444'), false)),
  ('the merged contact released its LinkedIn key',
   coalesce((select linkedin_identity_key is null from public.crm_contacts
              where id = '44444444-4444-4444-8444-444444444444'), false)),
  ('the survivor inherited the LinkedIn key',
   coalesce((select linkedin_identity_key = 'li:in:loser' from public.crm_contacts
              where id = '33333333-3333-4333-8333-333333333333'), false));

insert into smoke_checks (label, ok)
select 'one merge event was recorded', coalesce(count(*) = 1, false)
  from public.crm_merge_events;

-- A second merge of the same pair must fail safely, not repeat.
do $$
declare
  v_refused boolean := false;
begin
  begin
    perform public.crm_merge_contacts(
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444');
  exception
    when check_violation then
      v_refused := true;
  end;

  insert into smoke_checks (label, ok)
  values ('a second merge of an already-merged contact is refused', v_refused);
end $$;

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 10;
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
