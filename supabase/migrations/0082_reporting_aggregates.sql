-- 0082 — reporting aggregates and reconciliation (M4 Phase 9)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  THE AGGREGATE IS A CACHE. THE EVENT STREAM IS THE TRUTH.                 ║
-- ║                                                                           ║
-- ║  Every number here can be recomputed from `crm_activities` and            ║
-- ║  `crm_opportunities`. That is what makes the reconciliation job possible, ║
-- ║  and it is why the aggregate may be dropped and rebuilt at any time       ║
-- ║  without losing anything.                                                 ║
-- ║                                                                           ║
-- ║  ⚠️ The moment a number exists ONLY here, this stops being a cache and    ║
-- ║  becomes a second source of truth that can drift silently.                ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- The formulas are defined in the Ledger (§20), written before this migration
-- deliberately. If SQL and Ledger ever disagree, the Ledger is the contract
-- and this is the bug.

-- ---------------------------------------------------------------------------
-- crm_reporting_daily
--
-- One row per (workspace, day, user, metric). Long, not wide.
--
-- A column per metric would mean a migration every time a metric is added —
-- and M6 adds eight email metrics, M8 adds meetings. A key/value row costs one
-- index and buys a schema that never changes shape again.
--
-- ⚠️ DAY GRAIN ONLY. A month is a sum of days. Storing both means they can
-- disagree, and only the day grain can answer an arbitrary date range.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_reporting_daily (
  /* Surrogate key. The natural key includes `user_id`, which is NULL for a
     workspace total — and a PRIMARY KEY makes every column NOT NULL, so the
     natural key cannot be the PK. See the unique index below. */
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  /* UTC. Ledger §20 records the deferred per-workspace timezone. */
  day          date not null,

  /* Whose number this is. NULL is the workspace total — a real row, not a
     placeholder, so a manager's dashboard is one lookup rather than a sum
     over every member. */
  user_id      uuid references auth.users(id) on delete cascade,

  /* Which attribution this row uses (Ledger §20): 'actor' for work someone
     did, 'owner' for outcomes on their book. The SAME metric appears under
     both, and conflating them is how "emails sent" and "emails sent on my
     contacts" become one wrong number. */
  basis        text not null check (basis in ('actor', 'owner', 'workspace')),

  metric       text not null check (metric ~ '^[a-z][a-z0-9_]{1,63}$'),

  /* Counts are integers; money is numeric. One column each rather than a
     polymorphic value, because summing a money column stored as a count is a
     mistake nobody notices. */
  count_value  bigint not null default 0,
  amount_value numeric(16, 2) not null default 0,

  computed_at  timestamptz not null default now()
);

-- ⚠️ NULLS NOT DISTINCT is load-bearing, not a flourish.
--
-- `user_id` is NULL on a workspace-total row. Under the default rule two NULLs
-- are DISTINCT, so an ordinary unique index would let every recompute insert a
-- second total for the same day and metric, silently doubling every
-- workspace-level number. Postgres 15+ lets us say what we actually mean.
create unique index if not exists crm_reporting_daily_natural_uniq
  on public.crm_reporting_daily (workspace_id, day, basis, metric, user_id)
  nulls not distinct;

-- The dashboard query: one workspace, one date range, newest first.
create index if not exists crm_reporting_daily_range_idx
  on public.crm_reporting_daily (workspace_id, metric, day desc);

create index if not exists crm_reporting_daily_user_idx
  on public.crm_reporting_daily (workspace_id, user_id, day desc)
  where user_id is not null;

-- ---------------------------------------------------------------------------
-- crm_reporting_runs
--
-- When the rollup last ran, and what it found. Without it nobody can answer
-- "is this dashboard stale?", and a silently stalled job looks exactly like a
-- quiet week.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_reporting_runs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,

  from_day      date not null,
  to_day        date not null,
  rows_written  integer not null default 0,

  /* Set by the reconciliation job. NULL means it has not been checked. */
  discrepancies integer,

  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  error         text,

  constraint crm_reporting_runs_range check (to_day >= from_day)
);

create index if not exists crm_reporting_runs_workspace_idx
  on public.crm_reporting_runs (workspace_id, started_at desc);

-- ---------------------------------------------------------------------------
-- crm_rollup_activity_metrics
--
-- Recomputes a date range from the event stream, for one workspace.
--
-- ⚠️ DELETE-THEN-INSERT PER RANGE, not incremental addition. An event can
-- arrive late — an ingested history, a webhook replayed, a backfill like the
-- one that gave 19 contacts their creation events — and an aggregate that only
-- ever adds would double-count it. Recomputing a bounded range is cheap and
-- cannot drift.
--
-- Every metric below implements Ledger §20 exactly. `count(distinct
-- contact_id)` where the Ledger says distinct, plain `count(*)` where it does
-- not: four emails to one person is four emails sent and ONE contact emailed.
-- ---------------------------------------------------------------------------

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
      coalesce(sum(o.value_amount), 0)
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

revoke all on function public.crm_rollup_activity_metrics(uuid, date, date)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- crm_reconcile_reporting
--
-- M4 ACCEPTANCE CRITERION 1: "dashboard numbers == raw activity counts."
--
-- Recounts a handful of metrics straight from the event stream and compares
-- them to what the aggregate says. Returns one row per disagreement, and
-- nothing at all when they match.
--
-- ⚠️ It reports; it does not repair. A rollup that silently fixed itself would
-- hide the bug that caused the drift, and the drift is the only symptom that
-- bug has.
-- ---------------------------------------------------------------------------

create or replace function public.crm_reconcile_reporting(
  p_workspace_id uuid,
  p_from_day     date,
  p_to_day       date
)
returns table (
  day date,
  metric text,
  aggregate_value bigint,
  raw_value bigint
)
language sql
security definer
set search_path = public, pg_temp
as $$
  -- ⚠️ THE CHECKED LIST IS USED ON BOTH SIDES.
  --
  -- The first version recounted seven metrics but compared against ALL of
  -- them, so every metric it did not know how to recount — `engagements`,
  -- `personalized_dms` — showed up as drift with a raw value of zero. A
  -- reconciliation that cries wolf about metrics it never checked is worse
  -- than none, because the real discrepancy is then just one line among many.
  --
  -- Adding a metric to the rollup does NOT automatically check it. It has to
  -- be recounted here too, deliberately, or it is simply not covered.
  with checked (metric_name) as (
    values ('emails_sent'), ('contacts_emailed'), ('replies'), ('openers_sent'),
           ('calls_booked'), ('tasks_completed'), ('contacts_created'),
           ('engagements')
  ),
  raw as (
    select
      (a.occurred_at at time zone 'UTC')::date as d,
      m.name as metric_name,
      case
        when m.name in ('contacts_emailed', 'replies', 'qualified')
          then count(distinct a.contact_id)
        else count(*)
      end as n
    from public.crm_activities a
    cross join lateral (
      values
        ('emails_sent',      a.activity_type = 'EMAIL_SENT'),
        ('contacts_emailed', a.activity_type = 'EMAIL_SENT' and a.contact_id is not null),
        ('replies',          a.activity_type = 'EMAIL_REPLIED' and a.contact_id is not null),
        ('openers_sent',     a.activity_type = 'OPENER_SENT'),
        ('calls_booked',     a.activity_type = 'CALL_BOOKED'),
        ('tasks_completed',  a.activity_type = 'TASK_COMPLETED'),
        ('contacts_created', a.activity_type = 'CONTACT_CREATED'),
        ('engagements',      a.activity_type in ('ENGAGEMENT', 'OPENER_SENT',
                                                 'PERSONALIZED_DM', 'FOLLOW_UP'))
    ) as m(name, matches)
    where a.workspace_id = p_workspace_id
      and m.matches
      and (a.occurred_at at time zone 'UTC')::date between p_from_day and p_to_day
    group by 1, 2
  ),
  agg as (
    select r.day as d, r.metric as metric_name, sum(r.count_value) as n
      from public.crm_reporting_daily r
     where r.workspace_id = p_workspace_id
       and r.basis = 'actor'
       and r.metric in (select metric_name from checked)
       and r.day between p_from_day and p_to_day
     group by 1, 2
  )
  select
    coalesce(raw.d, agg.d),
    coalesce(raw.metric_name, agg.metric_name),
    coalesce(agg.n, 0),
    coalesce(raw.n, 0)
  from raw
  full outer join agg on agg.d = raw.d and agg.metric_name = raw.metric_name
  -- Only disagreements. A clean reconciliation returns nothing, so an empty
  -- result is the success signal.
  where coalesce(agg.n, 0) <> coalesce(raw.n, 0);
$$;

revoke all on function public.crm_reconcile_reporting(uuid, date, date)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['crm_reporting_daily', 'crm_reporting_runs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_member', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_workspace_member(workspace_id) or public.is_admin())',
      t || '_select_member', t
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role', t
    );
  end loop;
end
$$;

comment on table public.crm_reporting_daily is
  'A CACHE, never a source of truth: every number here is recomputable from '
  'crm_activities and crm_opportunities, which is what makes '
  'crm_reconcile_reporting possible. Day grain only — a month is a sum of days.';

comment on function public.crm_reconcile_reporting(uuid, date, date) is
  'Recounts from the event stream and returns one row per disagreement. '
  'Reports, never repairs: a rollup that fixed itself would hide the bug that '
  'caused the drift.';
