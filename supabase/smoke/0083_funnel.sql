-- Proves M4 criterion 4: a batch ties to revenue, and the funnel only narrows.
\set ON_ERROR_STOP on
begin;

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

\echo '=== ACCEPTANCE 4: batch → revenue, end to end ==='
select * from public.crm_batch_funnel(
  '22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555');

\echo '-- the funnel NARROWS at every step (4 emails to 2 people is 2 engaged):'
select case
  when extracted >= canonical and canonical >= with_email
   and with_email >= replied and replied >= won_deals
  then 'monotonic ✓' else 'WIDENS — BUG' end as shape
from public.crm_batch_funnel(
  '22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555');

\echo '=== pipeline totals, summed in SQL ==='
select * from public.crm_pipeline_totals('22222222-2222-4222-8222-222222222222');

\echo '-- weighted forecast = 20000.00 x 40% = 8000:'
select weighted_value from public.crm_pipeline_totals('22222222-2222-4222-8222-222222222222');

\echo '-- scoped to an owner with nothing:'
select open_deals, open_value from public.crm_pipeline_totals(
  '22222222-2222-4222-8222-222222222222','99999999-9999-4999-8999-999999999999');

rollback;
