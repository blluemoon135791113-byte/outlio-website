-- 0001 — extensions, enum types, shared trigger functions
-- Forward-only. Idempotent.

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create schema if not exists extensions;
create extension if not exists "pg_trgm" with schema extensions; -- trigram search on lead text

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
