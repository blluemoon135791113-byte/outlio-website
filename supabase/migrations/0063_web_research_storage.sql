create table if not exists public.web_research_jobs (
  id uuid primary key,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  request jsonb not null,
  output jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists web_research_jobs_status_created_idx
  on public.web_research_jobs (status, created_at);

create table if not exists public.web_research_cache (
  namespace text not null,
  cache_key text not null,
  value jsonb not null,
  expires_at timestamptz not null,
  primary key (namespace, cache_key)
);

create table if not exists public.web_research_lead_results (
  tenant_id uuid not null,
  lead_id uuid not null,
  job_id uuid not null references public.web_research_jobs(id),
  output jsonb not null,
  researched_at timestamptz not null default now(),
  primary key (tenant_id, lead_id)
);

alter table public.web_research_jobs enable row level security;
alter table public.web_research_cache enable row level security;
alter table public.web_research_lead_results enable row level security;

comment on table public.web_research_jobs is 'Server-only durable MCP research jobs.';
comment on table public.web_research_cache is 'Server-only cache for searches, pages, and extraction results.';
comment on table public.web_research_lead_results is 'Latest server-only research bundle for each tenant-scoped lead.';
