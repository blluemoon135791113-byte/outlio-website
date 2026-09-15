-- Proves the creation event lands, and — just as importantly — that it does
-- NOT land again when the same batch is re-ingested.
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. This file used to print values for a
-- person to read, so a second birth event exited 0. Each check now goes into
-- `smoke_checks` through `coalesce(…, false)`, and the gate at the end raises
-- unless exactly the expected number were recorded and every one is true.
--
-- Run it with:
--   scripts/check-migration.sh supabase/migrations/0081_ingest_contact_created.sql \
--     supabase/smoke/0081_contact_created.sql

\set ON_ERROR_STOP on
begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111','owner@example.com');
insert into public.profiles (id, email) values
  ('11111111-1111-4111-8111-111111111111','owner@example.com');
insert into public.workspaces (id, owner_user_id, name) values
  ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','WS');
insert into public.crm_lead_batches (id, workspace_id, name, source) values
  ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','Batch','lead_engine');

-- ===========================================================================
-- First ingest creates the contact and its first event.
-- ===========================================================================
create temp table first_ingest as
select * from public.crm_ingest_contacts(
  '22222222-2222-4222-8222-222222222222',
  '55555555-5555-4555-8555-555555555555',
  '[{"ref":"1","full_name":"New Person","owner_user_id":"11111111-1111-4111-8111-111111111111","source":"lead_engine","emails":[{"address":"new@example.com","identity_key":"new@example.com"}]}]'::jsonb
);

insert into smoke_checks (label, ok)
select 'the first ingest creates the contact', coalesce(count(*) = 1 and bool_and(created), false)
  from first_ingest;

insert into smoke_checks (label, ok)
select 'the first ingest writes exactly one CONTACT_CREATED activity on the system channel',
       coalesce(count(*) = 1
                and bool_and(activity_type::text = 'CONTACT_CREATED' and channel::text = 'system'), false)
  from public.crm_activities;

insert into smoke_checks (label, ok)
select 'the creation event freezes the owner and links the batch',
       coalesce(bool_and(owner_user_id_at_event = '11111111-1111-4111-8111-111111111111'
                         and refs->>'batch_id' = '55555555-5555-4555-8555-555555555555'), false)
  from public.crm_activities;

-- ===========================================================================
-- RE-INGESTING MUST NOT MANUFACTURE A SECOND BIRTH.
-- ===========================================================================
create temp table second_ingest as
select * from public.crm_ingest_contacts(
  '22222222-2222-4222-8222-222222222222',
  '55555555-5555-4555-8555-555555555555',
  '[{"ref":"1","full_name":"New Person","owner_user_id":"11111111-1111-4111-8111-111111111111","source":"lead_engine","emails":[{"address":"new@example.com","identity_key":"new@example.com"}]}]'::jsonb
);

insert into smoke_checks (label, ok)
select 're-ingesting matches the existing contact instead of creating one',
       coalesce(count(*) = 1 and bool_and(not created), false)
  from second_ingest;

insert into smoke_checks (label, ok)
select 'still exactly one CONTACT_CREATED event', coalesce(count(*) = 1, false)
  from public.crm_activities
 where activity_type = 'CONTACT_CREATED';

insert into smoke_checks (label, ok)
select 'still exactly one contact', coalesce(count(*) = 1, false)
  from public.crm_contacts;

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 6;
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
