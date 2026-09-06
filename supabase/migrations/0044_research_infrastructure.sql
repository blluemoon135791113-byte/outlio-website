-- 0044 — research runs, evidence, and per-call observability
--
-- WHAT THIS IS FOR
-- Every researched fact must carry provenance: which provider said it, where,
-- when, how confident, and when it goes stale. An LLM statement is NEVER
-- evidence (spec §16). Code that cannot point at a row in `research_evidence`
-- must report `unknown` — never `false`, and never a guess (spec §49).
--
-- WHAT IT REPLACES: nothing. No existing table changes.

-- ---------------------------------------------------------------------------
-- research_runs
--
-- One row per user question. This is the debugging record for a system that
-- spends money: what was asked, what plan came out of it, how many leads and
-- companies it touched, which tools ran, what it cost (spec §29).
-- ---------------------------------------------------------------------------

create table if not exists public.research_runs (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,

  status                  text not null default 'pending'
                            check (status in (
                              'pending',
                              'planning',
                              'waiting_for_clarification',
                              'running',
                              'partially_complete',
                              'completed',
                              'failed',
                              'cancelled'
                            )),

  -- The user's question, verbatim.
  query_text              text not null,
  -- Which leads the question applies to: current page, selection, list, or all.
  scope                   jsonb not null default '{}'::jsonb,
  -- The validated ResearchPlan. External research NEVER runs without one.
  plan                    jsonb,
  clarifications          jsonb not null default '[]'::jsonb,

  lead_count              integer not null default 0 check (lead_count >= 0),
  company_count           integer not null default 0 check (company_count >= 0),
  qualified_count         integer not null default 0 check (qualified_count >= 0),

  tools_used              text[] not null default '{}',
  external_call_count     integer not null default 0 check (external_call_count >= 0),
  cache_hit_count         integer not null default 0 check (cache_hit_count >= 0),

  -- Money is integer micros. Floating point has no place in a cost ledger.
  estimated_cost_micros   bigint not null default 0 check (estimated_cost_micros >= 0),
  actual_cost_micros      bigint not null default 0 check (actual_cost_micros >= 0),

  duration_ms             integer check (duration_ms is null or duration_ms >= 0),
  error_code              text,
  error_message           text,

  started_at              timestamptz,
  completed_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (id, user_id)
);

drop trigger if exists research_runs_set_updated_at on public.research_runs;
create trigger research_runs_set_updated_at
  before update on public.research_runs
  for each row execute function public.set_updated_at();

create index if not exists research_runs_user_created_idx
  on public.research_runs (user_id, created_at desc);
create index if not exists research_runs_status_idx
  on public.research_runs (status);

alter table public.research_runs enable row level security;

drop policy if exists research_runs_select_own on public.research_runs;
create policy research_runs_select_own on public.research_runs
  for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

revoke all on table public.research_runs from public, anon, authenticated;
grant select on table public.research_runs to authenticated;
grant select, insert, update, delete on table public.research_runs to service_role;

-- ---------------------------------------------------------------------------
-- research_evidence
--
-- The cache AND the provenance record — deliberately the same table. A cache
-- without provenance cannot be audited; provenance without expiry goes stale
-- and gets re-bought. `expires_at` is written from the centralized TTL map in
-- lib/intelligence/ttl.ts, never computed ad hoc.
--
-- Rows are append-only in practice: a newer observation is inserted alongside
-- the old one rather than overwriting it, so a conflict between two providers
-- stays inspectable (spec §17).
-- ---------------------------------------------------------------------------

create table if not exists public.research_evidence (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,

  entity_type       text not null check (entity_type in ('company', 'person')),
  -- companies.id or extracted_leads.id. Not an FK: evidence must survive a lead
  -- being purged, and the two entity types cannot share one foreign key.
  entity_id         uuid not null,

  field             text not null,
  -- Always an object, never a bare scalar, so a value can carry units,
  -- currency, or a range without a schema change.
  value_json        jsonb not null,

  source_provider   text not null,
  source_url        text,
  source_confidence text not null check (source_confidence in ('high', 'medium', 'low')),
  confidence        numeric(4, 3) not null default 0.500
                      check (confidence >= 0 and confidence <= 1),

  retrieved_at      timestamptz not null default now(),
  -- NULL means it never expires. Used for facts that cannot go stale.
  expires_at        timestamptz,

  research_run_id   uuid references public.research_runs(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- The read path: "the freshest evidence for these fields on these entities".
create index if not exists research_evidence_lookup_idx
  on public.research_evidence (user_id, entity_type, entity_id, field, retrieved_at desc);

create index if not exists research_evidence_expiry_idx
  on public.research_evidence (expires_at)
  where expires_at is not null;

create index if not exists research_evidence_run_idx
  on public.research_evidence (research_run_id);

alter table public.research_evidence enable row level security;

drop policy if exists research_evidence_select_own on public.research_evidence;
create policy research_evidence_select_own on public.research_evidence
  for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

revoke all on table public.research_evidence from public, anon, authenticated;
grant select on table public.research_evidence to authenticated;
grant select, insert, update, delete on table public.research_evidence to service_role;

comment on table public.research_evidence is
  'Every researched fact with its provenance and expiry. An LLM statement is '
  'never evidence. No row means unknown, which is not the same as false.';

-- ---------------------------------------------------------------------------
-- research_tool_calls
--
-- One row per external call (spec §48). This is what makes "which provider is
-- cheapest per incremental valid result" answerable later.
--
-- ⚠️ NEVER stores provider secrets, request bodies, or raw responses.
-- ---------------------------------------------------------------------------

create table if not exists public.research_tool_calls (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  research_run_id        uuid references public.research_runs(id) on delete cascade,

  provider               text not null,
  -- The capability, not the vendor endpoint: funding, tech_stack, web_research…
  tool                   text not null,
  entity_type            text check (entity_type is null or entity_type in ('company', 'person')),
  entity_id              uuid,

  status                 text not null
                           check (status in ('success', 'not_found', 'error', 'timeout', 'skipped')),
  latency_ms             integer check (latency_ms is null or latency_ms >= 0),
  estimated_cost_micros  bigint not null default 0 check (estimated_cost_micros >= 0),
  -- A catalog code. Never a raw provider message.
  error_code             text,

  created_at             timestamptz not null default now()
);

create index if not exists research_tool_calls_run_idx
  on public.research_tool_calls (research_run_id);
create index if not exists research_tool_calls_provider_idx
  on public.research_tool_calls (user_id, provider, created_at desc);

alter table public.research_tool_calls enable row level security;

drop policy if exists research_tool_calls_select_own on public.research_tool_calls;
create policy research_tool_calls_select_own on public.research_tool_calls
  for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

revoke all on table public.research_tool_calls from public, anon, authenticated;
grant select on table public.research_tool_calls to authenticated;
grant select, insert, update, delete on table public.research_tool_calls to service_role;

comment on table public.research_tool_calls is
  'Per-external-call observability. Never contains secrets, request bodies, or '
  'raw provider responses.';

-- ---------------------------------------------------------------------------
-- purge_expired_evidence
--
-- Data minimisation (spec §45): evidence past its TTL is no longer usable and
-- must not sit in the database indefinitely. Idempotent; safe to call from a
-- page load like the existing reapers.
-- ---------------------------------------------------------------------------

create or replace function public.purge_expired_evidence(p_older_than_days int default 30)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with removed as (
    delete from public.research_evidence
     where expires_at is not null
       and expires_at < now() - make_interval(days => greatest(p_older_than_days, 0))
    returning 1
  )
  select count(*) into v_count from removed;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.purge_expired_evidence(int)
  from public, anon, authenticated;
grant execute on function public.purge_expired_evidence(int) to service_role;
