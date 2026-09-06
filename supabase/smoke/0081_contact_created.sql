-- Proves the creation event lands, and — just as importantly — that it does
-- NOT land again when the same batch is re-ingested.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111','owner@example.com');
insert into public.profiles (id, email) values
  ('11111111-1111-4111-8111-111111111111','owner@example.com');
insert into public.workspaces (id, owner_user_id, name) values
  ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','WS');
insert into public.crm_lead_batches (id, workspace_id, name, source) values
  ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','Batch','lead_engine');

\echo '=== first ingest creates the contact and its first event ==='
select * from public.crm_ingest_contacts(
  '22222222-2222-4222-8222-222222222222',
  '55555555-5555-4555-8555-555555555555',
  '[{"ref":"1","full_name":"New Person","owner_user_id":"11111111-1111-4111-8111-111111111111","source":"lead_engine","emails":[{"address":"new@example.com","identity_key":"new@example.com"}]}]'::jsonb
);

select activity_type::text, channel::text,
       owner_user_id_at_event = '11111111-1111-4111-8111-111111111111' as owner_frozen,
       refs->>'batch_id' = '55555555-5555-4555-8555-555555555555' as links_batch
  from public.crm_activities;

\echo '=== RE-INGESTING MUST NOT MANUFACTURE A SECOND BIRTH ==='
select * from public.crm_ingest_contacts(
  '22222222-2222-4222-8222-222222222222',
  '55555555-5555-4555-8555-555555555555',
  '[{"ref":"1","full_name":"New Person","owner_user_id":"11111111-1111-4111-8111-111111111111","source":"lead_engine","emails":[{"address":"new@example.com","identity_key":"new@example.com"}]}]'::jsonb
);

select count(*) as created_events from public.crm_activities
 where activity_type = 'CONTACT_CREATED';
select count(*) as contacts from public.crm_contacts;

rollback;
