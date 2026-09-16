-- Proves M4 criterion 1: the aggregate equals the raw event counts.
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. This file used to print values for a
-- person to read, so a wrong count or a discrepancy exited 0. Each check now
-- goes into `smoke_checks` through `coalesce(…, false)`, and the gate at the
-- end raises unless exactly the expected number were recorded and every one is
-- true.
--
-- Run it with:
--   scripts/check-migration.sh supabase/migrations/0082_reporting_aggregates.sql \
--     supabase/smoke/0082_reporting.sql

\set ON_ERROR_STOP on
begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

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

-- ===========================================================================
-- Rollup.
-- ===========================================================================
do $$
begin
  perform public.crm_rollup_activity_metrics(
    '22222222-2222-4222-8222-222222222222','2026-08-19','2026-08-21');
end $$;

-- emails_sent counts EVENTS, contacts_emailed counts PEOPLE.
insert into smoke_checks (label, ok) values
  ('emails_sent counts EVENTS: 4',
   coalesce((select count_value = 4 from public.crm_reporting_daily
              where basis = 'actor' and metric = 'emails_sent'), false)),
  ('contacts_emailed counts PEOPLE: 2',
   coalesce((select count_value = 2 from public.crm_reporting_daily
              where basis = 'actor' and metric = 'contacts_emailed'), false)),
  ('replies: 1',
   coalesce((select count_value = 1 from public.crm_reporting_daily
              where basis = 'actor' and metric = 'replies'), false)),
  ('openers_sent: 1',
   coalesce((select count_value = 1 from public.crm_reporting_daily
              where basis = 'actor' and metric = 'openers_sent'), false)),
  ('engagements: 1',
   coalesce((select count_value = 1 from public.crm_reporting_daily
              where basis = 'actor' and metric = 'engagements'), false));

-- Reply rate = replies / contacts_emailed = 1/2.
insert into smoke_checks (label, ok)
values ('reply rate = replies / contacts_emailed = 0.50',
        coalesce(round(
          (select count_value from public.crm_reporting_daily where basis = 'actor' and metric = 'replies')::numeric
          / (select count_value from public.crm_reporting_daily where basis = 'actor' and metric = 'contacts_emailed'), 2
        ) = 0.50, false));

-- Workspace totals exist as rows, not as a read-time sum.
insert into smoke_checks (label, ok) values
  ('a workspace total row exists for emails_sent: 4',
   coalesce((select count_value = 4 from public.crm_reporting_daily
              where basis = 'workspace' and metric = 'emails_sent'), false)),
  ('a workspace total row exists for contacts_emailed: 2',
   coalesce((select count_value = 2 from public.crm_reporting_daily
              where basis = 'workspace' and metric = 'contacts_emailed'), false));

-- ===========================================================================
-- ACCEPTANCE 1: reconciliation finds nothing.
-- ===========================================================================
insert into smoke_checks (label, ok)
select 'ACCEPTANCE 1: reconciliation finds no discrepancies', coalesce(count(*) = 0, false)
  from public.crm_reconcile_reporting(
    '22222222-2222-4222-8222-222222222222','2026-08-19','2026-08-21');

-- ===========================================================================
-- A late-arriving event is picked up, not double counted.
-- ===========================================================================
insert into public.crm_activities
  (workspace_id, activity_type, channel, contact_id, actor_user_id, owner_user_id_at_event, occurred_at)
values ('22222222-2222-4222-8222-222222222222','EMAIL_SENT','email','44444444-4444-4444-8444-444444444444','99999999-9999-4999-8999-999999999999','99999999-9999-4999-8999-999999999999','2026-08-20T16:00:00Z');

do $$
begin
  perform public.crm_rollup_activity_metrics(
    '22222222-2222-4222-8222-222222222222','2026-08-19','2026-08-21');
end $$;

insert into smoke_checks (label, ok) values
  ('a late event is picked up: emails_sent is now 5, not 4 or 9',
   coalesce((select count_value = 5 from public.crm_reporting_daily
              where basis = 'actor' and metric = 'emails_sent'), false)),
  ('a late email to someone already emailed leaves contacts_emailed at 2',
   coalesce((select count_value = 2 from public.crm_reporting_daily
              where basis = 'actor' and metric = 'contacts_emailed'), false));

insert into smoke_checks (label, ok)
select 'the rollup still reconciles after a late event', coalesce(count(*) = 0, false)
  from public.crm_reconcile_reporting(
    '22222222-2222-4222-8222-222222222222','2026-08-19','2026-08-21');

-- ===========================================================================
-- Drift is DETECTED, not silently repaired.
-- ===========================================================================
delete from public.crm_reporting_daily
 where basis='actor' and metric='emails_sent';

insert into smoke_checks (label, ok)
select 'drift is detected: emails_sent aggregate 0 against raw 5',
       coalesce(count(*) = 1
                and bool_and(metric = 'emails_sent' and aggregate_value = 0 and raw_value = 5), false)
  from public.crm_reconcile_reporting(
    '22222222-2222-4222-8222-222222222222','2026-08-19','2026-08-21');

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 13;
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
