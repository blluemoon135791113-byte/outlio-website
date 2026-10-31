-- 0159 — what enrichment visited and searched (owner request 2026-10-31)
--
-- Until now a page that yielded nothing left no trace, and a search that came
-- back empty did not say which engine answered: 63% of 2,223 cached searches
-- were empty with no way to tell why. These two logs answer "which sites does
-- the agent read, which pay off, which refuse us, and why searches come back
-- empty" — for the admin view at /admin/enrichment.
--
-- ⚠️ NO CONTENT, NO NAMES, NO QUERY TEXT. A visit is a host, a page kind, a
-- provider and an outcome. A search is its purpose and shape (word count,
-- quoted, operators) and each engine's outcome. A query carries a person's
-- name, so it is never stored. Kept 30 days (pruned by the tick).

create table if not exists public.enrichment_page_visits (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade,
  research_run_id  uuid references public.research_runs(id) on delete cascade,
  provider         text not null,
  host             text not null,
  page_kind        text not null,
  outcome          text not null check (outcome in (
                     'read_contact', 'read_empty', 'refused', 'js_rendered', 'blocked',
                     'unreachable', 'timeout', 'not_html', 'too_large')),
  http_status      integer,
  latency_ms       integer check (latency_ms is null or latency_ms >= 0),
  created_at       timestamptz not null default now()
);

create index if not exists enrichment_page_visits_created_idx
  on public.enrichment_page_visits (created_at desc);
create index if not exists enrichment_page_visits_host_idx
  on public.enrichment_page_visits (host, created_at desc);

create table if not exists public.enrichment_searches (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade,
  research_run_id  uuid references public.research_runs(id) on delete cascade,
  purpose          text not null,
  words            integer not null check (words >= 0),
  quoted           boolean not null default false,
  operators        text[] not null default '{}',
  cached           boolean not null default false,
  hits             integer not null default 0 check (hits >= 0),
  -- [{ engine, outcome: hits|empty|failed|cooling_down|over_budget|not_configured, hits, ms }]
  engines          jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists enrichment_searches_created_idx
  on public.enrichment_searches (created_at desc);

-- Operator data, not tenant data: admins read; writes come from the service
-- role, which bypasses RLS. No insert/update/delete policy refuses everyone else.
alter table public.enrichment_page_visits enable row level security;
alter table public.enrichment_searches enable row level security;

drop policy if exists enrichment_page_visits_admin_select on public.enrichment_page_visits;
create policy enrichment_page_visits_admin_select
  on public.enrichment_page_visits for select using ((select public.is_admin()));

drop policy if exists enrichment_searches_admin_select on public.enrichment_searches;
create policy enrichment_searches_admin_select
  on public.enrichment_searches for select using ((select public.is_admin()));

revoke insert, update, delete on public.enrichment_page_visits from anon, authenticated;
revoke insert, update, delete on public.enrichment_searches from anon, authenticated;

comment on table public.enrichment_page_visits is
  'One row per page an enrichment provider read: host, kind, outcome. No content. 30-day retention.';
comment on table public.enrichment_searches is
  'One row per enrichment search: purpose, shape and each engine''s outcome. No query text. 30-day retention.';
