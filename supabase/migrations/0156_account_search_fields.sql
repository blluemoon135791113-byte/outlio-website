-- ---------------------------------------------------------------------------
-- 0156 — Sales Navigator ACCOUNT SEARCH results: keep what the page shows
--
-- A third saved-page type. An account SEARCH results page
-- (/sales/search/company) lists 25 companies per page with, for each: the
-- company link, industry, headcount, location and the company's own "About"
-- text — which the page truncates on screen and carries IN FULL in the
-- description's title attribute. Validated against a real saved page on
-- 2026-10-03 (kept locally, never committed): 25 of 25 rows carried name,
-- link, industry, headcount and About; location was blank in all 25.
--
-- Its rows are accounts, so they ride the existing account-list pipeline
-- (account_list_entries). That table had no place for headcount, the About
-- text or LinkedIn's per-row signals; these columns are it. Every one is a
-- value READ OFF THE PAGE — nothing here is derived or inferred (rule 4):
--
--   employee_count_snapshot        an exact count the page printed ("253 employees")
--   employee_count_range_snapshot  a range the page printed ("1.2K+") — never
--                                  turned into a number (0145's rule)
--   summary_snapshot               the company's own About text
--   location_snapshot              the headquarters line, when the page has one
--   signals                        LinkedIn's spotlight keys on the row, e.g.
--                                  hiring_on_linkedin — a dated observation
--
-- Plus one index: "Send to CRM" for an account upload records ONE provenance
-- row per (account, upload). Pressing it twice must not append a second.
-- crm_company_sources was empty in production when this was written.
--
-- ⚠️ VALIDATE BEFORE APPLYING:
--   scripts/check-migration.sh supabase/migrations/0156_account_search_fields.sql \
--     supabase/migrations/smoke/0156_account_search_fields.smoke.sql
--
-- APPLY BEFORE DEPLOYING the code that writes these columns. The deployed code
-- never names them, and every new column is nullable or defaulted.
--
-- ROLLBACK:
--   drop index if exists public.crm_company_sources_job_once;
--   alter table public.account_list_entries
--     drop column if exists page_kind, drop column if exists employee_count_snapshot,
--     drop column if exists employee_count_range_snapshot, drop column if exists summary_snapshot,
--     drop column if exists location_snapshot, drop column if exists signals;
-- ---------------------------------------------------------------------------

alter table public.account_list_entries
  add column if not exists page_kind                     text not null default 'account_hub',
  add column if not exists employee_count_snapshot       integer,
  add column if not exists employee_count_range_snapshot text,
  add column if not exists summary_snapshot              text,
  add column if not exists location_snapshot             text,
  add column if not exists signals                       text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'account_list_entries_page_kind_valid') then
    alter table public.account_list_entries
      add constraint account_list_entries_page_kind_valid
        check (page_kind in ('account_hub', 'account_search'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'account_list_entries_employee_count_valid') then
    alter table public.account_list_entries
      add constraint account_list_entries_employee_count_valid
        check (employee_count_snapshot is null or employee_count_snapshot >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'account_list_entries_employee_range_valid') then
    alter table public.account_list_entries
      add constraint account_list_entries_employee_range_valid
        check (employee_count_range_snapshot is null
               or length(btrim(employee_count_range_snapshot)) between 1 and 40);
  end if;
  -- Same bound as crm_companies.summary (0145), so a snapshot always fits.
  if not exists (select 1 from pg_constraint where conname = 'account_list_entries_summary_bounded') then
    alter table public.account_list_entries
      add constraint account_list_entries_summary_bounded
        check (summary_snapshot is null or length(summary_snapshot) <= 5000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'account_list_entries_location_bounded') then
    alter table public.account_list_entries
      add constraint account_list_entries_location_bounded
        check (location_snapshot is null or length(location_snapshot) <= 200);
  end if;
  -- Keys, not prose: lowercase identifiers, a handful per row.
  if not exists (select 1 from pg_constraint where conname = 'account_list_entries_signals_valid') then
    alter table public.account_list_entries
      add constraint account_list_entries_signals_valid
        check (cardinality(signals) <= 10
               and array_to_string(signals, ',') ~ '^([a-z0-9_]{1,60}(,[a-z0-9_]{1,60})*)?$');
  end if;
end
$$;

-- NULLs are distinct, so manual and spreadsheet sources (no extraction job)
-- are unaffected; an upload can cite one account once.
create unique index if not exists crm_company_sources_job_once
  on public.crm_company_sources (company_id, extraction_job_id);

comment on column public.account_list_entries.page_kind is
  'Which saved page the row came from: account_hub (a saved Account List) or account_search (account search results).';
comment on column public.account_list_entries.summary_snapshot is
  'The company''s own About text as the page carried it. Observed, never generated.';
comment on column public.account_list_entries.signals is
  'LinkedIn spotlight keys shown on the row when saved (e.g. hiring_on_linkedin). An observation dated by the job.';
