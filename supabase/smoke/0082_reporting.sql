-- Proves M4 criterion 1: the aggregate equals the raw event counts.
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
  ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','A','99999999-9999-4999-8999-999999999999'),
  ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','B','99999999-9999-4999-8999-999999999999');

-- FOUR emails to TWO people, on one day. The whole point: emails_sent = 4,
-- contacts_emailed = 2.
insert into public.crm_activities
  (workspace_id, activity_type, channel, contact_id, actor_user_id, owner_user_id_at_event, occurred_at)
values
  ('22222222-2222-4222-8222-222222222222','EMAIL_SENT','email','33333333-3333-4333-8333-333333333333','99999999-9999-4999-8999-999999999999','99999999-9999-4999-8999-999999999999','2026-08-20T10:00:00Z'),
  ('22222222-2222-4222-8222-222222222222','EMAIL_SENT','email','33333333-3333-4333-8333-333333333333','99999999-9999-4999-8999-999999999999','99999999-9999-4999-8999-999999999999','2026-08-20T11:00:00Z'),
  ('22222222-2222-4222-8222-222222222222','EMAIL_SENT','email','33333333-3333-4333-8333-333333333333','99999999-9999-4999-8999-999999999999','99999999-9999-4999-8999-999999999999','2026-08-20T12:00:00Z'),
  ('22222222-2222-4222-8222-222222222222','EMAIL_SENT','email','44444444-4444-4444-8444-444444444444','99999999-9999-4999-8999-999999999999','99999999-9999-4999-8999-999999999999','2026-08-20T13:00:00Z'),
  ('22222222-2222-4222-8222-222222222222','EMAIL_REPLIED','email','33333333-3333-4333-8333-333333333333','99999999-9999-4999-8999-999999999999','99999999-9999-4999-8999-999999999999','2026-08-20T14:00:00Z'),
  ('22222222-2222-4222-8222-222222222222','OPENER_SENT','linkedin','44444444-4444-4444-8444-444444444444','99999999-9999-4999-8999-999999999999','99999999-9999-4999-8999-999999999999','2026-08-20T15:00:00Z');

\echo '=== rollup ==='
select public.crm_rollup_activity_metrics(
  '22222222-2222-4222-8222-222222222222','2026-08-19','2026-08-21') as rows_written;

\echo '-- emails_sent counts EVENTS, contacts_emailed counts PEOPLE:'
select metric, count_value from public.crm_reporting_daily
 where basis='actor' and metric in ('emails_sent','contacts_emailed','replies','openers_sent','engagements')
 order by metric;

\echo '-- reply rate = replies / contacts_emailed = 1/2:'
select round(
  (select count_value from public.crm_reporting_daily where basis='actor' and metric='replies')::numeric
  / (select count_value from public.crm_reporting_daily where basis='actor' and metric='contacts_emailed'), 2
) as reply_rate;

\echo '-- workspace totals exist as rows, not as a read-time sum:'
select metric, count_value from public.crm_reporting_daily
 where basis='workspace' and metric in ('emails_sent','contacts_emailed') order by metric;

\echo '=== ACCEPTANCE 1: reconciliation finds nothing ==='
select count(*) as discrepancies from public.crm_reconcile_reporting(
  '22222222-2222-4222-8222-222222222222','2026-08-19','2026-08-21');

\echo '=== a late-arriving event is picked up, not double counted ==='
insert into public.crm_activities
  (workspace_id, activity_type, channel, contact_id, actor_user_id, owner_user_id_at_event, occurred_at)
values ('22222222-2222-4222-8222-222222222222','EMAIL_SENT','email','44444444-4444-4444-8444-444444444444','99999999-9999-4999-8999-999999999999','99999999-9999-4999-8999-999999999999','2026-08-20T16:00:00Z');

select public.crm_rollup_activity_metrics(
  '22222222-2222-4222-8222-222222222222','2026-08-19','2026-08-21');

select metric, count_value from public.crm_reporting_daily
 where basis='actor' and metric in ('emails_sent','contacts_emailed') order by metric;

\echo '-- and still reconciles:'
select count(*) as discrepancies from public.crm_reconcile_reporting(
  '22222222-2222-4222-8222-222222222222','2026-08-19','2026-08-21');

\echo '=== drift is DETECTED, not silently repaired ==='
delete from public.crm_reporting_daily
 where basis='actor' and metric='emails_sent';
select metric, aggregate_value, raw_value
  from public.crm_reconcile_reporting(
    '22222222-2222-4222-8222-222222222222','2026-08-19','2026-08-21');

rollback;
