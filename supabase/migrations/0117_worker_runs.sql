-- A durable record that the scheduler is alive.
--
-- WHY THIS EXISTS
--
-- `runTick()` returns its result in an HTTP response body and to the platform
-- logs. Nothing survives. That makes the two states nobody wants to confuse
-- indistinguishable from the outside:
--
--   * the tick ran and had nothing to do
--   * the tick has not run in three days
--
-- The second one is not hypothetical. The scheduler is a GitHub Actions
-- workflow, and GitHub DISABLES scheduled workflows on a repository with 60
-- days of no activity, silently. An unset `CRON_SECRET` fails every request
-- closed, by design. Either way outbound email simply stops, and the first
-- person to notice is a customer asking why their campaign never went out.
--
-- One row per tick makes "when did this last run" a question with an answer.
create table if not exists public.worker_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  duration_ms integer not null,
  -- The per-job {ok, detail} map from TickResult, stored whole. Read by a
  -- human diagnosing a bad tick, never queried by key.
  jobs jsonb not null default '{}'::jsonb,
  -- False when ANY job inside the tick failed. The tick itself still ran --
  -- that distinction is the whole point of the table.
  ok boolean not null
);

-- The only query this table serves: "the most recent runs, newest first."
create index if not exists worker_runs_started_at_idx
  on public.worker_runs (started_at desc);

alter table public.worker_runs enable row level security;

-- ⚠️ NOT TENANT DATA. This is one global scheduler, not a per-workspace
-- resource, so there is no workspace_id to scope by and no customer has any
-- business reading it. Admins read; nobody else sees anything.
--
-- There is deliberately NO insert/update/delete policy. Writes come from the
-- tick, which uses the service role and bypasses RLS. A missing policy means
-- every other client is refused, which is the correct answer for all of them.
drop policy if exists worker_runs_admin_select on public.worker_runs;
create policy worker_runs_admin_select
  on public.worker_runs
  for select
  using ((select public.is_admin()));

comment on table public.worker_runs is
  'One row per background tick. Exists so a dead scheduler is visible rather '
  'than silent; see app/admin for the staleness check that reads it.';
