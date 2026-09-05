-- 0107 — custom dashboards (R7)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  THE BRIEF'S POINT: NOT EVERY COMPANY MEASURES THE SAME THINGS.          ║
-- ║                                                                           ║
-- ║  The fixed reports assume openers, personalised DMs and engagement are    ║
-- ║  the KPIs. One agency measures demos and proposals; another measures      ║
-- ║  trials and activations. A dashboard someone cannot change is a dashboard ║
-- ║  they stop reading.                                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.dashboards (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,

  name          text not null check (length(trim(name)) between 1 and 80),
  description   text,

  /*
   * ⚠️ A DASHBOARD BELONGS TO THE WORKSPACE, NOT ITS AUTHOR. A manager's
   * leaderboard has to survive that manager leaving — `created_by` is
   * provenance, not ownership, which is why it is nullable and set null on
   * delete rather than cascading the dashboard away with the person.
   */
  created_by    uuid references auth.users(id) on delete set null,

  /* Exactly one dashboard opens by default. Enforced by the index below. */
  is_default    boolean not null default false,

  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists dashboards_default_uniq
  on public.dashboards (workspace_id)
  where is_default and deleted_at is null;

create index if not exists dashboards_workspace_idx
  on public.dashboards (workspace_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- dashboard_widgets
-- ---------------------------------------------------------------------------

create table if not exists public.dashboard_widgets (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  dashboard_id  uuid not null references public.dashboards(id) on delete cascade,

  /*
   * ⚠️ THE METRIC IS A KEY INTO A CODE CATALOGUE, NOT A STORED QUERY.
   *
   * The tempting design stores SQL, or a column name and an aggregate. Both
   * hand a customer a way to read tables the permission layer never approved,
   * and both break silently when a column is renamed. A key resolves through
   * `lib/reports/metrics.ts`, where every metric states its own scoping — so a
   * dashboard can never out-reach the person looking at it.
   */
  metric_key    text not null check (length(trim(metric_key)) between 1 and 80),

  /* Overrides the metric's own default label when someone renames it. */
  title         text,

  /*
   * How it draws. Deliberately a small set: a widget nobody can read is worse
   * than one that is merely plain.
   */
  visual        text not null default 'stat'
                check (visual in ('stat', 'bar', 'bullet', 'list')),

  /* 0-based, contiguous within a dashboard — see the note in the app layer. */
  position      integer not null default 0 check (position >= 0),

  /* 1 = a quarter of the row, 2 = half, 4 = full. */
  width         integer not null default 1 check (width in (1, 2, 4)),

  /** Per-widget filters: date range, owner, pipeline. Validated by Zod. */
  config        jsonb not null default '{}'::jsonb,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists dashboard_widgets_position_uniq
  on public.dashboard_widgets (dashboard_id, position);

create index if not exists dashboard_widgets_dashboard_idx
  on public.dashboard_widgets (dashboard_id, position);

-- ---------------------------------------------------------------------------
-- Triggers and RLS
-- ---------------------------------------------------------------------------

drop trigger if exists dashboards_set_updated_at on public.dashboards;
create trigger dashboards_set_updated_at
  before update on public.dashboards
  for each row execute function public.set_updated_at();

drop trigger if exists dashboard_widgets_set_updated_at on public.dashboard_widgets;
create trigger dashboard_widgets_set_updated_at
  before update on public.dashboard_widgets
  for each row execute function public.set_updated_at();

alter table public.dashboards enable row level security;
alter table public.dashboard_widgets enable row level security;

/*
 * Readable by any member: a dashboard is a shared artefact of the workspace.
 * ⚠️ READING A DASHBOARD IS NOT READING ITS DATA. The widgets name metrics;
 * the numbers are computed server-side through the same `dataScope` rules as
 * every other surface, so a setter opening the team leaderboard still sees only
 * what they are entitled to.
 */
drop policy if exists dashboards_select_member on public.dashboards;
create policy dashboards_select_member on public.dashboards
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

drop policy if exists dashboard_widgets_select_member on public.dashboard_widgets;
create policy dashboard_widgets_select_member on public.dashboard_widgets
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

-- Writes go through server actions, which check the permission first.
revoke all on table public.dashboards from anon;
revoke all on table public.dashboard_widgets from anon;
grant select on table public.dashboards to authenticated;
grant select on table public.dashboard_widgets to authenticated;
grant select, insert, update, delete on table public.dashboards to service_role;
grant select, insert, update, delete on table public.dashboard_widgets to service_role;

comment on column public.dashboard_widgets.metric_key is
  'Key into the code catalogue in lib/reports/metrics.ts. NEVER a stored query '
  'or column name -- either would let a dashboard read tables the permission '
  'layer never approved, and break silently on a rename.';
