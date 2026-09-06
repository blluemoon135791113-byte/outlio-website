-- Proves M4 criterion 6: the forecast reconciles with the raw opportunities.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111','a@example.com'),
  ('99999999-9999-4999-8999-999999999999','b@example.com');
insert into public.profiles (id, email) values ('11111111-1111-4111-8111-111111111111','a@example.com');
insert into public.workspaces (id, owner_user_id, name) values
  ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','WS');
insert into public.crm_pipelines (id, workspace_id, name, is_default) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','P',true);
insert into public.crm_pipeline_stages (id, workspace_id, pipeline_id, name, kind, sort_order) values
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','New','open',1),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2','22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Won','won',2),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3','22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Lost','lost',3);

insert into public.crm_opportunities
  (workspace_id, title, owner_user_id, pipeline_id, stage_id, value_amount, probability, status, expected_close_date, closed_at, lost_reason)
values
  -- September: 10,000 @ 50% and 20,000 @ 25% = 5,000 + 5,000 = 10,000 weighted
  ('22222222-2222-4222-8222-222222222222','Sep A','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-ccccccccccc1',10000.00,50,'open','2026-09-15',null,null),
  ('22222222-2222-4222-8222-222222222222','Sep B','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-ccccccccccc1',20000.00,25,'open','2026-09-28',null,null),
  -- October
  ('22222222-2222-4222-8222-222222222222','Oct A','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-ccccccccccc1',40000.00,75,'open','2026-10-10',null,null),
  -- NO expected close date: real pipeline that must not vanish from a forecast
  ('22222222-2222-4222-8222-222222222222','Undated','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-ccccccccccc1',99000.00,10,'open',null,null,null),
  -- Closed deals for the win rate: 2 won, 1 lost
  ('22222222-2222-4222-8222-222222222222','Won 1','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-ccccccccccc2',5000.00,100,'won','2026-08-10','2026-08-10T12:00:00Z',null),
  ('22222222-2222-4222-8222-222222222222','Won 2','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-ccccccccccc2',3000.50,100,'won','2026-08-11','2026-08-11T12:00:00Z',null),
  ('22222222-2222-4222-8222-222222222222','Lost 1','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-ccccccccccc3',7000.00,0,'lost','2026-08-12','2026-08-12T12:00:00Z','Budget');

\echo '=== forecast by close month ==='
select coalesce(period::text,'(undated)') as period, open_deals, open_value, weighted_value
  from public.crm_forecast_by_period('22222222-2222-4222-8222-222222222222');

\echo '-- September weighted = 10000x50% + 20000x25% = 10000.00:'
select weighted_value from public.crm_forecast_by_period('22222222-2222-4222-8222-222222222222')
 where period = '2026-09-01';

\echo '-- ACCEPTANCE 6: forecast reconciles with the raw opportunities:'
select
  (select sum(weighted_value) from public.crm_forecast_by_period('22222222-2222-4222-8222-222222222222')) as from_forecast,
  (select round(sum(value_amount * probability / 100.0), 2) from public.crm_opportunities
     where status='open' and deleted_at is null) as from_raw;

\echo '-- undated pipeline is SHOWN, not dropped:'
select open_value from public.crm_forecast_by_period('22222222-2222-4222-8222-222222222222')
 where period is null;

\echo '=== win rates over CLOSED deals ==='
select won_deals, lost_deals, won_value, win_rate
  from public.crm_win_rates('22222222-2222-4222-8222-222222222222','2026-08-01','2026-08-31');

\echo '-- 2 won of 3 closed = 0.6667, and open deals do not drag it down:'
select case when win_rate = 0.6667 then 'correct ✓' else 'WRONG: ' || win_rate end as check
  from public.crm_win_rates('22222222-2222-4222-8222-222222222222','2026-08-01','2026-08-31');

\echo '-- a period with nothing closed has NO rate, not 0%:'
select count(*) as rows_returned
  from public.crm_win_rates('22222222-2222-4222-8222-222222222222','2026-01-01','2026-01-31');

rollback;
