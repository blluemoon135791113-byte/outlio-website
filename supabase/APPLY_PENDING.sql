-- ===========================================================================
-- OUTLIO - PENDING MIGRATIONS (0015-0018)
-- Updated 2026-08-09
-- Already applied: 0001-0014. Idempotent.
--
-- 0015 replaces the PLACEHOLDER plans with the real credit-based tiers.
-- 0016 adds the export-destination table (schema only; OAuth not wired).
-- 0017 makes upload finalization and account suspension atomic.
-- 0018 enforces one trial account per hashed network and blocks direct Auth bypasses.
-- ===========================================================================


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
