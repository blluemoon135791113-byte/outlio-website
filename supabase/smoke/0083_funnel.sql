-- Proves M4 criterion 4: a batch ties to revenue, and the funnel only narrows.
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. This file used to print values for a
-- person to read — including 'WIDENS — BUG' as a string that exited 0. Each
-- check now goes into `smoke_checks` through `coalesce(…, false)`, and the gate
-- at the end raises unless exactly the expected number were recorded and every
-- one is true.
--
-- Run it with:
--   scripts/check-migration.sh supabase/migrations/0083_crm_funnel.sql \
--     supabase/smoke/0083_funnel.sql

\set ON_ERROR_STOP on
begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111','o@example.com');
insert into public.profiles (id, email) values ('11111111-1111-4111-8111-111111111111','o@example.com');
insert into public.workspaces (id, owner_user_id, name) values
  ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','WS');

-- 5 source rows produced 3 contacts: two rows identified nobody.
insert into public.crm_lead_batches (id, workspace_id, name, source, rows_seen) values
  ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','B','lead_engine',5);

insert into public.crm_contacts (id, workspace_id, full_name, owner_user_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','22222222-2222-4222-8222-222222222222','One','11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','22222222-2222-4222-8222-222222222222','Two','11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','22222222-2222-4222-8222-222222222222','Three',null);

insert into public.crm_batch_members (workspace_id, batch_id, contact_id, created_contact)
select '22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555', id, true
  from public.crm_contacts;

-- Two have an email address.
insert into public.crm_contact_emails (workspace_id, contact_id, address, identity_key, is_primary) values
  ('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','one@x.com','one@x.com',true),
  ('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','two@x.com','two@x.com',true);

-- FOUR emails to TWO people, one reply. The funnel must not widen.
insert into public.crm_activities (workspace_id, activity_type, channel, contact_id, actor_user_id) values
  ('22222222-2222-4222-8222-222222222222','EMAIL_SENT','email','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222','EMAIL_SENT','email','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222','EMAIL_SENT','email','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222','EMAIL_SENT','email','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222','EMAIL_REPLIED','email','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222','CALL_BOOKED','meeting','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111');

insert into public.crm_pipelines (id, workspace_id, name, is_default) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','P',true);
insert into public.crm_pipeline_stages (id, workspace_id, pipeline_id, name, kind, sort_order, default_probability) values
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','New','open',1,40),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2','22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Won','won',2,100);

insert into public.crm_opportunities
  (workspace_id, title, contact_id, owner_user_id, pipeline_id, stage_id, value_amount, probability, status, closed_at)
values
  ('22222222-2222-4222-8222-222222222222','Won deal','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-ccccccccccc2',10000.50,100,'won',now()),
  ('22222222-2222-4222-8222-222222222222','Open deal','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-ccccccccccc1',20000.00,40,'open',null);

-- ===========================================================================
-- ACCEPTANCE 4: batch → revenue, end to end.
-- ===========================================================================
insert into smoke_checks (label, ok) values
  ('ACCEPTANCE 4: 5 rows extracted, 3 canonical contacts, 2 with an email',
   coalesce((select extracted = 5 and canonical = 3 and with_email = 2
               from public.crm_batch_funnel(
                 '22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555')), false)),
  -- 4 emails to 2 people is 2 engaged, not 4.
  ('engagement counts people: 2 engaged, 1 replied',
   coalesce((select engaged = 2 and replied = 1
               from public.crm_batch_funnel(
                 '22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555')), false)),
  ('2 assigned, 1 call booked, 2 opportunities',
   coalesce((select assigned = 2 and call_booked = 1 and opportunities = 2
               from public.crm_batch_funnel(
                 '22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555')), false)),
  ('ACCEPTANCE 4: the batch ties to revenue — 1 won deal worth 10000.50',
   coalesce((select won_deals = 1 and won_revenue = 10000.50
               from public.crm_batch_funnel(
                 '22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555')), false));

-- The funnel NARROWS at every step.
insert into smoke_checks (label, ok)
select 'the funnel narrows at every step',
       coalesce(bool_and(extracted >= canonical and canonical >= with_email
                         and with_email >= replied and replied >= won_deals), false)
from public.crm_batch_funnel(
  '22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555');

-- ===========================================================================
-- Pipeline totals, summed in SQL.
-- ===========================================================================
insert into smoke_checks (label, ok) values
  ('pipeline totals: 1 open deal worth 20000.00',
   coalesce((select open_deals = 1 and open_value = 20000.00
               from public.crm_pipeline_totals('22222222-2222-4222-8222-222222222222')), false)),
  ('weighted forecast = 20000.00 x 40% = 8000',
   coalesce((select weighted_value = 8000
               from public.crm_pipeline_totals('22222222-2222-4222-8222-222222222222')), false)),
  ('pipeline totals: 1 won deal worth 10000.50',
   coalesce((select won_deals = 1 and won_value = 10000.50
               from public.crm_pipeline_totals('22222222-2222-4222-8222-222222222222')), false));

-- Scoped to an owner with nothing.
insert into smoke_checks (label, ok)
values ('scoped to an owner with nothing: 0 open deals, 0 value',
        coalesce((select open_deals = 0 and open_value = 0
                    from public.crm_pipeline_totals(
                      '22222222-2222-4222-8222-222222222222','99999999-9999-4999-8999-999999999999')), false));

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 9;
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
