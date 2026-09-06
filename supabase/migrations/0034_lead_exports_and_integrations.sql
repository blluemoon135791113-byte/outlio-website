-- 0034 — provider-independent lead exports and CRM integrations
--
-- This migration stores only safe connection metadata in the user-readable
-- table. Provider credentials live in a separate, service-role-only table as
-- application-encrypted ciphertext. The browser never receives that table.

alter table public.extracted_leads
  add column if not exists sales_navigator_url text;

comment on column public.extracted_leads.sales_navigator_url is
  'Sales Navigator lead URL captured by the parser. Nullable because older rows predate this column.';

-- Composite keys let child tables enforce that both sides belong to the same
-- tenant, even though all writes are already service-role scoped in the app.
create unique index if not exists extracted_leads_id_user_uniq
  on public.extracted_leads (id, user_id);

create table if not exists public.integration_connections (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id) on delete cascade,
  provider                  text not null,
  status                    text not null default 'not_connected'
                              check (status in (
                                'not_connected',
                                'connecting',
                                'connected',
                                'reconnect_required',
                                'error'
                              )),
  external_account_id       text,
  external_account_name     text,
  external_account_email    text,
  scopes                    text[] not null default '{}',
  configuration             jsonb not null default '{}'::jsonb,
  secret_reference          uuid not null default gen_random_uuid() unique,
  token_expires_at          timestamptz,
  connected_at              timestamptz,
  last_used_at              timestamptz,
  last_tested_at            timestamptz,
  last_error                text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (id, user_id),
  unique (id, secret_reference),
  unique (user_id, provider)
);

drop trigger if exists integration_connections_set_updated_at
  on public.integration_connections;
create trigger integration_connections_set_updated_at
  before update on public.integration_connections
  for each row execute function public.set_updated_at();

create index if not exists integration_connections_user_idx
  on public.integration_connections (user_id, provider);

alter table public.integration_connections enable row level security;

drop policy if exists integration_connections_select_own
  on public.integration_connections;
create policy integration_connections_select_own
  on public.integration_connections
  for select to authenticated
  using (auth.uid() = user_id);

revoke all on table public.integration_connections
  from public, anon, authenticated;
grant select on table public.integration_connections to authenticated;
grant select, insert, update, delete on table public.integration_connections
  to service_role;

-- One opaque encrypted envelope per connection. `encrypted_payload` contains
-- access/refresh tokens or Clay credentials encrypted with AES-256-GCM by the
-- application. There are deliberately no client policies.
create table if not exists public.integration_secrets (
  id                 uuid primary key,
  connection_id      uuid not null unique,
  encrypted_payload  text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (connection_id, id)
    references public.integration_connections(id, secret_reference)
    on delete cascade
);

drop trigger if exists integration_secrets_set_updated_at
  on public.integration_secrets;
create trigger integration_secrets_set_updated_at
  before update on public.integration_secrets
  for each row execute function public.set_updated_at();

alter table public.integration_secrets enable row level security;
revoke all on table public.integration_secrets
  from public, anon, authenticated;
grant select, insert, update, delete on table public.integration_secrets
  to service_role;

comment on table public.integration_secrets is
  'Service-role only. encrypted_payload must never be logged or returned to a client.';

-- Short-lived server-side OAuth state. State is stored as a SHA-256 hash; the
-- PKCE verifier is application-encrypted. No browser or authenticated client
-- can read or mutate these rows directly.
create table if not exists public.integration_oauth_transactions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  provider                 text not null,
  state_hash               text not null unique
                             check (state_hash ~ '^[0-9a-f]{64}$'),
  encrypted_code_verifier  text,
  redirect_uri             text not null,
  return_to                text not null default '/dashboard/settings#integrations',
  expires_at               timestamptz not null,
  created_at               timestamptz not null default now()
);

create index if not exists integration_oauth_transactions_expiry_idx
  on public.integration_oauth_transactions (expires_at);

alter table public.integration_oauth_transactions enable row level security;
revoke all on table public.integration_oauth_transactions
  from public, anon, authenticated;
grant select, insert, update, delete on table public.integration_oauth_transactions
  to service_role;

create table if not exists public.export_jobs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  extraction_job_id   uuid references public.extraction_jobs(id) on delete set null,
  provider            text not null,
  status              text not null default 'pending'
                        check (status in ('pending', 'processing', 'completed', 'partial', 'failed')),
  lead_count          integer not null default 0 check (lead_count >= 0),
  successful_count    integer not null default 0 check (successful_count >= 0),
  failed_count        integer not null default 0 check (failed_count >= 0),
  destination_id      text,
  destination_url     text,
  options             jsonb not null default '{}'::jsonb,
  error_code          text,
  error_message       text,
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, user_id)
);

drop trigger if exists export_jobs_set_updated_at on public.export_jobs;
create trigger export_jobs_set_updated_at
  before update on public.export_jobs
  for each row execute function public.set_updated_at();

create index if not exists export_jobs_user_created_idx
  on public.export_jobs (user_id, created_at desc);
create index if not exists export_jobs_extraction_idx
  on public.export_jobs (user_id, extraction_job_id);

alter table public.export_jobs enable row level security;

drop policy if exists export_jobs_select_own on public.export_jobs;
create policy export_jobs_select_own on public.export_jobs
  for select to authenticated
  using (auth.uid() = user_id);

revoke all on table public.export_jobs from public, anon, authenticated;
grant select on table public.export_jobs to authenticated;
grant select, insert, update, delete on table public.export_jobs to service_role;

-- Only client-safe, per-record failure summaries belong here. Raw provider
-- responses and credentials belong in neither this table nor application logs.
create table if not exists public.export_job_errors (
  id             uuid primary key default gen_random_uuid(),
  export_job_id  uuid not null,
  user_id        uuid not null references auth.users(id) on delete cascade,
  lead_id        uuid,
  error_code     text not null,
  error_message  text not null,
  created_at     timestamptz not null default now(),
  foreign key (export_job_id, user_id)
    references public.export_jobs(id, user_id) on delete cascade,
  foreign key (lead_id, user_id)
    references public.extracted_leads(id, user_id) on delete set null (lead_id)
);

create index if not exists export_job_errors_job_idx
  on public.export_job_errors (user_id, export_job_id);

alter table public.export_job_errors enable row level security;

drop policy if exists export_job_errors_select_own on public.export_job_errors;
create policy export_job_errors_select_own on public.export_job_errors
  for select to authenticated
  using (auth.uid() = user_id);

revoke all on table public.export_job_errors from public, anon, authenticated;
grant select on table public.export_job_errors to authenticated;
grant select, insert, update, delete on table public.export_job_errors to service_role;

-- Stable provider record links prevent repeated CRM exports from blindly
-- creating duplicates when the source lead has no safe external identifier.
create table if not exists public.integration_record_links (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  connection_id       uuid not null,
  lead_id             uuid not null,
  provider_record_id  text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (connection_id, user_id)
    references public.integration_connections(id, user_id) on delete cascade,
  foreign key (lead_id, user_id)
    references public.extracted_leads(id, user_id) on delete cascade,
  unique (connection_id, lead_id),
  unique (connection_id, provider_record_id)
);

drop trigger if exists integration_record_links_set_updated_at
  on public.integration_record_links;
create trigger integration_record_links_set_updated_at
  before update on public.integration_record_links
  for each row execute function public.set_updated_at();

create index if not exists integration_record_links_user_idx
  on public.integration_record_links (user_id, connection_id);

alter table public.integration_record_links enable row level security;
revoke all on table public.integration_record_links
  from public, anon, authenticated;
grant select, insert, update, delete on table public.integration_record_links
  to service_role;

-- Atomically replace a user's encrypted Clay connection. The webhook and
-- optional auth token are already encrypted before they reach this function;
-- only the non-secret hostname label is stored as metadata.
create or replace function public.save_clay_connection(
  p_user_id uuid,
  p_encrypted_payload text,
  p_account_label text
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_connection_id uuid;
  v_secret_reference uuid;
begin
  insert into public.integration_connections (
    user_id,
    provider,
    status,
    external_account_name,
    connected_at,
    last_tested_at,
    last_error
  ) values (
    p_user_id,
    'clay',
    'connected',
    p_account_label,
    now(),
    now(),
    null
  )
  on conflict (user_id, provider) do update
    set status = 'connected',
        external_account_name = excluded.external_account_name,
        connected_at = now(),
        last_tested_at = now(),
        last_error = null
  returning id, secret_reference
    into v_connection_id, v_secret_reference;

  insert into public.integration_secrets (
    id,
    connection_id,
    encrypted_payload
  ) values (
    v_secret_reference,
    v_connection_id,
    p_encrypted_payload
  )
  on conflict (connection_id) do update
    set encrypted_payload = excluded.encrypted_payload;

  return v_connection_id;
end;
$$;

create or replace function public.disconnect_integration(
  p_user_id uuid,
  p_provider text
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_connection_id uuid;
begin
  select id into v_connection_id
    from public.integration_connections
   where user_id = p_user_id
     and provider = p_provider
   for update;

  if v_connection_id is null then
    return false;
  end if;

  delete from public.integration_secrets
   where connection_id = v_connection_id;

  update public.integration_connections
     set status = 'not_connected',
         external_account_id = null,
         external_account_name = null,
         external_account_email = null,
         scopes = '{}',
         configuration = '{}'::jsonb,
         token_expires_at = null,
         connected_at = null,
         last_used_at = null,
         last_tested_at = null,
         last_error = null
   where id = v_connection_id
     and user_id = p_user_id;

  return true;
end;
$$;

revoke all on function public.save_clay_connection(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.save_clay_connection(uuid, text, text)
  to service_role;

revoke all on function public.disconnect_integration(uuid, text)
  from public, anon, authenticated;
grant execute on function public.disconnect_integration(uuid, text)
  to service_role;
