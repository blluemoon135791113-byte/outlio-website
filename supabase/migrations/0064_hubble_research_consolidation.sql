-- 0064 — one Hubble-owned research authority
--
-- Hubble owns durable scheduling in research_runs/research_job_queue. The web
-- research MCP is a stateless acquisition capability when called by Hubble;
-- its standalone job tables are not a second application queue.

alter table public.research_runs
  add column if not exists idempotency_key text,
  add column if not exists progress_stage text not null default 'queued',
  add column if not exists progress_current integer not null default 0,
  add column if not exists progress_total integer not null default 0,
  add column if not exists evidence_gaps jsonb not null default '[]'::jsonb;

alter table public.research_runs
  drop constraint if exists research_runs_progress_nonnegative;
alter table public.research_runs
  add constraint research_runs_progress_nonnegative
  check (progress_current >= 0 and progress_total >= 0);

-- Only one equivalent ACTIVE run may exist. Completed/failed/cancelled runs no
-- longer occupy the key, so an intentional later refresh remains possible.
create unique index if not exists research_runs_active_idempotency_idx
  on public.research_runs (user_id, idempotency_key)
  where idempotency_key is not null
    and status in (
      'pending',
      'planning',
      'waiting_for_clarification',
      'running'
    );

comment on column public.research_runs.idempotency_key is
  'Stable hash of the normalized question, scope, plan, and qualification profile. Prevents duplicate active research.';
comment on column public.research_runs.progress_stage is
  'Persisted real pipeline stage shown while a research run is active.';
comment on column public.research_runs.evidence_gaps is
  'Bounded client-safe reasons acquisition stages could not supply evidence.';

comment on table public.web_research_jobs is
  'Standalone MCP jobs only. Hubble production scheduling is owned by research_job_queue.';
comment on table public.web_research_lead_results is
  'Standalone MCP latest-result bundles only. Hubble canonical facts live in research_evidence.';

