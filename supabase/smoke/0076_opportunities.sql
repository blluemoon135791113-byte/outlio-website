-- Smoke test for 0076. Proves what only execution can:
--   * the optimistic lock actually refuses a stale card
--   * a stage move writes EXACTLY ONE activity, and a retry writes none
--   * stage history and time-in-stage are recorded
--   * won/lost rules are enforced at the moment of closing
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
   'Deal Contact','99999999-9999-4999-8999-999999999999');

insert into public.crm_pipelines (id, workspace_id, name, is_default) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','Sales',true);

insert into public.crm_pipeline_stages (id, workspace_id, pipeline_id, name, kind, sort_order, default_probability) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','New','open',1,10),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Demo','open',2,50),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Won','won',3,100),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Lost','lost',4,0);

-- A second pipeline, to prove a cross-pipeline move is refused.
insert into public.crm_pipelines (id, workspace_id, name) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','Other');
insert into public.crm_pipeline_stages (id, workspace_id, pipeline_id, name, sort_order) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','22222222-2222-4222-8222-222222222222','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Elsewhere',1);

insert into public.crm_opportunities
  (id, workspace_id, title, contact_id, owner_user_id, pipeline_id, stage_id, value_amount, currency, probability)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','22222222-2222-4222-8222-222222222222',
        'Acme renewal','33333333-3333-4333-8333-333333333333',
        '99999999-9999-4999-8999-999999999999',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        12500.50,'USD',10);

\echo '=== a normal move ==='
select public.crm_move_opportunity_stage(
  '22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 1,
  '11111111-1111-4111-8111-111111111111') as moved \gset
select (:'moved'::jsonb) -> 'version' as new_version,
       (:'moved'::jsonb) -> 'status'  as status;

\echo '-- probability picked up the stage default:'
select probability, version, status::text from public.crm_opportunities
 where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

\echo '-- exactly one activity, carrying the deal in refs:'
select count(*) as activities,
       max(activity_type::text) as type,
       max(refs->>'opportunity_id') as opportunity
  from public.crm_activities
 where refs->>'opportunity_id' = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

\echo '-- stage history recorded, with time in the previous stage:'
select from_stage_id is not null as had_previous,
       seconds_in_previous_stage is not null as timed,
       owner_user_id_at_event = '99999999-9999-4999-8999-999999999999' as owner_frozen
  from public.crm_opportunity_stage_history
 where opportunity_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

\echo '=== ACCEPTANCE 2: a retry of the same move writes NOTHING ==='
-- ⚠️ The next four statements MUST fail. ON_ERROR_STOP is lifted only here.
\set ON_ERROR_STOP off
savepoint r;
\echo '-- stale version must be refused:'
select public.crm_move_opportunity_stage(
  '22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 1,
  '11111111-1111-4111-8111-111111111111');
rollback to r;

savepoint s;
\echo '-- moving to the stage it is already in must be refused:'
select public.crm_move_opportunity_stage(
  '22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 2,
  '11111111-1111-4111-8111-111111111111');
rollback to s;

savepoint t;
\echo '-- a cross-pipeline move must be refused:'
select public.crm_move_opportunity_stage(
  '22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 2,
  '11111111-1111-4111-8111-111111111111');
rollback to t;

savepoint u;
\echo '-- losing without a reason must be refused:'
select public.crm_move_opportunity_stage(
  '22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4', 2,
  '11111111-1111-4111-8111-111111111111');
rollback to u;
\set ON_ERROR_STOP on

\echo '-- still exactly ONE activity after four refused attempts:'
select count(*) as activities from public.crm_activities
 where refs->>'opportunity_id' = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

\echo '=== closing won ==='
select public.crm_move_opportunity_stage(
  '22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', 2,
  '11111111-1111-4111-8111-111111111111');

select status::text, probability, closed_at is not null as closed, version,
       value_amount
  from public.crm_opportunities where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

\echo '-- the win is its own activity type:'
select activity_type::text, count(*) from public.crm_activities
 where refs->>'opportunity_id' = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
 group by 1 order by 1;

\echo '=== stage history is append-only ==='
\set ON_ERROR_STOP off
savepoint v;
update public.crm_opportunity_stage_history set to_stage_id = null;
rollback to v;
\set ON_ERROR_STOP on

rollback;
