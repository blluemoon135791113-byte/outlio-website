-- Smoke test for 0079. The risk here is the new enum value: a migration can
-- ADD it and create a function that names it, and still fail the first time
-- the function actually runs.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111','owner@example.com'),
  ('99999999-9999-4999-8999-999999999999','setter@example.com');
insert into public.profiles (id, email) values
  ('11111111-1111-4111-8111-111111111111','owner@example.com');
insert into public.workspaces (id, owner_user_id, name) values
  ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','WS');

insert into public.crm_contacts (id, workspace_id, full_name, owner_user_id) values
  ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222',
   'Contested Prospect','99999999-9999-4999-8999-999999999999');

\echo '=== defaults apply with no settings row ==='
select
  coalesce((select contact_mode::text from public.crm_collision_settings
             where workspace_id='22222222-2222-4222-8222-222222222222'), 'warn (default)') as contact_mode;

\echo '=== the new enum value is usable at runtime ==='
select public.crm_record_collision_override(
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  'Existing relationship, agreed with owner') as activity_id \gset

\echo '-- an activity naming the owner who was stepped over:'
select activity_type::text, channel::text,
       actor_user_id = '11111111-1111-4111-8111-111111111111' as by_the_overrider,
       owner_user_id_at_event = '99999999-9999-4999-8999-999999999999' as over_the_owner,
       metadata->>'reason' as reason
  from public.crm_activities where id = :'activity_id'::uuid;

\echo '-- AND an audit row, in the same transaction:'
select action, target_id = '33333333-3333-4333-8333-333333333333' as targets_contact,
       reason is not null as has_reason
  from public.crm_audit_logs where action = 'crm.collision.override';

\echo '=== one open reassignment request per person ==='
insert into public.crm_reassignment_requests
  (workspace_id, contact_id, requested_by, current_owner_user_id, note)
values ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111','99999999-9999-4999-8999-999999999999','Please');

\set ON_ERROR_STOP off
savepoint a;
\echo '-- asking twice must be refused:'
insert into public.crm_reassignment_requests
  (workspace_id, contact_id, requested_by, current_owner_user_id)
values ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111','99999999-9999-4999-8999-999999999999');
rollback to a;

savepoint b;
\echo '-- a resolved request with no timestamp must be refused:'
update public.crm_reassignment_requests set status = 'approved';
rollback to b;
\set ON_ERROR_STOP on

\echo '-- resolving properly works, and frees the slot:'
update public.crm_reassignment_requests
   set status='declined', resolved_at=now(), resolved_by='99999999-9999-4999-8999-999999999999';
insert into public.crm_reassignment_requests
  (workspace_id, contact_id, requested_by, current_owner_user_id)
values ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111','99999999-9999-4999-8999-999999999999');
select count(*) as requests from public.crm_reassignment_requests;

rollback;
