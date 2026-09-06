\set ON_ERROR_STOP on
begin;
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

select public.crm_merge_contacts(
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444') as result \gset

\echo '--- merge result ---'
select :'result'::jsonb #>> '{moved}' as moved;
\echo '--- survivor children ---'
select
  (select count(*) from crm_contact_emails where contact_id='33333333-3333-4333-8333-333333333333') as emails,
  (select count(*) from crm_contact_phones where contact_id='33333333-3333-4333-8333-333333333333') as phones,
  (select count(*) from crm_contact_tags   where contact_id='33333333-3333-4333-8333-333333333333') as tags;
\echo '--- loser retired, key released, inherited name ---'
select deleted_at is not null as retired, merged_into_id is not null as points_to_survivor,
       linkedin_identity_key is null as key_released
  from crm_contacts where id='44444444-4444-4444-8444-444444444444';
select linkedin_identity_key from crm_contacts where id='33333333-3333-4333-8333-333333333333';
\echo '--- merge event recorded ---'
select count(*) as events from crm_merge_events;
\echo '--- second merge must fail safely ---'
savepoint s1;
select public.crm_merge_contacts(
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444');
rollback;
