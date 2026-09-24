-- 0143 — query and observability hardening from the full optimization audit

-- ---------------------------------------------------------------------------
-- Correlate edge responses, public API logs and server errors with one value.
-- Callers normally supply the id created by proxy.ts. Historical rows stay
-- NULL: they never had a caller-visible id to correlate, and rewriting the
-- whole log table would create production lock/write pressure for no benefit.
-- New non-application inserts receive a generated default.
-- ---------------------------------------------------------------------------

alter table public.api_request_log
  add column if not exists request_id text;

alter table public.api_request_log
  alter column request_id set default gen_random_uuid()::text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'api_request_log_request_id_length'
      and conrelid = 'public.api_request_log'::regclass
  ) then
    alter table public.api_request_log
      add constraint api_request_log_request_id_length
      check (request_id is null or length(request_id) between 8 and 128)
      not valid;
  end if;
end
$$;

create index if not exists api_request_log_request_id_idx
  on public.api_request_log (request_id)
  where request_id is not null;

-- ---------------------------------------------------------------------------
-- Collapse campaign/flow list counts from O(rows) round trips to one aggregate
-- query per page. Both functions require the workspace and repeat that scope
-- inside SQL, so an id from another tenant can never contribute to a result.
-- These are read-only aggregates and add no write amplification.
-- ---------------------------------------------------------------------------

create or replace function public.email_campaign_enrollment_counts(
  p_workspace_id uuid,
  p_campaign_ids uuid[]
)
returns table (campaign_id uuid, recipient_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.campaign_id, count(*) as recipient_count
  from public.email_enrollments e
  where e.workspace_id = p_workspace_id
    and e.campaign_id = any(coalesce(p_campaign_ids, array[]::uuid[]))
    and e.status in ('active', 'paused')
  group by e.campaign_id;
$$;

revoke all on function public.email_campaign_enrollment_counts(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.email_campaign_enrollment_counts(uuid, uuid[])
  to service_role;

create or replace function public.flow_run_counts(
  p_workspace_id uuid,
  p_flow_ids uuid[]
)
returns table (flow_id uuid, run_count bigint, halted_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    r.flow_id,
    count(*) as run_count,
    count(*) filter (where r.status = 'halted') as halted_count
  from public.flow_runs r
  where r.workspace_id = p_workspace_id
    and r.flow_id = any(coalesce(p_flow_ids, array[]::uuid[]))
  group by r.flow_id;
$$;

revoke all on function public.flow_run_counts(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.flow_run_counts(uuid, uuid[])
  to service_role;

-- Company quick-search uses a contains match (`ILIKE '%term%'`). A btree
-- cannot serve it; this mirrors the measured contact-search strategy from
-- migration 0080. The partial index avoids deleted rows. Tradeoff: company
-- writes maintain one additional GIN index, justified by removing full scans
-- from the global command palette.
create extension if not exists pg_trgm;

create index if not exists crm_companies_name_trgm_idx
  on public.crm_companies using gin (name gin_trgm_ops)
  where deleted_at is null;

comment on index public.crm_companies_name_trgm_idx is
  'Serves the CRM quick-search ILIKE contains match; partial to exclude soft-deleted companies.';

-- Supabase's SQL editor wraps the batch in a transaction, so these indexes do
-- not use CONCURRENTLY. Apply during a low-write window: ordinary CREATE INDEX
-- permits reads but blocks writes to the indexed table until it completes.
