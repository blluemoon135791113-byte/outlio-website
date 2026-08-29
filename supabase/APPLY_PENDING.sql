-- ===========================================================================
-- OUTLIO — PENDING MIGRATIONS (0065-0067)
-- Updated 2026-08-29
--
-- Account list ingestion and CRM export: captured companies become durable
-- list rows with optional real decision makers and company contact fields.
--
-- All statements are idempotent — safe to re-run:
--   * 0065 is CREATE OR REPLACE FUNCTION.
--   * 0066 uses ADD COLUMN IF NOT EXISTS, a guarded constraint, and
--     CREATE INDEX IF NOT EXISTS.
--   * 0067 adds account rows/columns and broadens an export-link source from
--     lead-only to exactly one of lead or account entry.
--
-- Nothing here drops, renames, or rewrites existing values. Historical jobs
-- and exports remain lead records through their defaults.
--
-- AFTER APPLYING, regenerate types so the hand-written entries in
-- types/database.ts are replaced by generated ones:
--   npx supabase gen types typescript --linked > types/database.ts
-- ===========================================================================


-- ####################  0065_account_list_ingest.sql  ####################

-- ---------------------------------------------------------------------------
-- Account List ingestion
-- ---------------------------------------------------------------------------
--
-- Saved Sales Navigator ACCOUNT lists are a company-volume feature, separate
-- from individual lead extraction. A lead page yields people who happen to
-- have employers; an account list yields companies directly, with no person
-- attached.
--
-- `link_leads_to_companies` (0043) cannot serve this: it requires a lead_id and
-- skips any row without one. This function performs the same identity
-- resolution with no lead, and additionally reports whether the row was
-- CREATED, so ingestion can tell a user "18 new, 7 already known" instead of a
-- single meaningless total.
--
-- The resolution below deliberately mirrors 0043 step for step — precedence,
-- name-row adoption, the contended-retry loop, and the guarded attachment of
-- the weaker identifier. Divergence between the two would mean the same
-- company resolving differently depending on which page it arrived on, which
-- is exactly the duplicate this table's partial unique indexes exist to stop.

create or replace function public.upsert_companies(
  p_user_id   uuid,
  p_companies jsonb
)
returns table (company_id uuid, match_strategy text, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row         jsonb;
  v_name        text;
  v_norm_name   text;
  v_domain      text;
  v_norm_domain text;
  v_li          text;
  v_norm_li     text;
  v_industry    text;
  v_strategy    text;
  v_company_id  uuid;
  v_created     boolean;
  v_attempt     int;
begin
  if p_user_id is null then
    raise exception 'upsert_companies: p_user_id is required';
  end if;

  for v_row in
    select value from jsonb_array_elements(coalesce(p_companies, '[]'::jsonb))
  loop
    v_name        := nullif(v_row ->> 'name', '');
    v_norm_name   := nullif(v_row ->> 'normalized_name', '');
    v_domain      := nullif(v_row ->> 'domain', '');
    v_norm_domain := nullif(v_row ->> 'normalized_domain', '');
    v_li          := nullif(v_row ->> 'linkedin_url', '');
    v_norm_li     := nullif(v_row ->> 'normalized_linkedin_url', '');
    v_industry    := nullif(v_row ->> 'industry', '');

    -- Precedence (spec §9), chosen from what THIS row carries.
    if v_norm_domain is not null then
      v_strategy := 'domain';
    elsif v_norm_li is not null then
      v_strategy := 'linkedin';
    elsif v_norm_name is not null then
      v_strategy := 'name';
    else
      -- Nothing identifies a company. Never invent one.
      continue;
    end if;

    v_company_id := null;
    v_created    := false;
    v_attempt    := 0;

    while v_company_id is null and v_attempt < 3 loop
      v_attempt := v_attempt + 1;

      -- 1 — find by the strongest identifier this row has.
      if v_strategy = 'domain' then
        select c.id into v_company_id
          from public.companies c
         where c.user_id = p_user_id
           and c.normalized_domain = v_norm_domain;
      elsif v_strategy = 'linkedin' then
        select c.id into v_company_id
          from public.companies c
         where c.user_id = p_user_id
           and c.normalized_linkedin_url = v_norm_li;
      else
        select c.id into v_company_id
          from public.companies c
         where c.user_id = p_user_id
           and c.normalized_name = v_norm_name
           and c.normalized_domain is null
           and c.normalized_linkedin_url is null;
      end if;

      exit when v_company_id is not null;

      -- 2 — adopt a name-only row rather than creating a second company. The
      --     same company arrives from a lead page with a website and from an
      --     account list with only a name; promoting the weaker row keeps them
      --     as one company.
      if v_strategy <> 'name' and v_norm_name is not null then
        begin
          if v_strategy = 'domain' then
            update public.companies
               set domain = v_domain, normalized_domain = v_norm_domain
             where user_id = p_user_id
               and normalized_name = v_norm_name
               and normalized_domain is null
               and normalized_linkedin_url is null
            returning id into v_company_id;
          else
            update public.companies
               set linkedin_url = v_li, normalized_linkedin_url = v_norm_li
             where user_id = p_user_id
               and normalized_name = v_norm_name
               and normalized_domain is null
               and normalized_linkedin_url is null
            returning id into v_company_id;
          end if;
        exception when unique_violation then
          -- A concurrent transaction claimed the same identifier. Re-select.
          v_company_id := null;
        end;

        exit when v_company_id is not null;
      end if;

      -- 3 — insert. Only the strategy's own identifier plus the name is
      --     written, so this can only conflict on the index the retry loop
      --     re-reads.
      insert into public.companies (
        user_id, name, normalized_name,
        domain, normalized_domain,
        linkedin_url, normalized_linkedin_url,
        industry
      )
      values (
        p_user_id, v_name, v_norm_name,
        case when v_strategy = 'domain'   then v_domain end,
        case when v_strategy = 'domain'   then v_norm_domain end,
        case when v_strategy = 'linkedin' then v_li end,
        case when v_strategy = 'linkedin' then v_norm_li end,
        v_industry
      )
      on conflict do nothing
      returning id into v_company_id;

      if v_company_id is not null then
        v_created := true;
      end if;
    end loop;

    -- Gave up after three contended attempts. Skip rather than guess.
    continue when v_company_id is null;

    -- 4 — attach the weaker identifier this row also carried, if still free.
    if v_strategy = 'domain' and v_norm_li is not null then
      begin
        update public.companies
           set linkedin_url = v_li, normalized_linkedin_url = v_norm_li
         where id = v_company_id
           and user_id = p_user_id
           and normalized_linkedin_url is null;
      exception when unique_violation then null;
      end;
    end if;

    if v_norm_name is not null then
      update public.companies
         set name = coalesce(name, v_name),
             normalized_name = coalesce(normalized_name, v_norm_name)
       where id = v_company_id
         and user_id = p_user_id;
    end if;

    -- ⚠️ INDUSTRY IS ONLY EVER FILLED IN, NEVER OVERWRITTEN.
    --
    -- `companies.industry` is a projection of `research_evidence`, which is
    -- the source of truth and carries provenance and a TTL. A captured page is
    -- weaker than researched evidence, so it may seed an empty cell and must
    -- not replace a value some provider stood behind.
    if v_industry is not null then
      update public.companies
         set industry = v_industry
       where id = v_company_id
         and user_id = p_user_id
         and industry is null;
    end if;

    company_id     := v_company_id;
    match_strategy := v_strategy;
    created        := v_created;
    return next;
  end loop;
end;
$$;

revoke all on function public.upsert_companies(uuid, jsonb) from public, anon, authenticated;

comment on function public.upsert_companies(uuid, jsonb) is
  'Upserts companies from a saved account list. Service-role only; every read '
  'and write is scoped by p_user_id. Mirrors link_leads_to_companies identity '
  'resolution so a company resolves identically whichever page it arrived on.';


-- ####################  0066_account_list_jobs.sql  ####################

-- ---------------------------------------------------------------------------
-- Account list jobs
-- ---------------------------------------------------------------------------
--
-- Account lists reuse `extraction_jobs` rather than getting a table of their
-- own. The queue, `claim_next_job`, `FOR UPDATE SKIP LOCKED`, attempt counts,
-- backoff and the stale-claim reaper are the hard parts of this pipeline and
-- are already correct here. A parallel `account_jobs` table would duplicate
-- every one of them and drift.
--
-- What differs is only the OUTPUT: a lead job yields people, an account job
-- yields companies, so the counters cannot share columns. Reporting "25 leads
-- kept" for a run that produced 25 companies would be a lie in the one place a
-- user checks what a run did.

alter table public.extraction_jobs
  add column if not exists kind text not null default 'lead_search',
  add column if not exists accounts_parsed int not null default 0,
  add column if not exists accounts_created int not null default 0,
  add column if not exists accounts_matched int not null default 0,
  add column if not exists accounts_unidentified int not null default 0;

-- ⚠️ THE DEFAULT IS `lead_search`, WHICH IS CORRECT FOR EVERY EXISTING ROW.
-- Account lists could not be ingested before this migration, so no historical
-- job can be one. A nullable column would have forced every reader to handle
-- "unknown kind", which is a state that has never existed.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'extraction_jobs_kind_check'
  ) then
    alter table public.extraction_jobs
      add constraint extraction_jobs_kind_check
      check (kind in ('lead_search', 'account_list'));
  end if;
end $$;

comment on column public.extraction_jobs.kind is
  'What this run ingests. lead_search yields people; account_list yields '
  'companies. Set by the worker from the detected page type, never by the '
  'client — the browser does not know what is inside the file it uploaded.';

comment on column public.extraction_jobs.accounts_unidentified is
  'Account rows carrying nothing that identifies a company. Recorded rather '
  'than dropped so "25 rows in, 18 companies out" is explainable.';

-- Counting a tenant's account runs without scanning their lead runs.
create index if not exists extraction_jobs_user_kind_idx
  on public.extraction_jobs (user_id, kind, created_at desc);


-- ####################  0067_account_list_crm_exports.sql  ####################

create table if not exists public.account_list_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  extraction_job_id uuid not null references public.extraction_jobs(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  source_row_index integer not null check (source_row_index >= 0),
  source_list text,
  company_name_snapshot text not null,
  company_sales_navigator_url text not null,
  industry_snapshot text,
  connection_paths text,
  alert text,
  recommended_contact_name text,
  recommended_contact_job_title text,
  recommended_contact_sales_nav_url text,
  recommended_contact_member_id text,
  recommended_contact_connection text,
  recommended_lead_id uuid references public.extracted_leads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (extraction_job_id, company_id)
);

drop trigger if exists account_list_entries_set_updated_at on public.account_list_entries;
create trigger account_list_entries_set_updated_at
  before update on public.account_list_entries
  for each row execute function public.set_updated_at();

create index if not exists account_list_entries_user_job_idx
  on public.account_list_entries (user_id, extraction_job_id, source_row_index);
create index if not exists account_list_entries_company_idx
  on public.account_list_entries (user_id, company_id);
create index if not exists account_list_entries_recommended_lead_idx
  on public.account_list_entries (user_id, recommended_lead_id)
  where recommended_lead_id is not null;

alter table public.account_list_entries enable row level security;
drop policy if exists account_list_entries_select_own on public.account_list_entries;
create policy account_list_entries_select_own on public.account_list_entries
  for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

revoke all on table public.account_list_entries from public, anon, authenticated;
grant select on table public.account_list_entries to authenticated;
grant select, insert, update, delete on table public.account_list_entries to service_role;

alter table public.companies
  add column if not exists contact_email text,
  add column if not exists contact_email_status text,
  add column if not exists contact_phone text,
  add column if not exists contact_phone_status text;

alter table public.export_jobs
  add column if not exists record_type text not null default 'lead',
  add column if not exists account_count integer not null default 0
    check (account_count >= 0);

do $$ begin
  alter table public.export_jobs
    add constraint export_jobs_record_type_check
    check (record_type in ('lead', 'account'));
exception when duplicate_object then null; end $$;

alter table public.export_job_errors
  add column if not exists account_list_entry_id uuid
    references public.account_list_entries(id) on delete set null;

create index if not exists export_job_errors_account_entry_idx
  on public.export_job_errors (user_id, account_list_entry_id)
  where account_list_entry_id is not null;

alter table public.integration_record_links
  alter column lead_id drop not null,
  add column if not exists account_list_entry_id uuid
    references public.account_list_entries(id) on delete cascade;

do $$ begin
  alter table public.integration_record_links
    add constraint integration_record_links_one_source_check
    check (num_nonnulls(lead_id, account_list_entry_id) = 1);
exception when duplicate_object then null; end $$;

create unique index if not exists integration_record_links_account_entry_uniq
  on public.integration_record_links (connection_id, account_list_entry_id)
  where account_list_entry_id is not null;

create index if not exists integration_record_links_account_entry_idx
  on public.integration_record_links (user_id, account_list_entry_id)
  where account_list_entry_id is not null;

alter table public.qualification_rules
  drop constraint if exists qualification_rules_field_check;

alter table public.qualification_rules
  add constraint qualification_rules_field_check check (field in (
    'company_domain', 'employee_count', 'industry', 'headquarters',
    'company_description', 'company_linkedin', 'company_contact_email',
    'company_contact_phone', 'specialties', 'business_model', 'revenue_estimate',
    'company_number', 'company_status', 'company_type', 'jurisdiction',
    'incorporation_date', 'sic_codes', 'registered_office',
    'accounts_overdue', 'confirmation_statement_overdue', 'insolvency_history',
    'lei_number',
    'sec_cik', 'sec_legal_name', 'sec_entity_type', 'sec_sic',
    'sec_sic_description', 'sec_ein', 'sec_lei', 'sec_tickers', 'sec_exchanges',
    'sec_state_of_incorporation', 'sec_business_address', 'sec_website',
    'sec_former_names', 'sec_filing_history',
    'federal_awards_total', 'federal_awards_count', 'federal_award_types',
    'federal_recipient_name',
    'employee_growth', 'tech_churn', 'company_age', 'funding_recency',
    'funding_round', 'funding_amount', 'funding_currency', 'funding_date',
    'funding_investors',
    'tech_stack', 'product_launches', 'recent_news', 'hiring_signals',
    'competitors', 'website_signals', 'pricing_signals',
    'review_presence', 'review_rating', 'review_count', 'github_presence',
    'social_profiles',
    'person_seniority', 'person_department', 'person_social_profiles',
    'work_email', 'email_status', 'mobile_phone', 'phone_status'
  ));
