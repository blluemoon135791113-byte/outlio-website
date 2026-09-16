-- Proves M4 criterion 6: the forecast reconciles with the raw opportunities.
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. This file used to print values for a
-- person to read — including 'WRONG: …' as a string that exited 0. Each check
-- now goes into `smoke_checks` through `coalesce(…, false)`, and the gate at the
-- end raises unless exactly the expected number were recorded and every one is
-- true.
--
-- Run it with:
--   scripts/check-migration.sh supabase/migrations/0084_crm_forecast.sql \
--     supabase/smoke/0084_forecast.sql

\set ON_ERROR_STOP on
begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

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

-- ===========================================================================
-- Forecast by close month.
-- ===========================================================================
insert into smoke_checks (label, ok) values
  ('September: 2 open deals worth 30000.00',
   coalesce((select open_deals = 2 and open_value = 30000.00
               from public.crm_forecast_by_period('22222222-2222-4222-8222-222222222222')
              where period = '2026-09-01'), false)),
  ('September weighted = 10000x50% + 20000x25% = 10000.00',
   coalesce((select weighted_value = 10000.00
               from public.crm_forecast_by_period('22222222-2222-4222-8222-222222222222')
              where period = '2026-09-01'), false)),
  ('October: 1 open deal worth 40000.00, weighted 30000.00',
   coalesce((select open_deals = 1 and open_value = 40000.00 and weighted_value = 30000.00
               from public.crm_forecast_by_period('22222222-2222-4222-8222-222222222222')
              where period = '2026-10-01'), false));

-- ACCEPTANCE 6: the forecast reconciles with the raw opportunities.
insert into smoke_checks (label, ok)
values ('ACCEPTANCE 6: the forecast total equals the raw weighted sum',
        coalesce(
          (select sum(weighted_value) from public.crm_forecast_by_period('22222222-2222-4222-8222-222222222222'))
          = (select round(sum(value_amount * probability / 100.0), 2) from public.crm_opportunities
              where status = 'open' and deleted_at is null), false));

-- Undated pipeline is SHOWN, not dropped.
insert into smoke_checks (label, ok)
values ('undated pipeline is shown, not dropped: 99000.00',
        coalesce((select open_value = 99000.00
                    from public.crm_forecast_by_period('22222222-2222-4222-8222-222222222222')
                   where period is null), false));

-- ===========================================================================
-- Win rates over CLOSED deals.
-- ===========================================================================
insert into smoke_checks (label, ok) values
  ('win rate: 2 won of 3 closed = 0.6667, and open deals do not drag it down',
   coalesce((select win_rate = 0.6667
               from public.crm_win_rates('22222222-2222-4222-8222-222222222222','2026-08-01','2026-08-31')), false)),
  ('win rates count 2 won and 1 lost, with 8000.50 won',
   coalesce((select won_deals = 2 and lost_deals = 1 and won_value = 8000.50
               from public.crm_win_rates('22222222-2222-4222-8222-222222222222','2026-08-01','2026-08-31')), false));

-- A period with nothing closed has NO rate, not 0%.
insert into smoke_checks (label, ok)
select 'a period with nothing closed returns no rate, not 0%', coalesce(count(*) = 0, false)
  from public.crm_win_rates('22222222-2222-4222-8222-222222222222','2026-01-01','2026-01-31');

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 8;
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
