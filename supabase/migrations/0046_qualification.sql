-- 0046 — qualification profiles, rules, and results
--
-- The ICP Fit Score is DETERMINISTIC ARITHMETIC computed in
-- lib/qualification/score.ts. Nothing here stores a model's opinion: these
-- tables hold the criteria a user configured and the results those criteria
-- produced, so a score can always be recomputed and defended.
--
-- ⚠️ SPEC §44. Qualification is restricted to legitimate business attributes.
-- The `field` column is constrained to the research vocabulary, so a criterion
-- on race, religion, health, or any other protected characteristic cannot be
-- stored — not merely discouraged in the UI, but impossible in the schema.

create table if not exists public.qualification_profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 120),
  description  text,
  /**
   * Score at or above which a lead counts as qualified. Stored per profile so
   * "qualified" means something the user chose, not a hardcoded number.
   */
  qualify_at   integer not null default 60 check (qualify_at between 0 and 100),
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (id, user_id),
  unique (user_id, name)
);

drop trigger if exists qualification_profiles_set_updated_at on public.qualification_profiles;
create trigger qualification_profiles_set_updated_at
  before update on public.qualification_profiles
  for each row execute function public.set_updated_at();

create index if not exists qualification_profiles_user_idx
  on public.qualification_profiles (user_id, is_archived);

alter table public.qualification_profiles enable row level security;

drop policy if exists qualification_profiles_select_own on public.qualification_profiles;
create policy qualification_profiles_select_own on public.qualification_profiles
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

revoke all on table public.qualification_profiles from public, anon, authenticated;
grant select on table public.qualification_profiles to authenticated;
grant select, insert, update, delete on table public.qualification_profiles to service_role;

-- ---------------------------------------------------------------------------
-- qualification_rules
-- ---------------------------------------------------------------------------

create table if not exists public.qualification_rules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  profile_id  uuid not null,

  /*
   * ⚠️ THE COMPLIANCE BOUNDARY (spec §44).
   *
   * Constrained to the research field vocabulary. Everything in this list is a
   * business attribute; nothing in it can express a protected characteristic.
   * Adding a field here is a deliberate act, which is the point.
   */
  field       text not null check (field in (
    'company_domain', 'employee_count', 'industry', 'headquarters',
    'company_description', 'business_model', 'revenue_estimate',
    'funding_round', 'funding_amount', 'funding_currency', 'funding_date',
    'funding_investors', 'tech_stack', 'product_launches', 'recent_news',
    'hiring_signals', 'competitors', 'website_signals', 'pricing_signals',
    'review_presence', 'review_rating', 'review_count', 'github_presence',
    'work_email', 'email_status', 'mobile_phone', 'phone_status'
  )),

  operator    text not null check (operator in (
    'equals', 'not_equals', 'in', 'not_in', 'between',
    'gte', 'lte', 'contains', 'not_contains', 'exists'
  )),

  /** Comparison value. jsonb so a range, a list, or a scalar all fit. */
  value       jsonb,
  /** Where in the evidence payload to read, e.g. `detected`. NULL = default. */
  value_path  text,

  weight      integer not null default 10 check (weight between 0 and 100),
  kind        text not null default 'preferred'
                check (kind in ('required', 'preferred', 'excluded')),
  sort_order  integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Both sides of the link must belong to the same tenant.
  foreign key (profile_id, user_id)
    references public.qualification_profiles(id, user_id) on delete cascade
);

drop trigger if exists qualification_rules_set_updated_at on public.qualification_rules;
create trigger qualification_rules_set_updated_at
  before update on public.qualification_rules
  for each row execute function public.set_updated_at();

create index if not exists qualification_rules_profile_idx
  on public.qualification_rules (profile_id, sort_order);

alter table public.qualification_rules enable row level security;

drop policy if exists qualification_rules_select_own on public.qualification_rules;
create policy qualification_rules_select_own on public.qualification_rules
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

revoke all on table public.qualification_rules from public, anon, authenticated;
grant select on table public.qualification_rules to authenticated;
grant select, insert, update, delete on table public.qualification_rules to service_role;

comment on column public.qualification_rules.field is
  'Constrained to the research vocabulary. Qualification on protected '
  'characteristics is impossible by schema, not merely discouraged (spec §44).';

-- ---------------------------------------------------------------------------
-- qualification_results
--
-- One row per entity per run. `breakdown` holds the per-criterion outcomes so
-- "why qualified?" is answered from the arithmetic that produced the score,
-- never from prose written afterwards.
-- ---------------------------------------------------------------------------

create table if not exists public.qualification_results (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  research_run_id  uuid references public.research_runs(id) on delete cascade,
  profile_id       uuid,

  entity_type      text not null check (entity_type in ('company', 'person')),
  entity_id        uuid not null,

  score            integer not null check (score between 0 and 100),
  qualified        boolean not null,
  /** The criterion id that disqualified this entity, when one did. */
  disqualified_by  text,
  /**
   * Criteria that could not be evaluated. Surfaced so a result can honestly
   * say "scored on 6 of 8" rather than presenting a falsely precise number.
   */
  unknown_count    integer not null default 0 check (unknown_count >= 0),
  breakdown        jsonb not null default '[]'::jsonb,

  created_at       timestamptz not null default now(),

  foreign key (profile_id, user_id)
    references public.qualification_profiles(id, user_id) on delete set null
);

create index if not exists qualification_results_run_idx
  on public.qualification_results (research_run_id, score desc);
create index if not exists qualification_results_entity_idx
  on public.qualification_results (user_id, entity_type, entity_id);

alter table public.qualification_results enable row level security;

drop policy if exists qualification_results_select_own on public.qualification_results;
create policy qualification_results_select_own on public.qualification_results
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

revoke all on table public.qualification_results from public, anon, authenticated;
grant select on table public.qualification_results to authenticated;
grant select, insert, update, delete on table public.qualification_results to service_role;
