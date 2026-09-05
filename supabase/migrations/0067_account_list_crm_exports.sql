-- 0067 — durable Account List rows and CRM export identities
--
-- An account-list extraction previously wrote companies and a CSV, then
-- discarded the list membership and LinkedIn's recommended decision maker.
-- That made every non-CSV export impossible: there was no trusted row to load
-- after the worker finished. This table is the durable, tenant-scoped source
-- for one company row in one Account List run.

create table if not exists public.account_list_entries (
  id                                  uuid primary key default gen_random_uuid(),
  user_id                             uuid not null references auth.users(id) on delete cascade,
  extraction_job_id                   uuid not null references public.extraction_jobs(id) on delete cascade,
  company_id                          uuid not null references public.companies(id) on delete cascade,
  source_row_index                    integer not null check (source_row_index >= 0),
  source_list                         text,

  -- Captured company values. Research-grade values remain on companies /
  -- research_evidence and are joined at export time.
  company_name_snapshot               text not null,
  company_sales_navigator_url         text not null,
  industry_snapshot                   text,
  connection_paths                    text,
  alert                               text,

  -- The recommendation is a real person visible on the captured Account List
  -- row. It is optional and never synthesized when LinkedIn did not show one.
  recommended_contact_name            text,
  recommended_contact_job_title       text,
  recommended_contact_sales_nav_url   text,
  recommended_contact_member_id       text,
  recommended_contact_connection      text,
  recommended_lead_id                 uuid references public.extracted_leads(id) on delete set null,

  created_at                          timestamptz not null default now(),
  updated_at                          timestamptz not null default now(),

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

comment on table public.account_list_entries is
  'One company row in one saved Sales Navigator Account List. Preserves the '
  'captured recommendation and provides a stable source identity for exports.';

-- Company contact values are projections only. research_evidence remains the
-- provenance-bearing source of truth; these columns make list/export reads
-- bounded and avoid a many-row evidence join on every dashboard request.
alter table public.companies
  add column if not exists contact_email text,
  add column if not exists contact_email_status text,
  add column if not exists contact_phone text,
  add column if not exists contact_phone_status text;

-- Export accounting distinguishes person rows from account rows without
-- repurposing lead_count and corrupting historical analytics.
alter table public.export_jobs
  add column if not exists record_type text not null default 'lead',
  add column if not exists account_count integer not null default 0
    check (account_count >= 0);

do $$ begin
  alter table public.export_jobs
    add constraint export_jobs_record_type_check
    check (record_type in ('lead', 'account'));
exception when duplicate_object then null; end $$;

-- Safe, per-record account failures use the same audit table as lead errors.
alter table public.export_job_errors
  add column if not exists account_list_entry_id uuid
    references public.account_list_entries(id) on delete set null;

create index if not exists export_job_errors_account_entry_idx
  on public.export_job_errors (user_id, account_list_entry_id)
  where account_list_entry_id is not null;

-- A repeated account export must update/link the same provider record instead
-- of creating a fresh CRM contact each time. Existing lead links stay valid.
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

-- Qualification vocabulary is a database compliance boundary and must remain
-- exactly aligned with RESEARCH_FIELDS when company contact facts are added.
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
