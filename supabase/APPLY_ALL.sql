-- OUTLIO - ALL MIGRATIONS. Generated 2026-08-09. Idempotent.

-- ####################  0001_extensions_enums_functions.sql  ####################

-- 0001 — extensions, enum types, shared trigger functions
-- Forward-only. Idempotent.

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "pg_trgm";       -- trigram search on lead text

-- ---------------------------------------------------------------------------
-- Enums. Postgres types, not free-text checks, so app and DB cannot drift.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.user_role as enum (
    'registered_user', 'pending_user', 'approved_user',
    'subscriber', 'admin', 'suspended_user'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.access_request_type as enum (
    'payment', 'sales_call', 'manual_approval', 'trial', 'invitation'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.access_request_status as enum (
    'pending', 'approved', 'rejected', 'expired', 'suspended'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_status as enum (
    'uploaded', 'queued', 'processing', 'completed',
    'partially_completed', 'failed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.file_status as enum (
    'pending', 'processing', 'processed', 'failed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.queue_status as enum (
    'pending', 'claimed', 'done', 'failed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.dedupe_mode as enum (
    'keep_all', 'remove_exact', 'remove_likely', 'review'
  );
exception when duplicate_object then null; end $$;

-- Priority order matters — see docs/ARCHITECTURE.md and spec 12.1
do $$ begin
  create type public.dedupe_strategy as enum (
    'linkedin_url_canonical', 'salesnav_id',
    'name_company', 'name_title_company', 'row_hash'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.plan_key as enum (
    'trial', 'starter', 'professional', 'agency', 'custom'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.subscription_status as enum (
    'active', 'past_due', 'cancelled', 'expired'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Authoritative admin check. Reads profiles.role, never a client-supplied claim.
--
-- DELIBERATELY plpgsql, not sql. A `language sql` body is parsed and validated
-- at CREATE time, which would require public.profiles to already exist and force
-- this function after 0003 — but the policies in 0002 already need it. plpgsql
-- bodies resolve table references at execution time instead, so this function
-- can be defined before the table it reads.
create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
end;
$$;

-- Append-only guard. Attached to audit tables.
create or replace function public.deny_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Table %.% is append-only; % is not permitted',
    tg_table_schema, tg_table_name, tg_op;
end;
$$;

-- ####################  0002_plans.sql  ####################

-- 0002 — plans
-- All limits live in plans.limits (jsonb) and are read at runtime.
-- NO LIMIT IS EVER HARDCODED IN APPLICATION CODE.

create table if not exists public.plans (
  id          uuid primary key default gen_random_uuid(),
  key         public.plan_key not null unique,
  name        text not null,
  description text,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  limits      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists plans_set_updated_at on public.plans;
create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

create index if not exists plans_is_active_idx on public.plans (is_active);

-- Readable by any authenticated user (pricing display). Writable only by admins.
alter table public.plans enable row level security;

drop policy if exists plans_select_all on public.plans;
create policy plans_select_all on public.plans
  for select to authenticated using (true);

drop policy if exists plans_admin_write on public.plans;
create policy plans_admin_write on public.plans
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Seed — PLACEHOLDER VALUES, PENDING FINAL PRICING
--
-- Metrics per spec 12.9. `null` means unlimited.
-- Change these in the database, never in code.
-- ---------------------------------------------------------------------------

insert into public.plans (key, name, description, sort_order, limits) values
  ('trial', 'Trial', 'PLACEHOLDER — pending final pricing', 1, jsonb_build_object(
      'files_per_extraction', 5,
      'extractions_per_day', 3,
      'extractions_per_month', 3,
      'records_per_extraction', 500,
      'records_per_month', 500,
      'storage_bytes', 104857600,
      'exports_per_month', 5,
      'retention_days', 7
  )),
  ('starter', 'Starter', 'PLACEHOLDER — pending final pricing', 2, jsonb_build_object(
      'files_per_extraction', 25,
      'extractions_per_day', 10,
      'extractions_per_month', 30,
      'records_per_extraction', 5000,
      'records_per_month', 10000,
      'storage_bytes', 1073741824,
      'exports_per_month', 50,
      'retention_days', 90
  )),
  ('professional', 'Professional', 'PLACEHOLDER — pending final pricing', 3, jsonb_build_object(
      'files_per_extraction', 100,
      'extractions_per_day', 25,
      'extractions_per_month', 150,
      'records_per_extraction', 25000,
      'records_per_month', 75000,
      'storage_bytes', 10737418240,
      'exports_per_month', 500,
      'retention_days', 365
  )),
  ('agency', 'Agency', 'PLACEHOLDER — pending final pricing', 4, jsonb_build_object(
      'files_per_extraction', 250,
      'extractions_per_day', 100,
      'extractions_per_month', 500,
      'records_per_extraction', 100000,
      'records_per_month', 300000,
      'storage_bytes', 53687091200,
      'exports_per_month', null,
      'retention_days', 730
  )),
  ('custom', 'Custom', 'PLACEHOLDER — configured per customer', 5, jsonb_build_object(
      'files_per_extraction', null,
      'extractions_per_day', null,
      'extractions_per_month', null,
      'records_per_extraction', null,
      'records_per_month', null,
      'storage_bytes', null,
      'exports_per_month', null,
      'retention_days', 730
  ))
on conflict (key) do nothing;

-- ####################  0003_profiles.sql  ####################

-- 0003 — profiles
-- id is BOTH primary key and FK to auth.users(id).
-- role is NOT user-updatable. Enforced by trigger, not by policy alone.

create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text,
  full_name          text,
  company_name       text,
  role               public.user_role not null default 'registered_user',
  plan_id            uuid references public.plans(id) on delete set null,
  access_expires_at  timestamptz,
  suspended_at       timestamptz,
  suspended_reason   text,
  consent_accepted_at timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create index if not exists profiles_role_idx       on public.profiles (role);
create index if not exists profiles_plan_id_idx    on public.profiles (plan_id);
create index if not exists profiles_deleted_at_idx on public.profiles (deleted_at);
create index if not exists profiles_expires_idx    on public.profiles (access_expires_at);

-- ---------------------------------------------------------------------------
-- Auto-create a profile when an auth user is created.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- PRIVILEGE ESCALATION GUARD
--
-- A user may update only full_name and company_name. Any attempt to change a
-- privileged column is silently reverted to the stored value. The service role
-- and admins bypass this via the is_admin() / role check below.
--
-- This is a TRIGGER, not just a policy, because a policy alone cannot express
-- "these columns are frozen but the row is otherwise writable".
-- ---------------------------------------------------------------------------

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is null for the service role and for the worker; allow those.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  new.role                := old.role;
  new.plan_id             := old.plan_id;
  new.access_expires_at   := old.access_expires_at;
  new.suspended_at        := old.suspended_at;
  new.suspended_reason    := old.suspended_reason;
  new.deleted_at          := old.deleted_at;
  new.created_at          := old.created_at;
  new.id                  := old.id;

  return new;
end;
$$;

drop trigger if exists profiles_protect_columns on public.profiles;
create trigger profiles_protect_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (auth.uid() = id or public.is_admin());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

-- No INSERT policy: profiles are created only by the on_auth_user_created
-- trigger (security definer). No DELETE policy: removal cascades from
-- auth.users. Both omissions are deliberate.

-- ####################  0004_access_subscriptions_usage.sql  ####################

-- 0004 — access_requests, subscriptions, usage_counters, invitation_codes

-- ---------------------------------------------------------------------------
-- access_requests
-- ---------------------------------------------------------------------------

create table if not exists public.access_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  request_type  public.access_request_type not null,
  status        public.access_request_status not null default 'pending',
  message       text,
  admin_note    text,
  reviewed_by   uuid references auth.users(id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists access_requests_set_updated_at on public.access_requests;
create trigger access_requests_set_updated_at
  before update on public.access_requests
  for each row execute function public.set_updated_at();

create index if not exists access_requests_user_id_idx on public.access_requests (user_id);
create index if not exists access_requests_status_idx  on public.access_requests (status);
create index if not exists access_requests_created_idx on public.access_requests (created_at desc);

-- At most one pending request per user.
create unique index if not exists access_requests_one_pending_per_user
  on public.access_requests (user_id)
  where status = 'pending';

alter table public.access_requests enable row level security;

drop policy if exists access_requests_select_own on public.access_requests;
create policy access_requests_select_own on public.access_requests
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

drop policy if exists access_requests_insert_own on public.access_requests;
create policy access_requests_insert_own on public.access_requests
  for insert to authenticated with check (auth.uid() = user_id);

-- Users may NOT update their own request (that would let them self-approve).
drop policy if exists access_requests_admin_update on public.access_requests;
create policy access_requests_admin_update on public.access_requests
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- subscriptions (entitlements)
-- ---------------------------------------------------------------------------

create table if not exists public.subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  plan_id            uuid not null references public.plans(id) on delete restrict,
  status             public.subscription_status not null default 'active',
  provider           text not null default 'manual',
  provider_ref       text,
  current_period_start timestamptz not null default now(),
  current_period_end   timestamptz,
  cancel_at          timestamptz,
  cancelled_at       timestamptz,
  granted_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);
create index if not exists subscriptions_plan_id_idx on public.subscriptions (plan_id);
create index if not exists subscriptions_status_idx  on public.subscriptions (status);
create unique index if not exists subscriptions_provider_ref_uniq
  on public.subscriptions (provider, provider_ref)
  where provider_ref is not null;

alter table public.subscriptions enable row level security;

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

-- Writes happen through grantEntitlement() with the service role, or by admins.
drop policy if exists subscriptions_admin_write on public.subscriptions;
create policy subscriptions_admin_write on public.subscriptions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- usage_counters
-- Incremented in the SAME transaction as the action being measured.
-- ---------------------------------------------------------------------------

create table if not exists public.usage_counters (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  metric       text not null,
  period_start timestamptz not null,
  period_end   timestamptz not null,
  count        bigint not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint usage_counters_metric_check check (
    metric in ('extractions', 'files', 'records', 'exports', 'storage_bytes')
  ),
  constraint usage_counters_count_nonneg check (count >= 0)
);

drop trigger if exists usage_counters_set_updated_at on public.usage_counters;
create trigger usage_counters_set_updated_at
  before update on public.usage_counters
  for each row execute function public.set_updated_at();

create unique index if not exists usage_counters_unique
  on public.usage_counters (user_id, metric, period_start);
create index if not exists usage_counters_user_idx on public.usage_counters (user_id);

alter table public.usage_counters enable row level security;

drop policy if exists usage_counters_select_own on public.usage_counters;
create policy usage_counters_select_own on public.usage_counters
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

-- Increments are service-role only. No user-facing write policy, deliberately.

-- ---------------------------------------------------------------------------
-- invitation_codes
-- Codes are generated server-side and compared in constant time in app code.
-- ---------------------------------------------------------------------------

create table if not exists public.invitation_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  plan_id     uuid references public.plans(id) on delete set null,
  max_uses    int not null default 1,
  used_count  int not null default 0,
  expires_at  timestamptz,
  is_active   boolean not null default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint invitation_codes_uses_check check (used_count <= max_uses),
  constraint invitation_codes_max_uses_check check (max_uses > 0)
);

drop trigger if exists invitation_codes_set_updated_at on public.invitation_codes;
create trigger invitation_codes_set_updated_at
  before update on public.invitation_codes
  for each row execute function public.set_updated_at();

create index if not exists invitation_codes_active_idx on public.invitation_codes (is_active);

alter table public.invitation_codes enable row level security;

-- Admins only. Redemption runs through the service role so a user can never
-- read the code table to enumerate valid codes.
drop policy if exists invitation_codes_admin_all on public.invitation_codes;
create policy invitation_codes_admin_all on public.invitation_codes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ####################  0005_jobs_files_queue.sql  ####################

-- 0005 — extraction_jobs, uploaded_files, job_queue

-- ---------------------------------------------------------------------------
-- extraction_jobs
-- ---------------------------------------------------------------------------

create table if not exists public.extraction_jobs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  status              public.job_status not null default 'uploaded',
  dedupe_mode         public.dedupe_mode not null default 'remove_exact',

  file_count          int not null default 0,
  total_bytes         bigint not null default 0,

  progress_step       text,
  progress_current    int not null default 0,
  progress_total      int not null default 0,

  leads_parsed        int not null default 0,
  leads_kept          int not null default 0,
  duplicates_found    int not null default 0,
  duplicates_removed  int not null default 0,

  export_storage_path text,
  error_code          text,
  error_message       text,
  request_id          text,

  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists extraction_jobs_set_updated_at on public.extraction_jobs;
create trigger extraction_jobs_set_updated_at
  before update on public.extraction_jobs
  for each row execute function public.set_updated_at();

create index if not exists extraction_jobs_user_idx    on public.extraction_jobs (user_id);
create index if not exists extraction_jobs_status_idx  on public.extraction_jobs (status);
create index if not exists extraction_jobs_created_idx on public.extraction_jobs (user_id, created_at desc);

alter table public.extraction_jobs enable row level security;

drop policy if exists extraction_jobs_select_own on public.extraction_jobs;
create policy extraction_jobs_select_own on public.extraction_jobs
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

drop policy if exists extraction_jobs_insert_own on public.extraction_jobs;
create policy extraction_jobs_insert_own on public.extraction_jobs
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists extraction_jobs_update_own on public.extraction_jobs;
create policy extraction_jobs_update_own on public.extraction_jobs
  for update to authenticated
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

drop policy if exists extraction_jobs_delete_own on public.extraction_jobs;
create policy extraction_jobs_delete_own on public.extraction_jobs
  for delete to authenticated using (auth.uid() = user_id or public.is_admin());

-- ---------------------------------------------------------------------------
-- uploaded_files
-- storage_path is ALWAYS server-generated: {user_id}/{job_id}/{uuid}.html
-- original_filename is a display string only — it never touches a filesystem
-- path or a shell argument.
-- ---------------------------------------------------------------------------

create table if not exists public.uploaded_files (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  extraction_job_id uuid not null references public.extraction_jobs(id) on delete cascade,

  original_filename text not null,
  storage_path      text not null unique,
  byte_size         bigint not null,
  content_sha256    char(64) not null,

  status            public.file_status not null default 'pending',
  leads_found       int not null default 0,
  error_code        text,
  error_message     text,

  processed_at      timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint uploaded_files_byte_size_check check (byte_size > 0)
);

drop trigger if exists uploaded_files_set_updated_at on public.uploaded_files;
create trigger uploaded_files_set_updated_at
  before update on public.uploaded_files
  for each row execute function public.set_updated_at();

create index if not exists uploaded_files_user_idx   on public.uploaded_files (user_id);
create index if not exists uploaded_files_job_idx    on public.uploaded_files (extraction_job_id);
create index if not exists uploaded_files_status_idx on public.uploaded_files (status);

-- Detect re-upload of identical content. Surfaced as a WARNING, not a hard
-- error — reprocessing the same file can be intentional.
create unique index if not exists uploaded_files_user_sha_uniq
  on public.uploaded_files (user_id, content_sha256)
  where deleted_at is null;

alter table public.uploaded_files enable row level security;

drop policy if exists uploaded_files_select_own on public.uploaded_files;
create policy uploaded_files_select_own on public.uploaded_files
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

drop policy if exists uploaded_files_insert_own on public.uploaded_files;
create policy uploaded_files_insert_own on public.uploaded_files
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists uploaded_files_delete_own on public.uploaded_files;
create policy uploaded_files_delete_own on public.uploaded_files
  for delete to authenticated using (auth.uid() = user_id or public.is_admin());

-- ---------------------------------------------------------------------------
-- job_queue
-- RLS ENABLED, NO POLICIES → denies all access to non-service-role clients.
-- That is the correct and deliberate default for a table only the worker touches.
-- ---------------------------------------------------------------------------

create table if not exists public.job_queue (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null unique references public.extraction_jobs(id) on delete cascade,
  status          public.queue_status not null default 'pending',
  attempts        int not null default 0,
  max_attempts    int not null default 3,
  claimed_at      timestamptz,
  claimed_by      text,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists job_queue_set_updated_at on public.job_queue;
create trigger job_queue_set_updated_at
  before update on public.job_queue
  for each row execute function public.set_updated_at();

-- The claim query orders by next_attempt_at among pending rows.
create index if not exists job_queue_claim_idx
  on public.job_queue (status, next_attempt_at)
  where status = 'pending';
create index if not exists job_queue_stale_idx
  on public.job_queue (status, claimed_at)
  where status = 'claimed';

alter table public.job_queue enable row level security;
-- Intentionally no policies.

-- ####################  0006_extracted_leads.sql  ####################

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
  on public.extracted_leads using gin (full_name gin_trgm_ops);
create index if not exists extracted_leads_company_trgm
  on public.extracted_leads using gin (company_name gin_trgm_ops);
create index if not exists extracted_leads_title_trgm
  on public.extracted_leads using gin (job_title gin_trgm_ops);
create index if not exists extracted_leads_location_trgm
  on public.extracted_leads using gin (location gin_trgm_ops);

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

-- ####################  0007_audit_and_events.sql  ####################

-- 0007 — admin_audit_logs (append-only), system_events

-- ---------------------------------------------------------------------------
-- admin_audit_logs
--
-- APPEND-ONLY. Triggers raise on UPDATE and DELETE for every role, including
-- the service role. Every state-changing admin action must write a row here in
-- the SAME TRANSACTION as the change it describes — if this write fails, the
-- action rolls back.
-- ---------------------------------------------------------------------------

create table if not exists public.admin_audit_logs (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid references auth.users(id) on delete set null,
  action       text not null,
  target_type  text,
  target_id    uuid,
  target_user_id uuid references auth.users(id) on delete set null,
  before_state jsonb,
  after_state  jsonb,
  reason       text,
  request_id   text,
  ip_address   inet,
  created_at   timestamptz not null default now()
);

create index if not exists admin_audit_logs_admin_idx   on public.admin_audit_logs (admin_id);
create index if not exists admin_audit_logs_target_idx  on public.admin_audit_logs (target_type, target_id);
create index if not exists admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_action_idx  on public.admin_audit_logs (action);

drop trigger if exists admin_audit_logs_no_update on public.admin_audit_logs;
create trigger admin_audit_logs_no_update
  before update on public.admin_audit_logs
  for each row execute function public.deny_mutation();

drop trigger if exists admin_audit_logs_no_delete on public.admin_audit_logs;
create trigger admin_audit_logs_no_delete
  before delete on public.admin_audit_logs
  for each row execute function public.deny_mutation();

alter table public.admin_audit_logs enable row level security;

-- Readable by admins in the UI. No insert policy: writes go through the
-- service role inside the transaction that performs the audited action.
drop policy if exists admin_audit_logs_admin_select on public.admin_audit_logs;
create policy admin_audit_logs_admin_select on public.admin_audit_logs
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- system_events
-- Structured error/event log. Service-role writes only.
-- NEVER contains lead records, file contents, tokens, signed URLs, or cookies.
-- ---------------------------------------------------------------------------

create table if not exists public.system_events (
  id          uuid primary key default gen_random_uuid(),
  level       text not null default 'info',
  event       text not null,
  error_code  text,
  message     text,
  context     jsonb,
  user_id     uuid references auth.users(id) on delete set null,
  job_id      uuid references public.extraction_jobs(id) on delete set null,
  file_id     uuid references public.uploaded_files(id) on delete set null,
  request_id  text,
  duration_ms int,
  created_at  timestamptz not null default now(),
  constraint system_events_level_check check (level in ('debug','info','warn','error','fatal'))
);

create index if not exists system_events_created_idx on public.system_events (created_at desc);
create index if not exists system_events_level_idx   on public.system_events (level);
create index if not exists system_events_code_idx    on public.system_events (error_code);
create index if not exists system_events_job_idx     on public.system_events (job_id);
create index if not exists system_events_user_idx    on public.system_events (user_id);

alter table public.system_events enable row level security;

drop policy if exists system_events_admin_select on public.system_events;
create policy system_events_admin_select on public.system_events
  for select to authenticated using (public.is_admin());

-- ####################  0008_rate_limits_and_bootstrap.sql  ####################

-- 0008 — rate limiting + admin bootstrap
--
-- Rate limiting is backed by Postgres rather than Redis/Upstash. Same reasoning
-- as the job queue (docs/ARCHITECTURE.md §1): transactional with application
-- data, no extra vendor, inspectable with plain SQL. At this scale the extra
-- round trip is irrelevant; revisit if auth traffic grows by orders of magnitude.

create table if not exists public.rate_limits (
  id            uuid primary key default gen_random_uuid(),
  bucket        text not null,          -- e.g. 'auth:signin', 'upload', 'export'
  subject       text not null,          -- e.g. 'ip:1.2.3.4|email:a@b.com'
  window_start  timestamptz not null,
  attempts      int not null default 0,
  blocked_until timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists rate_limits_set_updated_at on public.rate_limits;
create trigger rate_limits_set_updated_at
  before update on public.rate_limits
  for each row execute function public.set_updated_at();

create unique index if not exists rate_limits_unique
  on public.rate_limits (bucket, subject, window_start);
create index if not exists rate_limits_sweep_idx
  on public.rate_limits (window_start);

-- Service role only. RLS on, no policies.
alter table public.rate_limits enable row level security;

-- ---------------------------------------------------------------------------
-- Atomic consume-a-token. Returns the row AFTER incrementing, so the caller
-- sees a truthful count even under concurrency. The unique index plus
-- ON CONFLICT makes this safe without an explicit lock.
-- ---------------------------------------------------------------------------

create or replace function public.consume_rate_limit(
  p_bucket        text,
  p_subject       text,
  p_window_start  timestamptz,
  p_max_attempts  int,
  p_block_seconds int
)
returns table (attempts int, blocked_until timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts int;
  v_blocked  timestamptz;
begin
  insert into public.rate_limits (bucket, subject, window_start, attempts)
  values (p_bucket, p_subject, p_window_start, 1)
  on conflict (bucket, subject, window_start) do update
    set attempts = public.rate_limits.attempts + 1
  returning public.rate_limits.attempts, public.rate_limits.blocked_until
    into v_attempts, v_blocked;

  -- Trip the breaker on the attempt AFTER the allowance is used up, so
  -- p_max_attempts = 5 permits five tries and blocks the sixth.
  if v_attempts > p_max_attempts and v_blocked is null then
    update public.rate_limits
       set blocked_until = now() + make_interval(secs => p_block_seconds)
     where bucket = p_bucket
       and subject = p_subject
       and window_start = p_window_start
    returning public.rate_limits.blocked_until into v_blocked;
  end if;

  attempts := v_attempts;
  blocked_until := v_blocked;
  return next;
end;
$$;

-- Housekeeping: drop windows older than a day.
create or replace function public.sweep_rate_limits()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  delete from public.rate_limits
   where window_start < now() - interval '1 day'
     and (blocked_until is null or blocked_until < now());
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Atomic usage increment.
--
-- Concurrent callers serialise on the unique index (user_id, metric,
-- period_start) rather than read-modify-write racing, so two requests cannot
-- both slip under a limit. Returns the new total.
-- ---------------------------------------------------------------------------

create or replace function public.increment_usage(
  p_user_id      uuid,
  p_metric       text,
  p_period_start timestamptz,
  p_period_end   timestamptz,
  p_by           int default 1
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  insert into public.usage_counters (user_id, metric, period_start, period_end, count)
  values (p_user_id, p_metric, p_period_start, p_period_end, p_by)
  on conflict (user_id, metric, period_start) do update
    set count = public.usage_counters.count + p_by
  returning public.usage_counters.count into v_count;

  return v_count;
end;
$$;

revoke all on function public.increment_usage(uuid, text, timestamptz, timestamptz, int)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin bootstrap.
--
-- There is NO self-service path to admin and NO API route that can grant it.
-- The first admin is promoted by calling this function explicitly with the
-- service role, from a documented one-off statement:
--
--     select public.bootstrap_admin('you@example.com');
--
-- It is deliberately NOT wired to an env var read at migration time, because
-- that would silently re-promote on every migration run.
-- ---------------------------------------------------------------------------

create or replace function public.bootstrap_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where email = p_email;

  if v_user_id is null then
    raise exception 'No auth user with email %. Sign up first, then run this.', p_email;
  end if;

  update public.profiles set role = 'admin' where id = v_user_id;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id,
                                       target_user_id, after_state, reason)
  values (v_user_id, 'admin.bootstrap', 'profile', v_user_id, v_user_id,
          jsonb_build_object('role', 'admin'),
          'Initial admin bootstrap via bootstrap_admin()');

  return v_user_id;
end;
$$;

revoke all on function public.bootstrap_admin(text) from public, anon, authenticated;

-- ####################  0009_profile_contact_fields.sql  ####################

-- 0009 — required contact fields on sign-up: phone + LinkedIn profile URL
--
-- Both are collected so a human can vet an access request before approving it,
-- which is the whole basis of the manual-approval model.
--
-- ⚠️ These are the ACCOUNT HOLDER'S OWN details, self-supplied at sign-up.
-- They are NOT lead data. The `linkedin_url` here is never fetched, visited,
-- or scraped — CLAUDE.md rule 1 still holds absolutely. It is stored as an
-- identifier for manual review only.

alter table public.profiles
  add column if not exists phone        text,
  add column if not exists linkedin_url text;

-- ---------------------------------------------------------------------------
-- Format constraints, applied only when a value is present.
--
-- Deliberately NULLABLE at the database level even though sign-up requires
-- them. Rationale: users created out-of-band — by an admin through the Supabase
-- dashboard, or by the integration test suite — carry no sign-up metadata. A
-- NOT NULL here would break admin user creation for no security gain, since
-- the enforcement that matters happens in the sign-up flow.
-- ---------------------------------------------------------------------------

do $$ begin
  alter table public.profiles
    add constraint profiles_phone_e164
    check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles
    add constraint profiles_linkedin_url_format
    check (linkedin_url is null or linkedin_url ~ '^https://www\.linkedin\.com/in/[A-Za-z0-9%_-]{2,100}$');
exception when duplicate_object then null; end $$;

create index if not exists profiles_linkedin_url_idx on public.profiles (linkedin_url);

-- ---------------------------------------------------------------------------
-- Carry the values through from sign-up metadata.
--
-- supabase.auth.signUp({ options: { data } }) lands in raw_user_meta_data.
-- Values are already normalised and validated server-side before signUp is
-- called; the CHECK constraints above are the backstop.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, phone, linkedin_url)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'linkedin_url', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Let users correct their own contact details.
--
-- protect_profile_columns() freezes the privileged columns (role, plan_id,
-- access_expires_at, …). phone and linkedin_url are NOT in that list, so they
-- remain user-editable, which is correct — they are the user's own contact
-- information, not an entitlement.
-- ---------------------------------------------------------------------------

-- ####################  0010_entitlements_and_invitations.sql  ####################

-- 0010 — entitlement granting + atomic invitation redemption
--
-- Both live in Postgres functions rather than application code because each
-- must be ATOMIC. A grant touches profiles + subscriptions + admin_audit_logs;
-- a redemption additionally increments used_count. Splitting those across
-- round trips would allow a code to be over-redeemed under concurrency, and
-- would allow a grant to half-apply.

-- ---------------------------------------------------------------------------
-- grant_entitlement
--
-- THE single path to access. Every payment provider, the invitation flow, and
-- the admin panel all call this. Provider-agnostic by design (spec §9.1).
--
-- Writes the audit row in the SAME transaction as the change (spec §12.8) — if
-- the audit insert fails, the grant rolls back.
-- ---------------------------------------------------------------------------

create or replace function public.grant_entitlement(
  p_user_id       uuid,
  p_plan_id       uuid,
  p_duration_days int default null,
  p_granted_by    uuid default null,
  p_provider      text default 'manual',
  p_provider_ref  text default null,
  p_reason        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expires_at    timestamptz;
  v_subscription  uuid;
  v_before        jsonb;
begin
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'No such user: %', p_user_id;
  end if;

  if not exists (select 1 from public.plans where id = p_plan_id) then
    raise exception 'No such plan: %', p_plan_id;
  end if;

  if p_duration_days is not null then
    v_expires_at := now() + make_interval(days => p_duration_days);
  end if;

  select to_jsonb(p) into v_before
    from (select role, plan_id, access_expires_at
            from public.profiles where id = p_user_id) p;

  -- Role becomes 'subscriber'. auth.uid() is null under the service role, so
  -- protect_profile_columns() permits this.
  update public.profiles
     set role              = 'subscriber',
         plan_id           = p_plan_id,
         access_expires_at = v_expires_at,
         suspended_at      = null,
         suspended_reason  = null
   where id = p_user_id;

  insert into public.subscriptions (
    user_id, plan_id, status, provider, provider_ref,
    current_period_start, current_period_end, granted_by
  ) values (
    p_user_id, p_plan_id, 'active', p_provider, p_provider_ref,
    now(), v_expires_at, p_granted_by
  )
  returning id into v_subscription;

  -- Any pending request for this user is now resolved.
  update public.access_requests
     set status      = 'approved',
         reviewed_by = p_granted_by,
         reviewed_at = now()
   where user_id = p_user_id and status = 'pending';

  insert into public.admin_audit_logs (
    admin_id, action, target_type, target_id, target_user_id,
    before_state, after_state, reason
  ) values (
    p_granted_by, 'entitlement.grant', 'profile', p_user_id, p_user_id,
    v_before,
    jsonb_build_object('role','subscriber','plan_id',p_plan_id,
                       'access_expires_at',v_expires_at,'provider',p_provider),
    coalesce(p_reason, 'Entitlement granted via ' || p_provider)
  );

  return v_subscription;
end;
$$;

revoke all on function public.grant_entitlement(uuid, uuid, int, uuid, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- revoke_entitlement — the inverse, also audited.
-- ---------------------------------------------------------------------------

create or replace function public.revoke_entitlement(
  p_user_id    uuid,
  p_revoked_by uuid default null,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
begin
  select to_jsonb(p) into v_before
    from (select role, plan_id, access_expires_at
            from public.profiles where id = p_user_id) p;

  update public.profiles
     set role = 'registered_user', access_expires_at = now()
   where id = p_user_id;

  update public.subscriptions
     set status = 'cancelled', cancelled_at = now()
   where user_id = p_user_id and status = 'active';

  insert into public.admin_audit_logs (
    admin_id, action, target_type, target_id, target_user_id,
    before_state, after_state, reason
  ) values (
    p_revoked_by, 'entitlement.revoke', 'profile', p_user_id, p_user_id,
    v_before, jsonb_build_object('role','registered_user'),
    coalesce(p_reason, 'Entitlement revoked')
  );
end;
$$;

revoke all on function public.revoke_entitlement(uuid, uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- redeem_invitation_code
--
-- ATOMICITY IS THE WHOLE POINT.
--
-- The UPDATE ... WHERE used_count < max_uses is a single statement, so Postgres
-- serialises concurrent redemptions on the row. Exactly one caller can observe
-- the row transition from used_count = N to N+1. A read-then-write in
-- application code would let two requests both pass the check.
--
-- Returns a status string rather than raising, so the caller can map it to a
-- specific user-facing message without parsing exception text.
-- ---------------------------------------------------------------------------

create or replace function public.redeem_invitation_code(
  p_code    text,
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid;
  v_plan_id  uuid;
  v_exists   boolean;
begin
  -- Already entitled? Redeeming again would stack subscriptions.
  if exists (
    select 1 from public.profiles
     where id = p_user_id
       and role in ('subscriber','approved_user','admin')
       and (access_expires_at is null or access_expires_at > now())
  ) then
    return 'already_active';
  end if;

  -- Atomic claim. The WHERE clause is the guard; no separate SELECT.
  update public.invitation_codes
     set used_count = used_count + 1
   where code = p_code
     and is_active = true
     and used_count < max_uses
     and (expires_at is null or expires_at > now())
  returning id, plan_id into v_id, v_plan_id;

  if v_id is null then
    -- Distinguish "no such code" from "exhausted/expired" WITHOUT leaking
    -- which, to avoid turning this into a code-enumeration oracle. The caller
    -- shows one generic message; the distinction is for logs only.
    select exists (select 1 from public.invitation_codes where code = p_code)
      into v_exists;
    return case when v_exists then 'unavailable' else 'invalid' end;
  end if;

  if v_plan_id is null then
    select id into v_plan_id from public.plans where key = 'trial';
  end if;

  -- provider_ref must identify THIS REDEMPTION, not the code.
  --
  -- `subscriptions_provider_ref_uniq` is (provider, provider_ref) — correct for
  -- Stripe, where one subscription id maps to exactly one subscription. Passing
  -- the bare code id here made every redeemer of a multi-use code collide,
  -- silently turning a max_uses=3 code into a max_uses=1 code with errors.
  -- Composing code id with user id keeps the Stripe guarantee intact while
  -- allowing a code to be redeemed by as many distinct users as max_uses allows.
  perform public.grant_entitlement(
    p_user_id      => p_user_id,
    p_plan_id      => v_plan_id,
    p_duration_days=> null,
    p_granted_by   => null,
    p_provider     => 'invitation',
    p_provider_ref => v_id::text || ':' || p_user_id::text,
    p_reason       => 'Invitation code redeemed'
  );

  return 'ok';
end;
$$;

revoke all on function public.redeem_invitation_code(text, uuid)
  from public, anon, authenticated;

-- ####################  0011_audit_logs_survive_user_deletion.sql  ####################

-- 0011 — audit logs must survive user deletion
--
-- BUG THIS FIXES
--
-- `admin_audit_logs.admin_id` and `.target_user_id` were declared
-- `references auth.users(id) on delete set null`. Postgres implements SET NULL
-- as an UPDATE — which the append-only trigger from 0007 correctly refuses:
--
--     ERROR: Table public.admin_audit_logs is append-only; UPDATE is not permitted
--
-- The result: deleting any user who appears in an audit row FAILED. That breaks
-- account deletion (spec §13.3) and the right to erasure under GDPR.
--
-- THE FIX
--
-- Drop the foreign keys and keep plain uuid columns. This is the correct design
-- for an append-only audit log: the whole point is that it outlives the rows it
-- describes. Referential integrity to a table whose rows are deliberately
-- deleted defeats the purpose — "who did this?" must remain answerable after
-- the actor's account is gone.
--
-- The uuid is retained verbatim, so history stays attributable even though the
-- user record no longer exists.

alter table public.admin_audit_logs
  drop constraint if exists admin_audit_logs_admin_id_fkey;

alter table public.admin_audit_logs
  drop constraint if exists admin_audit_logs_target_user_id_fkey;

comment on column public.admin_audit_logs.admin_id is
  'uuid of the acting admin. NO foreign key by design — audit rows outlive the users they describe.';

comment on column public.admin_audit_logs.target_user_id is
  'uuid of the affected user. NO foreign key by design — see admin_id.';

-- ---------------------------------------------------------------------------
-- system_events has the same problem for the same reason.
--
-- Its user_id/job_id/file_id FKs are ON DELETE SET NULL, and while there is no
-- append-only trigger on this table today, an event log should likewise not
-- lose attribution when the subject is deleted. Keep job_id and file_id FKs
-- (those cascade cleanly and are useful for joins) but detach user_id.
-- ---------------------------------------------------------------------------

alter table public.system_events
  drop constraint if exists system_events_user_id_fkey;

comment on column public.system_events.user_id is
  'uuid of the user the event concerns. NO foreign key — events outlive accounts.';

-- ####################  0012_storage_policies.sql  ####################

-- 0012 — storage policies for the private `uploads` bucket
--
-- The bucket is created via the Storage API (private, 10 MB cap, text/html).
-- This migration governs who may touch objects inside it.
--
-- ARCHITECTURE REMINDER
--
-- Clients NEVER read or write storage directly. Uploads go through a server
-- route that validates content and generates the key; downloads use short-lived
-- signed URLs. So the service role does all the real work, and these policies
-- exist as defence in depth: if a publishable-key client ever reached storage,
-- it must still be confined to its own prefix.
--
-- Keys are `{user_id}/{job_id}/{uuid}.html`, so the FIRST path segment is the
-- owning user's id. `storage.foldername(name)` splits on '/', and PostgreSQL
-- arrays are 1-indexed, hence `[1]`.

-- NOTE: there is deliberately no `alter table storage.objects enable row level
-- security` here.
--
-- `storage.objects` is owned by `supabase_admin`, and the `postgres` role the
-- SQL Editor runs as is not its owner, so ALTER TABLE fails with:
--
--     ERROR: 42501: must be owner of table objects
--
-- Supabase enables RLS on that table by default, so the statement was only ever
-- an assertion. Creating and dropping POLICIES is permitted, which is all this
-- migration actually needs.

-- ---------------------------------------------------------------------------
-- Read: own prefix only.
-- ---------------------------------------------------------------------------

drop policy if exists "uploads_select_own_prefix" on storage.objects;
create policy "uploads_select_own_prefix" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Write: own prefix only.
--
-- Note this does NOT make direct client uploads safe or supported — the server
-- route still performs content sniffing, size accounting and key generation.
-- A client that wrote here directly would bypass all of that, which is why the
-- publishable key is never used for storage writes in application code.
-- ---------------------------------------------------------------------------

drop policy if exists "uploads_insert_own_prefix" on storage.objects;
create policy "uploads_insert_own_prefix" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "uploads_update_own_prefix" on storage.objects;
create policy "uploads_update_own_prefix" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Delete: own prefix only. Users may remove their own uploads; job deletion
-- also removes objects, but that runs with the service role.
-- ---------------------------------------------------------------------------

drop policy if exists "uploads_delete_own_prefix" on storage.objects;
create policy "uploads_delete_own_prefix" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- No policy grants `anon` anything. An unauthenticated fetch of an object path
-- must fail; the only legitimate anonymous access is a signed URL, which the
-- Storage API validates outside RLS.

-- ####################  0013_queue_and_retention.sql  ####################

-- 0013 — queue claiming, stale-claim reaper, and lead retention
--
-- Claiming lives in SQL because `FOR UPDATE SKIP LOCKED` is the primitive that
-- makes competing consumers safe. Doing it in application code would reintroduce
-- the read-then-write race the queue exists to prevent.

-- ---------------------------------------------------------------------------
-- lead_keys — dedupe identity WITHOUT personal data
--
-- Lead rows are purged once the user has their CSV (see purge_job_leads).
-- Keeping just the opaque dedupe key preserves CROSS-JOB duplicate detection at
-- roughly 8% of the storage — and it is a privacy improvement, not a
-- compromise: the name, company, URL and blurb genuinely disappear while
-- "have I seen this person before?" stays answerable.
-- ---------------------------------------------------------------------------

create table if not exists public.lead_keys (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  dedupe_key text not null,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  seen_count int not null default 1
);

create unique index if not exists lead_keys_unique on public.lead_keys (user_id, dedupe_key);
create index if not exists lead_keys_user_idx on public.lead_keys (user_id);

alter table public.lead_keys enable row level security;

drop policy if exists lead_keys_select_own on public.lead_keys;
create policy lead_keys_select_own on public.lead_keys
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

-- Writes are service-role only.

-- ---------------------------------------------------------------------------
-- claim_next_job
--
-- SKIP LOCKED means a second worker steps over a row another worker is already
-- claiming rather than blocking on it. Exactly one claimant per job.
-- ---------------------------------------------------------------------------

create or replace function public.claim_next_job(p_claimed_by text)
returns table (job_id uuid, user_id uuid, attempts int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue_id uuid;
  v_job_id   uuid;
begin
  select q.id, q.job_id
    into v_queue_id, v_job_id
    from public.job_queue q
   where q.status = 'pending'
     and q.next_attempt_at <= now()
     and q.attempts < q.max_attempts
   order by q.next_attempt_at
   for update skip locked
   limit 1;

  if v_queue_id is null then
    return;
  end if;

  -- `attempts` must be qualified: RETURNS TABLE declares an OUT parameter of
  -- the same name, so a bare reference is ambiguous and raises at runtime.
  update public.job_queue
     set status     = 'claimed',
         claimed_at = now(),
         claimed_by = p_claimed_by,
         attempts   = public.job_queue.attempts + 1
   where id = v_queue_id;

  update public.extraction_jobs
     set status        = 'processing',
         started_at    = coalesce(started_at, now()),
         progress_step = 'Processing files'
   where id = v_job_id;

  return query
    select j.id, j.user_id, q.attempts
      from public.extraction_jobs j
      join public.job_queue q on q.job_id = j.id
     where j.id = v_job_id;
end;
$$;

revoke all on function public.claim_next_job(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- reap_stale_jobs
--
-- Critical without an always-on worker: an `after()` invocation cut short by a
-- function timeout leaves a job 'claimed' forever. This returns it to 'pending'
-- with exponential backoff, or dead-letters it past max_attempts.
-- ---------------------------------------------------------------------------

create or replace function public.reap_stale_jobs(p_timeout_seconds int default 900)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with stale as (
    select id, job_id, attempts, max_attempts
      from public.job_queue
     where status = 'claimed'
       and claimed_at < now() - make_interval(secs => p_timeout_seconds)
     for update skip locked
  ),
  requeued as (
    -- Explicit ::queue_status casts — a bare string literal in a CASE is typed
    -- text, which Postgres will not coerce into the enum column.
    update public.job_queue q
       set status = case when s.attempts >= s.max_attempts
                         then 'failed'::public.queue_status
                         else 'pending'::public.queue_status end,
           claimed_at = null,
           claimed_by = null,
           -- exponential backoff: 2^attempts minutes, capped at 2^6 = 64
           next_attempt_at = now() + make_interval(mins => power(2, least(s.attempts, 6))::int),
           last_error = 'Reclaimed after stale claim timeout'
      from stale s
     where q.id = s.id
    returning q.job_id, q.status
  )
  update public.extraction_jobs j
     set status = case when r.status = 'failed' then 'failed'::public.job_status
                       else 'queued'::public.job_status end,
         error_code = case when r.status = 'failed' then 'ERR_TIMEOUT' else null end,
         error_message = case when r.status = 'failed'
                              then 'Processing timed out repeatedly' else null end
    from requeued r
   where j.id = r.job_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.reap_stale_jobs(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- purge_job_leads
--
-- Deletes the personal data once the user has downloaded their CSV, while
-- recording each dedupe key in lead_keys so cross-job detection survives.
-- ---------------------------------------------------------------------------

create or replace function public.purge_job_leads(p_job_id uuid, p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  -- Preserve identity keys before the rows go.
  insert into public.lead_keys (user_id, dedupe_key)
  select p_user_id, l.dedupe_key
    from public.extracted_leads l
   where l.extraction_job_id = p_job_id
     and l.user_id = p_user_id
  on conflict (user_id, dedupe_key) do update
    set last_seen = now(),
        seen_count = public.lead_keys.seen_count + 1;

  delete from public.extracted_leads
   where extraction_job_id = p_job_id
     and user_id = p_user_id;

  get diagnostics v_deleted = row_count;

  update public.extraction_jobs
     set progress_step = 'Completed — data purged'
   where id = p_job_id and user_id = p_user_id;

  return v_deleted;
end;
$$;

revoke all on function public.purge_job_leads(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- enqueue_job — creates the queue row for an uploaded job.
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.job_queue (job_id, status, next_attempt_at)
  values (p_job_id, 'pending', now())
  on conflict (job_id) do nothing;

  update public.extraction_jobs
     set status = 'queued', progress_step = 'Waiting in queue'
   where id = p_job_id and status = 'uploaded';
end;
$$;

revoke all on function public.enqueue_job(uuid) from public, anon, authenticated;

-- ####################  0014_reap_orphaned_uploads.sql  ####################

-- 0014 — recover jobs that were created but never enqueued
--
-- THE GAP THIS CLOSES
--
-- Uploads happen in two steps: create the job and issue signed upload URLs,
-- then finalise and enqueue. If the browser closes, crashes, or loses its
-- connection between those two calls, the job sits in `uploaded` forever with
-- `pending` files and NO row in job_queue.
--
-- `reap_stale_jobs()` cannot see these — it only looks for `claimed` rows that
-- went stale. A job that was never claimed, and never even queued, is invisible
-- to it. Observed in production: two such jobs after failed upload attempts.
--
-- This sweep finds them and either enqueues them (files did arrive) or fails
-- them honestly (no files arrived).

create or replace function public.reap_orphaned_uploads(p_older_than_minutes int default 10)
returns table (enqueued int, failed int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enqueued int := 0;
  v_failed   int := 0;
begin
  -- Jobs stuck in 'uploaded' with no queue row, old enough that an in-flight
  -- upload is no longer a plausible explanation.
  with orphaned as (
    select j.id,
           (select count(*) from public.uploaded_files f
             where f.extraction_job_id = j.id and f.deleted_at is null) as file_count
      from public.extraction_jobs j
     where j.status = 'uploaded'
       and j.created_at < now() - make_interval(mins => p_older_than_minutes)
       and not exists (select 1 from public.job_queue q where q.job_id = j.id)
  ),
  -- Files present: the upload did land, only the enqueue was lost.
  requeued as (
    insert into public.job_queue (job_id, status, next_attempt_at)
    select o.id, 'pending', now() from orphaned o where o.file_count > 0
    on conflict (job_id) do nothing
    returning job_id
  ),
  marked_queued as (
    update public.extraction_jobs j
       set status = 'queued', progress_step = 'Waiting in queue'
      from requeued r
     where j.id = r.job_id
    returning j.id
  ),
  -- No files at all: nothing to process. Fail it rather than leave it hanging.
  marked_failed as (
    update public.extraction_jobs j
       set status = 'failed',
           error_code = 'ERR_STORAGE',
           error_message = 'Upload did not complete.'
      from orphaned o
     where j.id = o.id and o.file_count = 0
    returning j.id
  )
  select (select count(*) from marked_queued), (select count(*) from marked_failed)
    into v_enqueued, v_failed;

  enqueued := v_enqueued;
  failed := v_failed;
  return next;
end;
$$;

revoke all on function public.reap_orphaned_uploads(int) from public, anon, authenticated;

-- ####################  0015_credit_plans.sql  ####################

-- 0015 — real pricing plans on a CREDIT model
--
-- Replaces the Phase 3 PLACEHOLDER seed. Until now the marketing page and the
-- database disagreed: the page advertised $40 unlimited while plans.limits held
-- invented numbers nobody could actually be put on.
--
-- CREDIT MODEL
--   1 credit = one extraction run  (a job that processes files)
--   1 credit = one CSV export      (a download)
-- So a typical "upload → process → download" cycle costs 2 credits.
--
-- Limits still live entirely in plans.limits and are read at runtime. Nothing
-- here is hardcoded in application code.

-- Trial and the three real tiers.
insert into public.plans (key, name, description, sort_order, is_active, limits) values
  ('trial', 'Free trial', '3 days, capped', 1, true, jsonb_build_object(
      'credits_per_month',       10,
      'files_per_extraction',    5,
      'extractions_per_day',     null,
      'extractions_per_month',   null,
      'records_per_extraction',  null,
      'records_per_month',       null,
      'storage_bytes',           104857600,
      'exports_per_month',       null,
      'retention_days',          3
  )),
  ('starter', 'Lead Engine', '$38/month · 100 credits', 2, true, jsonb_build_object(
      'credits_per_month',       100,
      'files_per_extraction',    10,
      'extractions_per_day',     null,
      'extractions_per_month',   null,
      'records_per_extraction',  null,
      'records_per_month',       null,
      'storage_bytes',           1073741824,
      'exports_per_month',       null,
      'retention_days',          30
  )),
  ('professional', 'Pro', '$73/month · 300 credits', 3, true, jsonb_build_object(
      'credits_per_month',       300,
      'files_per_extraction',    30,
      'extractions_per_day',     null,
      'extractions_per_month',   null,
      'records_per_extraction',  null,
      'records_per_month',       null,
      'storage_bytes',           10737418240,
      'exports_per_month',       null,
      'retention_days',          90
  )),
  ('custom', 'Custom', '1000+ credits · contact us', 4, true, jsonb_build_object(
      'credits_per_month',       1000,
      'files_per_extraction',    50,
      'extractions_per_day',     null,
      'extractions_per_month',   null,
      'records_per_extraction',  null,
      'records_per_month',       null,
      'storage_bytes',           53687091200,
      'exports_per_month',       null,
      'retention_days',          365
  ))
on conflict (key) do update
  set name        = excluded.name,
      description = excluded.description,
      sort_order  = excluded.sort_order,
      is_active   = excluded.is_active,
      limits      = excluded.limits;

-- The old 'agency' tier is no longer offered. Deactivate rather than delete:
-- subscriptions may still reference it, and plans.id is a restrict FK.
update public.plans set is_active = false where key = 'agency';

-- ---------------------------------------------------------------------------
-- credits metric
-- ---------------------------------------------------------------------------

alter table public.usage_counters drop constraint if exists usage_counters_metric_check;
alter table public.usage_counters
  add constraint usage_counters_metric_check
  check (metric in ('extractions', 'files', 'records', 'exports', 'storage_bytes', 'credits'));

-- ---------------------------------------------------------------------------
-- consume_credit
--
-- ATOMIC check-and-spend. The balance is read and written in ONE statement, so
-- two concurrent actions cannot both spend the last credit — the same reason
-- invitation redemption lives in SQL.
--
-- Returns the remaining balance, or -1 when there were not enough credits.
-- Admins are exempt and always return a large sentinel.
-- ---------------------------------------------------------------------------

create or replace function public.consume_credit(
  p_user_id      uuid,
  p_amount       int default 1,
  p_period_start timestamptz default date_trunc('month', now()),
  p_period_end   timestamptz default date_trunc('month', now()) + interval '1 month'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowance int;
  v_used      bigint;
  v_role      public.user_role;
begin
  select role into v_role from public.profiles where id = p_user_id;
  if v_role = 'admin' then
    return 999999;
  end if;

  select (p.limits ->> 'credits_per_month')::int
    into v_allowance
    from public.profiles pr
    join public.plans p on p.id = pr.plan_id
   where pr.id = p_user_id;

  -- No plan, or an unlimited plan.
  if v_allowance is null then
    return -1;
  end if;

  insert into public.usage_counters (user_id, metric, period_start, period_end, count)
  values (p_user_id, 'credits', p_period_start, p_period_end, p_amount)
  on conflict (user_id, metric, period_start) do update
    set count = public.usage_counters.count + p_amount
  returning count into v_used;

  if v_used > v_allowance then
    -- Roll back the spend: the caller gets nothing and the balance is untouched.
    update public.usage_counters
       set count = count - p_amount
     where user_id = p_user_id
       and metric = 'credits'
       and period_start = p_period_start;
    return -1;
  end if;

  return v_allowance - v_used::int;
end;
$$;

revoke all on function public.consume_credit(uuid, int, timestamptz, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- credit_balance — read-only, for the dashboard.
-- ---------------------------------------------------------------------------

create or replace function public.credit_balance(p_user_id uuid)
returns table (allowance int, used int, remaining int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowance int;
  v_used      int;
begin
  select (p.limits ->> 'credits_per_month')::int
    into v_allowance
    from public.profiles pr
    join public.plans p on p.id = pr.plan_id
   where pr.id = p_user_id;

  select coalesce(count, 0)::int into v_used
    from public.usage_counters
   where user_id = p_user_id
     and metric = 'credits'
     and period_start = date_trunc('month', now());

  allowance := coalesce(v_allowance, 0);
  used      := coalesce(v_used, 0);
  remaining := greatest(allowance - used, 0);
  return next;
end;
$$;

revoke all on function public.credit_balance(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- purge_expired_exports
--
-- Answers "do the CSVs pile up forever?" — no. Exports older than the plan's
-- retention_days are marked for removal. Storage objects are deleted by the
-- caller, which has the storage client; SQL only decides WHAT expires.
-- ---------------------------------------------------------------------------

create or replace function public.expired_export_paths(p_limit int default 200)
returns table (job_id uuid, user_id uuid, export_storage_path text)
language sql
stable
security definer
set search_path = public
as $$
  select j.id, j.user_id, j.export_storage_path
    from public.extraction_jobs j
    join public.profiles pr on pr.id = j.user_id
    left join public.plans p on p.id = pr.plan_id
   where j.export_storage_path is not null
     and j.completed_at is not null
     and j.completed_at < now() - make_interval(
           days => coalesce((p.limits ->> 'retention_days')::int, 30))
   limit p_limit;
$$;

revoke all on function public.expired_export_paths(int) from public, anon, authenticated;

-- ####################  0016_export_destinations.sql  ####################

-- 0016 — export destinations (device / Google Drive / OneDrive)
--
-- SCHEMA ONLY. The OAuth flows are NOT implemented yet — see the note below.
-- Shipping the table now means the UI can offer "Save to device" today and
-- light up cloud destinations without a migration later.
--
-- ⚠️ TOKEN SECURITY
--
-- `refresh_token` is a long-lived credential to a user's personal Drive. It is
-- as sensitive as a password:
--   · RLS denies all client access (no policies below, deliberately)
--   · only the service role may read it
--   · it must NEVER be logged, returned to the browser, or put in a URL
--
-- Storing third-party OAuth tokens is a meaningful new liability. It requires
-- an OAuth app registration (Google Cloud Console / Azure AD), a published
-- privacy policy naming the scopes, and Google's verification review if the
-- Drive scope is non-restricted. That is a business decision, not just code.

do $$ begin
  create type public.export_destination_kind as enum ('device', 'google_drive', 'onedrive');
exception when duplicate_object then null; end $$;

create table if not exists public.export_destinations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          public.export_destination_kind not null,

  -- Human label, e.g. the connected account's email. Safe to show.
  account_label text,
  -- Target folder id in the provider. Not secret.
  folder_id     text,
  folder_name   text,

  -- ⚠️ SECRETS. Service role only. Never leaves the server.
  access_token  text,
  refresh_token text,
  token_expires_at timestamptz,
  scopes        text,

  is_default    boolean not null default false,
  connected_at  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists export_destinations_set_updated_at on public.export_destinations;
create trigger export_destinations_set_updated_at
  before update on public.export_destinations
  for each row execute function public.set_updated_at();

create index if not exists export_destinations_user_idx
  on public.export_destinations (user_id);

-- One connection per provider per user.
create unique index if not exists export_destinations_user_kind_uniq
  on public.export_destinations (user_id, kind)
  where kind <> 'device';

-- Only one default at a time.
create unique index if not exists export_destinations_one_default
  on public.export_destinations (user_id)
  where is_default;

-- RLS ON, NO POLICIES. This table holds OAuth refresh tokens; there is no
-- read path for a client, even the owning user. The app surfaces only
-- `kind`, `account_label` and `folder_name` through a server query that
-- selects those columns explicitly.
alter table public.export_destinations enable row level security;

-- ---------------------------------------------------------------------------
-- Which destination a job should deliver to.
-- ---------------------------------------------------------------------------

alter table public.extraction_jobs
  add column if not exists destination_kind public.export_destination_kind not null default 'device',
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_error text;

comment on column public.export_destinations.refresh_token is
  'OAuth refresh token — SECRET. Service role only. Never log, never return to a client.';

-- ####################  0017_atomic_job_finalization.sql  ####################

-- 0017 — atomic upload finalization and audited account suspension
--
-- Finalizing an upload previously used three separate RPCs. Concurrent retries
-- could spend more than one credit, and a later queue failure could leave a
-- charged job that was never runnable. Keep the state transition, billing,
-- usage counters, and queue insertion in one database transaction.

create or replace function public.finalize_upload_job(
  p_job_id  uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status          public.job_status;
  v_file_count      int;
  v_credits_left    int;
  v_month_start     timestamptz := date_trunc('month', now());
  v_month_end       timestamptz := date_trunc('month', now()) + interval '1 month';
  v_day_start       timestamptz := date_trunc('day', now());
  v_day_end         timestamptz := date_trunc('day', now()) + interval '1 day';
begin
  select status
    into v_status
    from public.extraction_jobs
   where id = p_job_id
     and user_id = p_user_id
   for update;

  if not found then
    return 'not_found';
  end if;

  -- A client may retry after losing the first response. Never charge twice.
  if v_status in ('queued', 'processing', 'completed', 'partially_completed') then
    return 'already_finalized';
  end if;

  if v_status <> 'uploaded' then
    return 'invalid_state';
  end if;

  select count(*)::int
    into v_file_count
    from public.uploaded_files
   where extraction_job_id = p_job_id
     and user_id = p_user_id
     and deleted_at is null;

  if v_file_count = 0 then
    update public.extraction_jobs
       set status = 'failed',
           error_code = 'ERR_STORAGE',
           error_message = 'No files were uploaded successfully.'
     where id = p_job_id;
    return 'no_files';
  end if;

  v_credits_left := public.consume_credit(
    p_user_id,
    1,
    v_month_start,
    v_month_end
  );

  if v_credits_left < 0 then
    update public.extraction_jobs
       set status = 'failed',
           error_code = 'ERR_LIMIT_REACHED',
           error_message = 'Not enough credits.'
     where id = p_job_id;
    return 'insufficient_credits';
  end if;

  perform public.increment_usage(
    p_user_id, 'files', v_month_start, v_month_end, v_file_count
  );
  perform public.increment_usage(
    p_user_id, 'extractions', v_month_start, v_month_end, 1
  );
  perform public.increment_usage(
    p_user_id, 'extractions', v_day_start, v_day_end, 1
  );

  insert into public.job_queue (job_id, status, next_attempt_at)
  values (p_job_id, 'pending', now())
  on conflict (job_id) do nothing;

  update public.extraction_jobs
     set status = 'queued',
         file_count = v_file_count,
         progress_step = 'Waiting in queue',
         progress_current = 0,
         progress_total = v_file_count
   where id = p_job_id;

  return 'ok';
end;
$$;

revoke all on function public.finalize_upload_job(uuid, uuid)
  from public, anon, authenticated;

-- Suspending an account and writing its audit record must also be atomic.
create or replace function public.set_user_suspension(
  p_user_id  uuid,
  p_admin_id uuid,
  p_suspend  boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
begin
  if p_user_id = p_admin_id then
    raise exception 'An admin cannot suspend their own account';
  end if;

  select to_jsonb(p)
    into v_before
    from (
      select role, suspended_at, suspended_reason
        from public.profiles
       where id = p_user_id
       for update
    ) p;

  if v_before is null then
    raise exception 'No such user: %', p_user_id;
  end if;

  update public.profiles
     set suspended_at = case when p_suspend then now() else null end,
         suspended_reason = case when p_suspend then 'Suspended by admin' else null end,
         role = case
           -- `suspended_at` is the access boundary. Preserve the user's real
           -- role so unsuspending a subscriber does not silently remove their
           -- paid entitlement. Only normalize rows created by the legacy flow.
           when not p_suspend and role = 'suspended_user'
             then 'registered_user'::public.user_role
           else role
         end
   where id = p_user_id;

  insert into public.admin_audit_logs (
    admin_id, action, target_type, target_id, target_user_id,
    before_state, after_state, reason
  ) values (
    p_admin_id,
    case when p_suspend then 'user.suspend' else 'user.unsuspend' end,
    'profile',
    p_user_id,
    p_user_id,
    v_before,
    jsonb_build_object('suspended', p_suspend),
    case when p_suspend then 'Suspended by admin' else 'Unsuspended by admin' end
  );
end;
$$;

revoke all on function public.set_user_suspension(uuid, uuid, boolean)
  from public, anon, authenticated;

-- ####################  0018_signup_ip_gate.sql  ####################

-- 0018 - one account per network signup gate
--
-- The browser-facing Supabase URL and publishable key are intentionally public.
-- That means a UI-only IP check is not enough: a caller could invoke
-- auth.signUp directly. This migration makes the database trigger require a
-- short-lived, one-time reservation created by the server before any auth user
-- can be inserted.
--
-- Privacy: raw IP addresses are never stored. The application sends a keyed
-- HMAC-SHA256 digest. Reservation tokens are also stored only as SHA-256
-- digests. A completed claim is retained after account deletion so deleting an
-- account cannot reset trial eligibility.

-- The signup form already normalizes both fields. Existing production data can
-- contain duplicates, so a new UNIQUE index would be destructive or fail to
-- apply. This forward-only trigger preserves existing rows while rejecting any
-- new duplicate identity. Transaction-scoped advisory locks close the race
-- where two concurrent inserts check before either row is visible.
create or replace function public.prevent_duplicate_signup_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.phone is not null
     and (tg_op = 'INSERT' or new.phone is distinct from old.phone) then
    perform pg_advisory_xact_lock(hashtextextended('signup-phone:' || new.phone, 0));
    if exists (
      select 1 from public.profiles
       where phone = new.phone and id <> new.id
    ) then
      raise exception 'Signup identity is already in use' using errcode = '23505';
    end if;
  end if;

  if new.linkedin_url is not null
     and (tg_op = 'INSERT' or new.linkedin_url is distinct from old.linkedin_url) then
    perform pg_advisory_xact_lock(
      hashtextextended('signup-linkedin:' || new.linkedin_url, 0)
    );
    if exists (
      select 1 from public.profiles
       where linkedin_url = new.linkedin_url and id <> new.id
    ) then
      raise exception 'Signup identity is already in use' using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_prevent_duplicate_signup_identity on public.profiles;
create trigger profiles_prevent_duplicate_signup_identity
  before insert or update of phone, linkedin_url on public.profiles
  for each row execute function public.prevent_duplicate_signup_identity();

create table if not exists public.signup_ip_claims (
  ip_hash         text primary key,
  token_hash      text unique,
  user_id         uuid unique,
  reserved_until  timestamptz not null,
  claimed_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint signup_ip_claims_ip_hash_format
    check (ip_hash ~ '^[0-9a-f]{64}$'),
  constraint signup_ip_claims_token_hash_format
    check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  constraint signup_ip_claims_claim_shape
    check (
      (claimed_at is null and user_id is null and token_hash is not null)
      or
      (claimed_at is not null and user_id is not null and token_hash is null)
    )
);

drop trigger if exists signup_ip_claims_set_updated_at on public.signup_ip_claims;
create trigger signup_ip_claims_set_updated_at
  before update on public.signup_ip_claims
  for each row execute function public.set_updated_at();

create index if not exists signup_ip_claims_pending_idx
  on public.signup_ip_claims (reserved_until)
  where claimed_at is null;

-- Service role only. There are deliberately no RLS policies.
alter table public.signup_ip_claims enable row level security;
revoke all on table public.signup_ip_claims from public, anon, authenticated;
grant select, insert, update, delete on table public.signup_ip_claims to service_role;

-- Atomically reserve an IP digest. A completed claim can never be replaced.
-- An abandoned pending reservation may be replaced after ten minutes.
create or replace function public.reserve_signup_ip(
  p_ip_hash             text,
  p_token_hash          text,
  p_reservation_seconds int default 600
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reserved boolean;
begin
  if p_ip_hash !~ '^[0-9a-f]{64}$'
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_reservation_seconds < 60
     or p_reservation_seconds > 1800 then
    raise exception 'Invalid signup reservation';
  end if;

  insert into public.signup_ip_claims (
    ip_hash, token_hash, reserved_until
  ) values (
    p_ip_hash,
    p_token_hash,
    now() + make_interval(secs => p_reservation_seconds)
  )
  on conflict (ip_hash) do update
    set token_hash = excluded.token_hash,
        user_id = null,
        claimed_at = null,
        reserved_until = excluded.reserved_until
    where public.signup_ip_claims.claimed_at is null
      and public.signup_ip_claims.reserved_until <= now()
  returning true into v_reserved;

  return coalesce(v_reserved, false);
end;
$$;

revoke all on function public.reserve_signup_ip(text, text, int)
  from public, anon, authenticated;
grant execute on function public.reserve_signup_ip(text, text, int)
  to service_role;

-- Release only the caller's still-pending reservation. Once the auth trigger
-- consumes a token it is nulled, so this can never erase a completed claim.
create or replace function public.release_signup_ip(
  p_ip_hash    text,
  p_token_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted boolean;
begin
  delete from public.signup_ip_claims
   where ip_hash = p_ip_hash
     and token_hash = p_token_hash
     and claimed_at is null
  returning true into v_deleted;

  return coalesce(v_deleted, false);
end;
$$;

revoke all on function public.release_signup_ip(text, text)
  from public, anon, authenticated;
grant execute on function public.release_signup_ip(text, text)
  to service_role;

-- Require and consume the reservation in the same transaction that inserts
-- auth.users. Direct calls to Supabase Auth without a server-issued token fail
-- here and the auth user insert is rolled back.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token      text;
  v_token_hash text;
  v_ip_hash    text;
begin
  v_token := nullif(new.raw_user_meta_data ->> 'signup_reservation_token', '');

  if v_token is null or length(v_token) > 256 then
    raise exception 'Signup is not authorized' using errcode = '28000';
  end if;

  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  update public.signup_ip_claims
     set token_hash = null,
         user_id = new.id,
         claimed_at = now(),
         reserved_until = now()
   where token_hash = v_token_hash
     and claimed_at is null
     and reserved_until > now()
  returning ip_hash into v_ip_hash;

  if v_ip_hash is null then
    raise exception 'Signup is not authorized' using errcode = '28000';
  end if;

  insert into public.profiles (id, email, full_name, phone, linkedin_url)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'linkedin_url', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Clear abandoned reservations without touching completed claims.
create or replace function public.sweep_signup_ip_reservations()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.signup_ip_claims
   where claimed_at is null
     and reserved_until <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.sweep_signup_ip_reservations()
  from public, anon, authenticated;
grant execute on function public.sweep_signup_ip_reservations()
  to service_role;

-- ####################  0019_signup_device_identity_claims.sql  ####################

-- 0019 - VPN-resistant trial claims
--
-- An IP address is not a person. A VPN can change it, while an office or
-- household can legitimately share it. Keep the network claim from 0018, then
-- add two independent, pseudonymous signals:
--
--   1. a server-signed first-party device token; and
--   2. persistent HMAC claims for normalized email, phone, and LinkedIn ID.
--
-- Raw device identifiers and identity values are never stored here. Claims
-- intentionally survive auth-user deletion so deleting an account cannot
-- restore trial eligibility.

create table if not exists public.signup_device_claims (
  device_hash text primary key,
  user_id     uuid not null unique,
  claimed_at  timestamptz not null default now(),
  constraint signup_device_claims_hash_format
    check (device_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.signup_identity_claims (
  identity_hash text primary key,
  identity_kind text not null,
  user_id       uuid not null,
  claimed_at    timestamptz not null default now(),
  constraint signup_identity_claims_hash_format
    check (identity_hash ~ '^[0-9a-f]{64}$'),
  constraint signup_identity_claims_kind
    check (identity_kind in ('email', 'phone', 'linkedin')),
  constraint signup_identity_claims_user_kind_unique
    unique (user_id, identity_kind)
);

create index if not exists signup_identity_claims_user_id_idx
  on public.signup_identity_claims (user_id);

alter table public.signup_device_claims enable row level security;
alter table public.signup_identity_claims enable row level security;

revoke all on table public.signup_device_claims
  from public, anon, authenticated;
revoke all on table public.signup_identity_claims
  from public, anon, authenticated;
grant select, insert, update, delete on table public.signup_device_claims
  to service_role;
grant select, insert, update, delete on table public.signup_identity_claims
  to service_role;

-- Consume the network reservation and all additional claims inside the same
-- transaction as auth.users. A duplicate device or identity raises a unique
-- violation, rolling back the auth user and the network-claim update together.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token         text;
  v_token_hash    text;
  v_ip_hash       text;
  v_device_hash   text;
  v_email_hash    text;
  v_phone_hash    text;
  v_linkedin_hash text;
begin
  v_token := nullif(new.raw_user_meta_data ->> 'signup_reservation_token', '');
  v_device_hash := nullif(new.raw_user_meta_data ->> 'signup_device_hash', '');
  v_email_hash := nullif(new.raw_user_meta_data ->> 'signup_email_hash', '');
  v_phone_hash := nullif(new.raw_user_meta_data ->> 'signup_phone_hash', '');
  v_linkedin_hash := nullif(new.raw_user_meta_data ->> 'signup_linkedin_hash', '');

  if v_token is null or length(v_token) > 256
     or v_device_hash is null or v_device_hash !~ '^[0-9a-f]{64}$'
     or v_email_hash is null or v_email_hash !~ '^[0-9a-f]{64}$'
     or v_phone_hash is null or v_phone_hash !~ '^[0-9a-f]{64}$'
     or v_linkedin_hash is null or v_linkedin_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Signup is not authorized' using errcode = '28000';
  end if;

  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  update public.signup_ip_claims
     set token_hash = null,
         user_id = new.id,
         claimed_at = now(),
         reserved_until = now()
   where token_hash = v_token_hash
     and claimed_at is null
     and reserved_until > now()
  returning ip_hash into v_ip_hash;

  if v_ip_hash is null then
    raise exception 'Signup is not authorized' using errcode = '28000';
  end if;

  insert into public.signup_device_claims (device_hash, user_id)
  values (v_device_hash, new.id);

  insert into public.signup_identity_claims (
    identity_hash, identity_kind, user_id
  ) values
    (v_email_hash, 'email', new.id),
    (v_phone_hash, 'phone', new.id),
    (v_linkedin_hash, 'linkedin', new.id);

  insert into public.profiles (id, email, full_name, phone, linkedin_url)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'linkedin_url', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
