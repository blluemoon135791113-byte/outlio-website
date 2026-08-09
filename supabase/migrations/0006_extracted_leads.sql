-- 0006 — extracted_leads
--
-- COLUMNS COME FROM docs/SELECTOR_MAP.md §3 — the validated field map.
-- Do NOT add a column the parser cannot populate.
-- Do NOT silently drop a column it does populate.
-- Fields LinkedIn no longer exposes are recorded in docs/UNSUPPORTED_FIELDS.md.
--
-- Every lead column is NULLABLE. The validation sample showed 100% presence on
-- all ten fields, but one page is not proof of non-nullability.

create table if not exists public.extracted_leads (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  extraction_job_id uuid not null references public.extraction_jobs(id) on delete cascade,
  uploaded_file_id  uuid references public.uploaded_files(id) on delete set null,

  -- ---- parsed fields (SELECTOR_MAP §3) ----------------------------------
  full_name         text,   -- span[data-anonymize="person-name"]
  linkedin_url      text,   -- nearest ancestor a[href] of the name span
  job_title         text,   -- span[data-anonymize="title"]   <- NOT "job-title"
  company_name      text,   -- a[data-anonymize="company-name"]
  company_url       text,   -- same element, href
  location          text,   -- span[data-anonymize="location"]
  person_blurb      text,   -- div[data-anonymize="person-blurb"]
  tenure_in_role    text,   -- div[data-anonymize="job-title"], "…in role" node
  tenure_in_company text,   -- div[data-anonymize="job-title"], "…in company" node

  -- ---- provenance and dedupe --------------------------------------------
  source_page       text,
  source_row_index  int,
  dedupe_key        text not null,
  dedupe_strategy   public.dedupe_strategy not null,
  is_duplicate      boolean not null default false,
  duplicate_of_id   uuid references public.extracted_leads(id) on delete set null,

  -- Parser-emitted fields with no dedicated column.
  -- MUST NEVER contain source HTML, cookies, tokens, or auth headers.
  -- Enforced by an allow-list in the worker, not by this comment.
  raw_data          jsonb,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists extracted_leads_set_updated_at on public.extracted_leads;
create trigger extracted_leads_set_updated_at
  before update on public.extracted_leads
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Indexes: every FK, plus every column used in WHERE / ORDER BY on a list screen
-- ---------------------------------------------------------------------------

create index if not exists extracted_leads_user_idx        on public.extracted_leads (user_id);
create index if not exists extracted_leads_job_idx         on public.extracted_leads (user_id, extraction_job_id);
create index if not exists extracted_leads_file_idx        on public.extracted_leads (uploaded_file_id);
create index if not exists extracted_leads_dedupe_idx      on public.extracted_leads (user_id, dedupe_key);
create index if not exists extracted_leads_duplicate_idx   on public.extracted_leads (user_id, is_duplicate);
create index if not exists extracted_leads_duplicate_of_idx on public.extracted_leads (duplicate_of_id);
create index if not exists extracted_leads_created_idx     on public.extracted_leads (user_id, created_at desc);

-- Sort columns on the leads table
create index if not exists extracted_leads_name_idx    on public.extracted_leads (user_id, full_name);
create index if not exists extracted_leads_company_idx on public.extracted_leads (user_id, company_name);

-- Trigram indexes for debounced search over the searchable text columns
create index if not exists extracted_leads_name_trgm
  on public.extracted_leads using gin (full_name extensions.gin_trgm_ops);
create index if not exists extracted_leads_company_trgm
  on public.extracted_leads using gin (company_name extensions.gin_trgm_ops);
create index if not exists extracted_leads_title_trgm
  on public.extracted_leads using gin (job_title extensions.gin_trgm_ops);
create index if not exists extracted_leads_location_trgm
  on public.extracted_leads using gin (location extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.extracted_leads enable row level security;

drop policy if exists extracted_leads_select_own on public.extracted_leads;
create policy extracted_leads_select_own on public.extracted_leads
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

drop policy if exists extracted_leads_insert_own on public.extracted_leads;
create policy extracted_leads_insert_own on public.extracted_leads
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists extracted_leads_update_own on public.extracted_leads;
create policy extracted_leads_update_own on public.extracted_leads
  for update to authenticated
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

drop policy if exists extracted_leads_delete_own on public.extracted_leads;
create policy extracted_leads_delete_own on public.extracted_leads
  for delete to authenticated using (auth.uid() = user_id or public.is_admin());
