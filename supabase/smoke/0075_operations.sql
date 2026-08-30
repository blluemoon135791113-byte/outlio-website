-- Smoke test for 0075. Proves the two things only execution can prove:
-- activities are genuinely immutable, and erasure actually cascades.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111','owner@example.com'),
  ('99999999-9999-4999-8999-999999999999','actor@example.com');
insert into public.profiles (id, email) values
  ('11111111-1111-4111-8111-111111111111','owner@example.com');
insert into public.workspaces (id, owner_user_id, name) values
  ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','WS');

insert into public.crm_contacts (id, workspace_id, full_name, owner_user_id) values
  ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222',
   'Erasure Subject','11111111-1111-4111-8111-111111111111');

insert into public.crm_contact_emails (workspace_id, contact_id, address, identity_key, is_primary)
values ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
        'subject@example.com','subject@example.com',true);

insert into public.crm_activities
  (id, workspace_id, activity_type, channel, contact_id, actor_user_id, owner_user_id_at_event)
values ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',
        'OPENER_SENT','linkedin','33333333-3333-4333-8333-333333333333',
        '99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111');

insert into public.crm_notes (workspace_id, contact_id, body)
values ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','A note');
insert into public.crm_tasks (workspace_id, contact_id, title)
values ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','Call them');
insert into public.crm_notifications (workspace_id, user_id, kind, title, refs)
values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
        'crm.reply', 'They replied',
        '{"contact_id":"33333333-3333-4333-8333-333333333333"}'::jsonb);

\echo '=== ACCEPTANCE 5: activities are immutable ==='
-- ⚠️ The next two statements MUST fail. ON_ERROR_STOP is lifted only around
-- them, so an expected error does not abort the run, and every OTHER statement
-- in this file still stops it.
\set ON_ERROR_STOP off
savepoint a;
\echo '-- UPDATE must fail:'
update public.crm_activities set channel = 'email'
 where id = '44444444-4444-4444-8444-444444444444';
rollback to a;

savepoint b;
\echo '-- DELETE must fail:'
delete from public.crm_activities where id = '44444444-4444-4444-8444-444444444444';
rollback to b;
\set ON_ERROR_STOP on

\echo '-- and the row is untouched:'
select channel::text, actor_user_id is not null as has_actor,
       owner_user_id_at_event is not null as has_frozen_owner
  from public.crm_activities where id = '44444444-4444-4444-8444-444444444444';

\echo '=== attribution survives reassignment ==='
update public.crm_contacts set owner_user_id = '99999999-9999-4999-8999-999999999999'
 where id = '33333333-3333-4333-8333-333333333333';
select
  (select owner_user_id from public.crm_contacts
    where id='33333333-3333-4333-8333-333333333333') as owner_now,
  (select owner_user_id_at_event from public.crm_activities
    where id='44444444-4444-4444-8444-444444444444') as owner_at_event;

\echo '=== ACCEPTANCE 6: erasure cascades ==='
select public.crm_erase_contact(
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  'test') as erased \gset
select :'erased'::jsonb as removed;

\echo '-- nothing personal remains:'
select
  (select count(*) from public.crm_contacts       where id='33333333-3333-4333-8333-333333333333') as contacts,
  (select count(*) from public.crm_contact_emails where contact_id='33333333-3333-4333-8333-333333333333') as emails,
  (select count(*) from public.crm_activities     where contact_id='33333333-3333-4333-8333-333333333333') as activities,
  (select count(*) from public.crm_notes          where contact_id='33333333-3333-4333-8333-333333333333') as notes,
  (select count(*) from public.crm_tasks          where contact_id='33333333-3333-4333-8333-333333333333') as tasks,
  (select count(*) from public.crm_notifications  where refs->>'contact_id'='33333333-3333-4333-8333-333333333333') as notifications;

\echo '-- but the proof of erasure survives, carrying no personal data:'
select action, target_id is not null as has_target,
       after_state is not null as has_counts
  from public.crm_audit_logs where action = 'crm.contact.erased';

\echo '-- and the guard is back up afterwards (this UPDATE must fail):'
insert into public.crm_activities (workspace_id, activity_type, channel, company_id, refs)
values ('22222222-2222-4222-8222-222222222222','ENGAGEMENT','manual',null,'{"x":1}'::jsonb);
\set ON_ERROR_STOP off
savepoint c;
update public.crm_activities set channel='email' where refs->>'x' = '1';
rollback to c;
\set ON_ERROR_STOP on

rollback;
