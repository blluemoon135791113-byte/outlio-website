-- 0032 — browser extension: devices, pairing, capture sessions
--
-- Adds a SECOND ingestion source. The extension sends a page it captured in
-- the user's own browser; that page is written to storage and enqueued as an
-- ordinary single-file extraction_job. The parser, credit charge, dedupe and
-- CSV writer are untouched:
--
--   Source A  HTML upload      ┐
--   Source B  browser extension┴─► extraction_jobs ─► job_queue ─► processJob()
--
-- extraction_jobs.capture_session_id is NULL for source A, so every existing
-- upload keeps working exactly as before.
--
-- ---------------------------------------------------------------------------
-- SECURITY POSTURE
-- ---------------------------------------------------------------------------
--
-- The extension is public code. Everything it holds is user-scoped and short
-- lived; nothing it sends is trusted. Tokens are stored HASHED so a database
-- disclosure does not yield usable credentials, exactly as the signup claim
-- tables already do.
--
-- Entitlement is NEVER read from the client. Every capture re-derives
-- user → profile → plan → subscription server-side.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'capture_session_status') then
    create type public.capture_session_status as enum (
      'active',
      'completed',
      'abandoned'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'capture_page_status') then
    create type public.capture_page_status as enum (
      'received',
      'queued',
      'processed',
      'duplicate',
      'failed'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Admin kill-switch, per user
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists extension_enabled boolean not null default true;

comment on column public.profiles.extension_enabled is
  'Admin switch for extension access. Independent of subscription: an admin can '
  'revoke extension use without touching billing. Checked on every capture.';

-- ---------------------------------------------------------------------------
-- 3. extension_devices — one row per installed browser
--
-- refresh_token_hash is a keyed hash, never the token. access_token_jti is the
-- id of the currently valid access token, so revocation invalidates in-flight
-- tokens rather than waiting for expiry.
-- ---------------------------------------------------------------------------

create table if not exists public.extension_devices (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  label              text not null,
  browser            text,
  platform           text,
  refresh_token_hash text not null,
  access_token_jti   uuid,
  enabled            boolean not null default true,
  created_at         timestamptz not null default now(),
  last_active_at     timestamptz,
  revoked_at         timestamptz,
  revoked_by         uuid references auth.users(id) on delete set null
);

create index if not exists extension_devices_user_idx
  on public.extension_devices (user_id);
create unique index if not exists extension_devices_refresh_idx
  on public.extension_devices (refresh_token_hash);

alter table public.extension_devices enable row level security;

drop policy if exists extension_devices_select_own on public.extension_devices;
create policy extension_devices_select_own on public.extension_devices
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. extension_pairings — one-time codes
--
-- Short lived and single use. `state` is the CSRF value the extension
-- generated; the callback must present the same one.
-- ---------------------------------------------------------------------------

create table if not exists public.extension_pairings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  code_hash   text not null unique,
  state       text not null,
  label       text,
  browser     text,
  platform    text,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists extension_pairings_expiry_idx
  on public.extension_pairings (expires_at) where consumed_at is null;

alter table public.extension_pairings enable row level security;
-- No policy: reachable only through the service role. Nothing client-side
-- should ever read a pairing row.

-- ---------------------------------------------------------------------------
-- 5. capture_sessions
-- ---------------------------------------------------------------------------

create table if not exists public.capture_sessions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  device_id          uuid references public.extension_devices(id) on delete set null,
  status             public.capture_session_status not null default 'active',
  source             text not null default 'salesnav',
  browser            text,
  started_at         timestamptz not null default now(),
  completed_at       timestamptz,
  pages_processed    int not null default 0,
  leads_found        int not null default 0,
  leads_imported     int not null default 0,
  duplicates_skipped int not null default 0,
  created_at         timestamptz not null default now()
);

create index if not exists capture_sessions_user_idx
  on public.capture_sessions (user_id, started_at desc);

-- At most one active session per user. A second Start Capture resumes the
-- existing one rather than splitting the counts across two rows.
create unique index if not exists capture_sessions_one_active
  on public.capture_sessions (user_id) where status = 'active';

alter table public.capture_sessions enable row level security;

drop policy if exists capture_sessions_select_own on public.capture_sessions;
create policy capture_sessions_select_own on public.capture_sessions
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 6. capture_pages
--
-- content_hash is THE duplicate authority. A refresh, a back-navigation, the
-- same search in a second tab, or a resumed session all produce identical
-- bytes and are rejected by the unique index below — in the database, not in
-- client JavaScript.
-- ---------------------------------------------------------------------------

create table if not exists public.capture_pages (
  id                 uuid primary key default gen_random_uuid(),
  capture_session_id uuid not null references public.capture_sessions(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  extraction_job_id  uuid references public.extraction_jobs(id) on delete set null,
  source_url         text,
  page_identifier    text,
  status             public.capture_page_status not null default 'received',
  leads_found        int not null default 0,
  content_hash       text not null,
  error              text,
  created_at         timestamptz not null default now(),
  processed_at       timestamptz
);

create index if not exists capture_pages_session_idx
  on public.capture_pages (capture_session_id, created_at);
create index if not exists capture_pages_job_idx
  on public.capture_pages (extraction_job_id);

-- Scoped to the USER, not the session: re-capturing the same page in a new
-- session is still a duplicate and must not be billed twice.
create unique index if not exists capture_pages_user_content_unique
  on public.capture_pages (user_id, content_hash);

alter table public.capture_pages enable row level security;

drop policy if exists capture_pages_select_own on public.capture_pages;
create policy capture_pages_select_own on public.capture_pages
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 7. Link extraction_jobs back to a capture session
--
-- NULL means the job came from an HTML upload. Source A is unaffected.
-- ---------------------------------------------------------------------------

alter table public.extraction_jobs
  add column if not exists capture_session_id uuid
    references public.capture_sessions(id) on delete set null;

create index if not exists extraction_jobs_capture_idx
  on public.extraction_jobs (capture_session_id)
  where capture_session_id is not null;

comment on column public.extraction_jobs.capture_session_id is
  'Set when the job came from the browser extension. NULL for HTML uploads.';

-- ---------------------------------------------------------------------------
-- 8. claim_capture_page
--
-- Reserves a content_hash for one user in a single statement. Returns
-- 'duplicate' when the page was already taken, so the caller can answer
-- without doing any work and without spending a credit.
--
-- The unique index is the real guard; this function turns the resulting
-- constraint violation into an ordinary result rather than an error, so two
-- tabs racing the same page cannot both proceed.
-- ---------------------------------------------------------------------------

create or replace function public.claim_capture_page(
  p_session_id   uuid,
  p_user_id      uuid,
  p_content_hash text,
  p_source_url   text,
  p_page_ident   text
)
returns table (status text, page_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_page_id uuid;
  v_active  boolean;
begin
  select (status = 'active') into v_active
    from public.capture_sessions
   where id = p_session_id and user_id = p_user_id;

  if not found then
    status := 'not_found'; page_id := null; return next; return;
  end if;

  if not v_active then
    status := 'session_closed'; page_id := null; return next; return;
  end if;

  begin
    insert into public.capture_pages (
      capture_session_id, user_id, content_hash, source_url, page_identifier, status
    )
    values (p_session_id, p_user_id, p_content_hash, p_source_url, p_page_ident, 'received')
    returning id into v_page_id;
  exception when unique_violation then
    -- Already captured by this user, in this or any earlier session.
    update public.capture_sessions
       set duplicates_skipped = duplicates_skipped + 1
     where id = p_session_id;
    status := 'duplicate'; page_id := null; return next; return;
  end;

  status := 'claimed'; page_id := v_page_id; return next;
end;
$$;

revoke all on function public.claim_capture_page(uuid, uuid, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. roll_capture_totals
--
-- Called when a job belonging to a capture session finishes. Keeps the
-- session counters correct without the dashboard aggregating on every read.
-- ---------------------------------------------------------------------------

create or replace function public.roll_capture_totals(
  p_page_id     uuid,
  p_user_id     uuid,
  p_job_id      uuid,
  p_leads_found int,
  p_leads_kept  int,
  p_status      public.capture_page_status,
  p_error       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  update public.capture_pages
     set status            = p_status,
         extraction_job_id = p_job_id,
         leads_found       = coalesce(p_leads_found, 0),
         error             = p_error,
         processed_at      = now()
   where id = p_page_id
     and user_id = p_user_id
  returning capture_session_id into v_session_id;

  if v_session_id is null then
    return;
  end if;

  update public.capture_sessions
     set pages_processed    = pages_processed + case when p_status = 'processed' then 1 else 0 end,
         leads_found        = leads_found     + coalesce(p_leads_found, 0),
         leads_imported     = leads_imported  + coalesce(p_leads_kept, 0),
         duplicates_skipped = duplicates_skipped
                              + greatest(coalesce(p_leads_found, 0) - coalesce(p_leads_kept, 0), 0)
   where id = v_session_id;
end;
$$;

revoke all on function public.roll_capture_totals(uuid, uuid, uuid, int, int, public.capture_page_status, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. revoke_extension_device / revoke_all_extension_devices
--
-- Revocation nulls the refresh hash and the live access jti, so a stolen
-- access token stops working immediately rather than at expiry.
-- ---------------------------------------------------------------------------

create or replace function public.revoke_extension_device(
  p_device_id uuid,
  p_user_id   uuid,
  p_actor_id  uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  update public.extension_devices
     set enabled            = false,
         revoked_at         = now(),
         revoked_by         = coalesce(p_actor_id, p_user_id),
         access_token_jti   = null,
         -- Keep the row for the audit trail, but make the hash unmatchable.
         refresh_token_hash = 'revoked:' || id::text
   where id = p_device_id
     and user_id = p_user_id
     and revoked_at is null;

  get diagnostics v_found = row_count;
  return v_found > 0;
end;
$$;

revoke all on function public.revoke_extension_device(uuid, uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Realtime
--
-- The dashboard already subscribes to postgres_changes per user. Adding these
-- tables lets the live capture widget update without new infrastructure.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.capture_sessions;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.capture_pages;
    exception when duplicate_object then null;
    end;
  end if;
end
$$;
