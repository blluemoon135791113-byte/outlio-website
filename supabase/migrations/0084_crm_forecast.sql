-- 0084 — sales forecasting (M4 Phase 10.5)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  FULLY DETERMINISTIC. ZERO CREDITS.                                       ║
-- ║                                                                           ║
-- ║  A forecast is arithmetic over deals a human entered: value × probability ║
-- ║  grouped by close period, and won ÷ closed for a win rate. No model, no   ║
-- ║  inference, nothing metered.                                             ║
-- ║                                                                           ║
-- ║  The brief allows OPTIONAL Hubble commentary on top, clearly labelled as  ║
-- ║  credit-consuming. That is commentary ABOUT these numbers and must never  ║
-- ║  become the source of them: a forecast a customer cannot reproduce by     ║
-- ║  hand is one they cannot argue with, and a forecast is exactly the thing  ║
-- ║  people need to argue with.                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- ---------------------------------------------------------------------------
-- crm_forecast_by_period
--
-- Weighted and unweighted pipeline, grouped by the month a deal is expected to
-- close.
--
-- ⚠️ DEALS WITH NO EXPECTED CLOSE DATE ARE RETURNED UNDER A NULL PERIOD, not
-- dropped and not silently bucketed into "this month". They are real pipeline
-- and their absence from a forecast is itself the finding — a rep with
-- £400,000 of undated deals has a forecasting problem the report should show,
-- not hide.
-- ---------------------------------------------------------------------------

create or replace function public.crm_forecast_by_period(
  p_workspace_id  uuid,
  p_owner_user_id uuid default null
)
returns table (
  period          date,
  open_deals      bigint,
  open_value      numeric,
  weighted_value  numeric
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    /* Month grain. A quarter is a sum of months; storing both would let them
       disagree, the same reasoning as the day grain in 0082. NULL is the
       undated bucket. */
    date_trunc('month', o.expected_close_date)::date as period,
    count(*),
    coalesce(sum(o.value_amount), 0),
    round(coalesce(sum(o.value_amount * o.probability / 100.0), 0), 2)
  from public.crm_opportunities o
  where o.workspace_id = p_workspace_id
    and o.status = 'open'
    and o.deleted_at is null
    and (p_owner_user_id is null or o.owner_user_id = p_owner_user_id)
  group by 1
  -- NULLS LAST so the undated bucket sits at the end rather than above the
  -- next month, where it would read as overdue.
  order by 1 nulls last;
$$;

revoke all on function public.crm_forecast_by_period(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- crm_win_rates
--
-- Historical win rate per owner, over deals CLOSED in the period.
--
-- ⚠️ BUCKETED BY `closed_at`, NOT `created_at`. A win rate is about deals that
-- finished in the window; counting deals that STARTED in it would mean this
-- quarter's rate kept changing for months as those deals closed.
--
-- ⚠️ OPEN DEALS ARE EXCLUDED ENTIRELY. Counting them as not-yet-won drags every
-- rate towards zero and makes a healthy pipeline look like failure.
-- ---------------------------------------------------------------------------

create or replace function public.crm_win_rates(
  p_workspace_id uuid,
  p_from_day     date,
  p_to_day       date
)
returns table (
  owner_user_id uuid,
  won_deals     bigint,
  lost_deals    bigint,
  won_value     numeric,
  win_rate      numeric
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    o.owner_user_id,
    count(*) filter (where o.status = 'won'),
    count(*) filter (where o.status = 'lost'),
    coalesce(sum(o.value_amount) filter (where o.status = 'won'), 0),
    /* NULL, not zero, when nothing closed. A rep who closed nothing has no
       win rate; reporting 0% says they lost everything they touched. */
    case
      when count(*) = 0 then null
      else round(count(*) filter (where o.status = 'won')::numeric / count(*), 4)
    end
  from public.crm_opportunities o
  where o.workspace_id = p_workspace_id
    and o.deleted_at is null
    and o.status in ('won', 'lost')
    and o.closed_at is not null
    and (o.closed_at at time zone 'UTC')::date between p_from_day and p_to_day
  group by o.owner_user_id;
$$;

revoke all on function public.crm_win_rates(uuid, date, date)
  from public, anon, authenticated;

comment on function public.crm_forecast_by_period(uuid, uuid) is
  'Deterministic weighted forecast by close month. Undated deals are returned '
  'under a NULL period rather than dropped — a rep with a large undated '
  'pipeline has a problem the report should show, not hide.';

comment on function public.crm_win_rates(uuid, date, date) is
  'Win rate over deals CLOSED in the period. Open deals are excluded: counting '
  'them as not-yet-won drags every rate towards zero.';
