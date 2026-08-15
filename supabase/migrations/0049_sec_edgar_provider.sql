-- Official SEC EDGAR provider infrastructure.
--
-- `provider_cache` stores small, explicitly reusable public API indexes such as
-- SEC's ticker/CIK map. It is global because the source is global; customer
-- research evidence remains tenant-scoped in `research_evidence`.

create table if not exists public.provider_cache (
  provider      text not null,
  cache_key     text not null,
  value_json    jsonb not null,
  retrieved_at timestamptz not null,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (provider, cache_key),
  check (length(provider) between 1 and 64),
  check (length(cache_key) between 1 and 160)
);

drop trigger if exists provider_cache_set_updated_at on public.provider_cache;
create trigger provider_cache_set_updated_at
  before update on public.provider_cache
  for each row execute function public.set_updated_at();

create index if not exists provider_cache_expiry_idx
  on public.provider_cache (expires_at);

alter table public.provider_cache enable row level security;
revoke all on table public.provider_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.provider_cache to service_role;

-- Last actual slot released for each provider. This is operational state, not
-- customer data, and is inspectable during an incident.
create table if not exists public.provider_request_schedules (
  provider        text primary key,
  last_started_at timestamptz,
  updated_at      timestamptz not null default now(),
  check (length(provider) between 1 and 64)
);

alter table public.provider_request_schedules enable row level security;
revoke all on table public.provider_request_schedules from public, anon, authenticated;
grant select, insert, update on table public.provider_request_schedules to service_role;

-- Globally serialize request starts for one provider. The advisory lock spans
-- every application instance connected to this database. Sleeping inside the
-- transaction prevents callers from reserving future slots and then bunching
-- together if one worker is delayed.
create or replace function public.await_provider_request_slot(
  p_provider text,
  p_min_interval_ms integer
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last timestamptz;
  v_wait_seconds double precision;
  v_started timestamptz;
begin
  if p_provider is null or length(p_provider) < 1 or length(p_provider) > 64 then
    raise exception 'Invalid provider';
  end if;

  -- 100 ms is the absolute ceiling of ten starts/second. SEC is configured at
  -- 200 ms (five/second) for a two-times safety margin.
  if p_min_interval_ms < 100 or p_min_interval_ms > 60000 then
    raise exception 'Invalid provider request interval';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('provider-request:' || p_provider, 0));

  select last_started_at
    into v_last
    from public.provider_request_schedules
   where provider = p_provider;

  if v_last is not null then
    v_wait_seconds :=
      (p_min_interval_ms / 1000.0) - extract(epoch from (clock_timestamp() - v_last));
    if v_wait_seconds > 0 then
      perform pg_sleep(v_wait_seconds);
    end if;
  end if;

  v_started := clock_timestamp();

  insert into public.provider_request_schedules (provider, last_started_at, updated_at)
  values (p_provider, v_started, v_started)
  on conflict (provider) do update
    set last_started_at = excluded.last_started_at,
        updated_at = excluded.updated_at;

  return v_started;
end;
$$;

revoke all on function public.await_provider_request_slot(text, integer)
  from public, anon, authenticated;
grant execute on function public.await_provider_request_slot(text, integer)
  to service_role;

-- Widen the professional/business qualification vocabulary for SEC facts.
alter table public.qualification_rules
  drop constraint if exists qualification_rules_field_check;

alter table public.qualification_rules
  add constraint qualification_rules_field_check check (field in (
    'company_domain', 'employee_count', 'industry', 'headquarters',
    'company_description', 'business_model', 'revenue_estimate',
    'company_number', 'company_status', 'company_type', 'jurisdiction',
    'incorporation_date', 'sic_codes', 'registered_office',
    'accounts_overdue', 'confirmation_statement_overdue', 'insolvency_history',
    'sec_cik', 'sec_legal_name', 'sec_entity_type', 'sec_sic',
    'sec_sic_description', 'sec_ein', 'sec_lei', 'sec_tickers', 'sec_exchanges',
    'sec_state_of_incorporation', 'sec_business_address', 'sec_website',
    'sec_former_names', 'sec_filing_history',
    'funding_round', 'funding_amount', 'funding_currency', 'funding_date',
    'funding_investors', 'tech_stack', 'product_launches', 'recent_news',
    'hiring_signals', 'competitors', 'website_signals', 'pricing_signals',
    'review_presence', 'review_rating', 'review_count', 'github_presence',
    'work_email', 'email_status', 'mobile_phone', 'phone_status'
  ));

comment on constraint qualification_rules_field_check on public.qualification_rules is
  'Compliance allow-list of professional and business attributes. Protected '
  'personal characteristics cannot be represented here.';
