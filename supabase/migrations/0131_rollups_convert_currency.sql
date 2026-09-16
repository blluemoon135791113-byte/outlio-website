-- ---------------------------------------------------------------------------
-- 0131 — The rollups convert, instead of adding currencies together.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  0130 GAVE EVERY DEAL A CONVERTED AMOUNT. NOTHING READ IT.                ║
-- ║                                                                           ║
-- ║  Eight `sum(o.value_amount)` sites across 0082, 0083 and 0084 added raw    ║
-- ║  amounts across currencies: a $10,000 deal and a €10,000 deal summed to    ║
-- ║  20,000, a number that is not money in any currency, with nothing          ║
-- ║  erroring. This switches all eight to `value_amount_base`.                ║
-- ║                                                                           ║
-- ║  ⚠️ NULL IS WHY THIS IS SAFE. `value_amount_base` is NULL when the rate    ║
-- ║  is unknown, and `sum()` skips NULLs — so an unconvertible deal DROPS OUT  ║
-- ║  of the total instead of being added at face value in the wrong currency.  ║
-- ║  It drops out visibly: `crm_unconvertible_deals()` (0130) counts exactly   ║
-- ║  those rows, so a screen can say how many a total left out.               ║
-- ║                                                                           ║
-- ║  ⚠️ TODAY THIS CHANGES NO NUMBER. Every deal is the workspace currency, so ║
-- ║  its rate is 1 and `value_amount_base = value_amount` for every row. The   ║
-- ║  conversion path is exercised by real data from the day it ships rather    ║
-- ║  than switched on for the first time when a non-USD deal appears.         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ THE BODIES BELOW ARE COPIED VERBATIM FROM 0082/0083/0084. The ONLY edit
-- is `sum(o.value_amount` -> `sum(o.value_amount_base`, applied mechanically,
-- eight times. Retyping a reporting function from memory is how a rollup
-- quietly starts measuring something else.
-- ---------------------------------------------------------------------------

-- From 0082 — 1 substitution(s).
create or replace function public.crm_rollup_activity_metrics(
  p_workspace_id uuid,
  p_from_day     date,
  p_to_day       date
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer := 0;
begin
  if p_to_day < p_from_day then
    raise exception 'crm_rollup_activity_metrics: to_day precedes from_day'
      using errcode = 'check_violation';
  end if;

  delete from public.crm_reporting_daily
   where workspace_id = p_workspace_id
     and day between p_from_day and p_to_day;

  -- ---- work, credited to the ACTOR ---------------------------------------
  with events as (
    select
      (a.occurred_at at time zone 'UTC')::date as day,
      a.actor_user_id,
      a.activity_type,
      a.contact_id
    from public.crm_activities a
    where a.workspace_id = p_workspace_id
      and (a.occurred_at at time zone 'UTC')::date between p_from_day and p_to_day
  ),
  counted as (
    select day, actor_user_id as user_id, metric, count(*) as n
      from (
        select day, actor_user_id,
               case
                 when activity_type = 'OPENER_SENT'      then 'openers_sent'
                 when activity_type = 'PERSONALIZED_DM'  then 'personalized_dms'
                 when activity_type = 'FOLLOW_UP'        then 'follow_ups'
                 when activity_type = 'EMAIL_SENT'       then 'emails_sent'
                 when activity_type = 'CALL_BOOKED'      then 'calls_booked'
                 when activity_type = 'CALL_HELD'        then 'calls_held'
                 when activity_type = 'TASK_COMPLETED'   then 'tasks_completed'
                 when activity_type = 'CONTACT_CREATED'  then 'contacts_created'
               end as metric
          from events
      ) m
     where metric is not null
     group by day, actor_user_id, metric
  ),
  -- Engagements are a UNION of four types, so they are counted separately
  -- rather than squeezed into the CASE above.
  engagements as (
    select day, actor_user_id as user_id, 'engagements' as metric, count(*) as n
      from events
     where activity_type in ('ENGAGEMENT', 'OPENER_SENT', 'PERSONALIZED_DM', 'FOLLOW_UP')
     group by day, actor_user_id
  ),
  -- ⚠️ DISTINCT CONTACTS, per Ledger §20. Four emails to one person is one
  -- contact emailed, and using the event count here is what makes a reply rate
  -- look like a quarter of what it is.
  distinct_contacts as (
    select day, actor_user_id as user_id, metric, count(distinct contact_id) as n
      from (
        select day, actor_user_id, contact_id,
               case
                 when activity_type = 'EMAIL_SENT'    then 'contacts_emailed'
                 when activity_type = 'EMAIL_REPLIED' then 'replies'
                 when activity_type = 'QUALIFIED'     then 'qualified'
               end as metric
          from events
         where contact_id is not null
      ) m
     where metric is not null
     group by day, actor_user_id, metric
  ),
  all_rows as (
    select * from counted
    union all select * from engagements
    union all select * from distinct_contacts
  ),
  written as (
    insert into public.crm_reporting_daily
      (workspace_id, day, user_id, basis, metric, count_value)
    select p_workspace_id, day, user_id, 'actor', metric, n
      from all_rows
    returning 1
  )
  select count(*) into v_rows from written;

  -- ---- outcomes, credited to the OWNER AT EVENT TIME ----------------------
  -- ⚠️ owner_user_id_at_event, never the contact's CURRENT owner. This is the
  -- column that makes last quarter's numbers stay still when a book moves.
  with owned as (
    insert into public.crm_reporting_daily
      (workspace_id, day, user_id, basis, metric, count_value)
    select
      p_workspace_id,
      (a.occurred_at at time zone 'UTC')::date,
      a.owner_user_id_at_event,
      'owner',
      'replies',
      count(distinct a.contact_id)
    from public.crm_activities a
    where a.workspace_id = p_workspace_id
      and a.activity_type = 'EMAIL_REPLIED'
      and a.contact_id is not null
      and (a.occurred_at at time zone 'UTC')::date between p_from_day and p_to_day
    group by 2, 3
    returning 1
  )
  select v_rows + count(*) into v_rows from owned;

  -- ---- money, summed in SQL ----------------------------------------------
  -- Ledger D25: never in JavaScript. `closed_at` is the bucket, because a deal
  -- is won on the day it closes, not the day it was created.
  with won as (
    insert into public.crm_reporting_daily
      (workspace_id, day, user_id, basis, metric, count_value, amount_value)
    select
      p_workspace_id,
      (o.closed_at at time zone 'UTC')::date,
      o.owner_user_id,
      'owner',
      'won_deals',
      count(*),
      coalesce(sum(o.value_amount_base), 0)
    from public.crm_opportunities o
    where o.workspace_id = p_workspace_id
      and o.status = 'won'
      and o.closed_at is not null
      and o.deleted_at is null
      and (o.closed_at at time zone 'UTC')::date between p_from_day and p_to_day
    group by 2, 3
    returning 1
  )
  select v_rows + count(*) into v_rows from won;

  -- ---- workspace totals ---------------------------------------------------
  -- Stored rather than summed on read, so a manager's dashboard is one lookup
  -- instead of a scan across every member.
  with totals as (
    insert into public.crm_reporting_daily
      (workspace_id, day, user_id, basis, metric, count_value, amount_value)
    select workspace_id, day, null, 'workspace', metric,
           sum(count_value), sum(amount_value)
      from public.crm_reporting_daily
     where workspace_id = p_workspace_id
       and day between p_from_day and p_to_day
       and basis <> 'workspace'
     group by workspace_id, day, metric
    returning 1
  )
  select v_rows + count(*) into v_rows from totals;

  return v_rows;
end;
$$;

-- From 0083 — 1 substitution(s).
create or replace function public.crm_batch_funnel(
  p_workspace_id uuid,
  p_batch_id     uuid
)
returns table (
  extracted        bigint,
  canonical        bigint,
  with_email       bigint,
  assigned         bigint,
  engaged          bigint,
  replied          bigint,
  qualified        bigint,
  call_booked      bigint,
  opportunities    bigint,
  won_deals        bigint,
  won_revenue      numeric
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with members as (
    select m.contact_id
      from public.crm_batch_members m
      join public.crm_contacts c
        on c.id = m.contact_id and c.workspace_id = p_workspace_id
     where m.workspace_id = p_workspace_id
       and m.batch_id = p_batch_id
       and c.deleted_at is null
  ),
  -- One pass over the batch's activities, reused by four steps below. Asking
  -- the same table four times would be four scans of the same rows.
  acts as (
    select a.contact_id, a.activity_type
      from public.crm_activities a
      join members m on m.contact_id = a.contact_id
     where a.workspace_id = p_workspace_id
  )
  select
    coalesce((select b.rows_seen from public.crm_lead_batches b
               where b.id = p_batch_id and b.workspace_id = p_workspace_id), 0)::bigint,
    (select count(*) from members),
    (select count(distinct e.contact_id)
       from public.crm_contact_emails e
       join members m on m.contact_id = e.contact_id
      where e.workspace_id = p_workspace_id and e.deleted_at is null),
    (select count(*) from members m
       join public.crm_contacts c on c.id = m.contact_id
      where c.owner_user_id is not null),
    (select count(distinct contact_id) from acts
      where activity_type in ('EMAIL_SENT', 'ENGAGEMENT', 'OPENER_SENT',
                              'PERSONALIZED_DM', 'FOLLOW_UP')),
    (select count(distinct contact_id) from acts where activity_type = 'EMAIL_REPLIED'),
    (select count(distinct contact_id) from acts where activity_type = 'QUALIFIED'),
    (select count(distinct contact_id) from acts where activity_type = 'CALL_BOOKED'),
    (select count(distinct o.contact_id)
       from public.crm_opportunities o
       join members m on m.contact_id = o.contact_id
      where o.workspace_id = p_workspace_id and o.deleted_at is null),
    (select count(*)
       from public.crm_opportunities o
       join members m on m.contact_id = o.contact_id
      where o.workspace_id = p_workspace_id and o.deleted_at is null
        and o.status = 'won'),
    -- Summed HERE, never in JavaScript.
    coalesce((select sum(o.value_amount_base)
       from public.crm_opportunities o
       join members m on m.contact_id = o.contact_id
      where o.workspace_id = p_workspace_id and o.deleted_at is null
        and o.status = 'won'), 0);
$$;

-- From 0083 — 3 substitution(s).
create or replace function public.crm_pipeline_totals(
  p_workspace_id    uuid,
  p_owner_user_id   uuid default null
)
returns table (
  open_deals       bigint,
  open_value       numeric,
  weighted_value   numeric,
  won_deals        bigint,
  won_value        numeric
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    count(*) filter (where o.status = 'open'),
    coalesce(sum(o.value_amount_base) filter (where o.status = 'open'), 0),
    /* The forecast: value × probability. Deterministic and credit-free —
       Ledger and M4 Phase 10.5 both require that it never involves Hubble.
       ROUNDED, because `numeric / 100.0` carries sixteen decimal places and a
       forecast reported to the ten-thousandth of a penny is noise pretending
       to be precision. */
    round(coalesce(sum(o.value_amount_base * o.probability / 100.0)
               filter (where o.status = 'open'), 0), 2),
    count(*) filter (where o.status = 'won'),
    coalesce(sum(o.value_amount_base) filter (where o.status = 'won'), 0)
  from public.crm_opportunities o
  where o.workspace_id = p_workspace_id
    and o.deleted_at is null
    and (p_owner_user_id is null or o.owner_user_id = p_owner_user_id);
$$;

-- From 0084 — 2 substitution(s).
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
    coalesce(sum(o.value_amount_base), 0),
    round(coalesce(sum(o.value_amount_base * o.probability / 100.0), 0), 2)
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

-- From 0084 — 1 substitution(s).
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
    coalesce(sum(o.value_amount_base) filter (where o.status = 'won'), 0),
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

