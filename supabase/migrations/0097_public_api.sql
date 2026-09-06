-- 0097 — public API keys and outbound webhooks (M8 Phase 25.5)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  AN API KEY IS STORED AS A HASH AND SHOWN EXACTLY ONCE.                  ║
-- ║                                                                           ║
-- ║  A key in plaintext is a credential that anyone with a database dump,     ║
-- ║  a backup, or a support query can use to read every contact in a          ║
-- ║  workspace. Hashing costs nothing — verification looks the hash up rather ║
-- ║  than the key — and it is the difference between a leaked dump being      ║
-- ║  embarrassing and being catastrophic.                                    ║
-- ║                                                                           ║
-- ║  The same reasoning the workspace invitations already use (0070): the     ║
-- ║  token is shown once and only its SHA-256 is kept.                       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

do $$
begin
  if not exists (select 1 from pg_type where typname = 'api_scope') then
    /*
     * ⚠️ READ AND WRITE ARE SEPARATE PER RESOURCE. A single "access" scope
     * would mean any integration that needs to read contacts can also delete
     * them — and most integrations only ever read.
     */
    create type public.api_scope as enum (
      'contacts:read',  'contacts:write',
      'companies:read', 'companies:write',
      'opportunities:read', 'opportunities:write',
      'activities:read', 'activities:write',
      'tasks:read',     'tasks:write',
      'lists:read',     'lists:write'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'webhook_delivery_status') then
    create type public.webhook_delivery_status as enum (
      'pending', 'delivered', 'failed', 'exhausted'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- api_keys
-- ---------------------------------------------------------------------------

create table if not exists public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,

  name          text not null check (length(trim(name)) between 1 and 120),

  /*
   * ⚠️ SHA-256 OF THE KEY, NEVER THE KEY. Unique so verification is a single
   * indexed lookup rather than a scan — a scan would make key checking slower
   * as a customer adds keys, which is the wrong direction for an auth path.
   */
  key_hash      text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),

  /*
   * The first characters of the key, shown in the UI so a person can tell
   * which key a row refers to without being able to reconstruct it.
   */
  key_prefix    text not null,

  scopes        public.api_scope[] not null default '{}',

  /* Requests per minute. NULL uses the platform default. */
  rate_limit_per_minute integer check (rate_limit_per_minute is null or rate_limit_per_minute > 0),

  last_used_at  timestamptz,
  expires_at    timestamptz,

  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz
);

create index if not exists api_keys_workspace_idx
  on public.api_keys (workspace_id, created_at desc);

/*
 * ⚠️ NO SELECT POLICY EXPOSES `key_hash` — the whole table is service-role
 * only, and the UI reads it through a server component that omits the column.
 * A client policy would put the hash on the wire.
 */
alter table public.api_keys enable row level security;
revoke all on table public.api_keys from public, anon, authenticated;
grant select, insert, update, delete on table public.api_keys to service_role;

-- ---------------------------------------------------------------------------
-- api_request_log — CRITERION 7's audit trail.
--
-- ⚠️ RECORDS REFUSALS AS WELL AS SUCCESSES. "Someone tried to read another
-- workspace's contacts with our key" is the single most important thing this
-- log can tell an operator, and a log of successes cannot say it.
-- ---------------------------------------------------------------------------

create table if not exists public.api_request_log (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  api_key_id    uuid references public.api_keys(id) on delete set null,

  method        text not null,
  path          text not null,
  status        integer not null,
  /* Set when the request was refused, so a pattern is greppable. */
  denied_reason text,

  duration_ms   integer,
  created_at    timestamptz not null default now()
);

create index if not exists api_request_log_key_idx
  on public.api_request_log (api_key_id, created_at desc);

create index if not exists api_request_log_denied_idx
  on public.api_request_log (workspace_id, created_at desc)
  where denied_reason is not null;

alter table public.api_request_log enable row level security;

drop policy if exists api_request_log_select_member on public.api_request_log;
create policy api_request_log_select_member on public.api_request_log
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

revoke all on table public.api_request_log from public, anon, authenticated;
grant select on table public.api_request_log to authenticated;
grant select, insert on table public.api_request_log to service_role;

-- ---------------------------------------------------------------------------
-- webhook_subscriptions
-- ---------------------------------------------------------------------------

create table if not exists public.webhook_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,

  name          text not null check (length(trim(name)) between 1 and 120),
  url           text not null check (url like 'https://%'),

  /* Domain events this endpoint wants. Text, so a new event needs no migration. */
  events        text[] not null default '{}',

  /*
   * ⚠️ THE SIGNING SECRET IS STORED, NOT HASHED — unlike an API key, and
   * deliberately. We must be able to COMPUTE the signature on every delivery,
   * which needs the secret itself. It is service-role only and shown to the
   * customer once, exactly like a provider's own webhook secret.
   */
  signing_secret text not null,

  is_active     boolean not null default true,

  /* Consecutive failures. A subscription that never succeeds is disabled. */
  failure_count integer not null default 0 check (failure_count >= 0),
  disabled_at   timestamptz,
  disabled_reason text,

  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists webhook_subscriptions_workspace_idx
  on public.webhook_subscriptions (workspace_id)
  where is_active;

drop trigger if exists webhook_subscriptions_set_updated_at on public.webhook_subscriptions;
create trigger webhook_subscriptions_set_updated_at
  before update on public.webhook_subscriptions
  for each row execute function public.set_updated_at();

alter table public.webhook_subscriptions enable row level security;
revoke all on table public.webhook_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.webhook_subscriptions to service_role;

-- ---------------------------------------------------------------------------
-- webhook_deliveries — CRITERION 8's visible delivery log.
-- ---------------------------------------------------------------------------

create table if not exists public.webhook_deliveries (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  subscription_id uuid not null references public.webhook_subscriptions(id) on delete cascade,

  /*
   * ⚠️ THE EVENT ID THE CONSUMER DEDUPES ON. Sent as a header so a retry
   * carries the SAME id — that is what makes delivery idempotent for the
   * consumer, which criterion 8 requires. A new id per attempt would make
   * every retry look like a new event.
   */
  event_id      uuid not null default gen_random_uuid(),
  event_type    text not null,
  payload       jsonb not null,

  status        public.webhook_delivery_status not null default 'pending',
  attempts      integer not null default 0 check (attempts >= 0),
  max_attempts  integer not null default 5,

  next_attempt_at timestamptz not null default now(),

  /* What the endpoint said, for the customer's own debugging. */
  last_status_code integer,
  last_error    text,

  delivered_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists webhook_deliveries_due_idx
  on public.webhook_deliveries (next_attempt_at)
  where status = 'pending';

create index if not exists webhook_deliveries_subscription_idx
  on public.webhook_deliveries (subscription_id, created_at desc);

create unique index if not exists webhook_deliveries_event_idx
  on public.webhook_deliveries (subscription_id, event_id);

drop trigger if exists webhook_deliveries_set_updated_at on public.webhook_deliveries;
create trigger webhook_deliveries_set_updated_at
  before update on public.webhook_deliveries
  for each row execute function public.set_updated_at();

alter table public.webhook_deliveries enable row level security;

drop policy if exists webhook_deliveries_select_member on public.webhook_deliveries;
create policy webhook_deliveries_select_member on public.webhook_deliveries
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

revoke all on table public.webhook_deliveries from public, anon, authenticated;
grant select on table public.webhook_deliveries to authenticated;
grant select, insert, update, delete on table public.webhook_deliveries to service_role;

-- ---------------------------------------------------------------------------
-- api_key_for_hash — the auth lookup.
--
-- ⚠️ RETURNS THE KEY'S WORKSPACE, WHICH THE CALLER MUST THEN USE. Criterion 7
-- is workspace scoping: a request never states which workspace it wants, it is
-- DERIVED from the key. A caller that accepted a workspace id from the request
-- and merely checked it against the key would have an authorisation bug the
-- first time someone forgot the check.
-- ---------------------------------------------------------------------------

create or replace function public.api_key_for_hash(p_key_hash text)
returns table (
  api_key_id   uuid,
  workspace_id uuid,
  scopes       public.api_scope[],
  rate_limit_per_minute integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select k.id, k.workspace_id, k.scopes, k.rate_limit_per_minute
    from public.api_keys k
   where k.key_hash = p_key_hash
     and k.revoked_at is null
     and (k.expires_at is null or k.expires_at > now());
$$;

revoke all on function public.api_key_for_hash(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- enqueue_webhook_delivery — fan one domain event out to its subscribers.
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_webhook_delivery(
  p_workspace_id uuid,
  p_event_type   text,
  p_payload      jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  insert into public.webhook_deliveries
    (workspace_id, subscription_id, event_type, payload)
  select p_workspace_id, s.id, p_event_type, p_payload
    from public.webhook_subscriptions s
   where s.workspace_id = p_workspace_id
     and s.is_active
     /* `events` empty means "everything", which is what most people want from
        a first subscription and saves them enumerating every type. */
     and (s.events = '{}' or p_event_type = any(s.events));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.enqueue_webhook_delivery(uuid, text, jsonb)
  from public, anon, authenticated;

comment on table public.api_keys is
  'Keys are stored as SHA-256 and shown once. `key_prefix` exists so a person '
  'can identify a key in the UI without being able to reconstruct it.';

comment on column public.webhook_deliveries.event_id is
  'Sent as a header and STABLE across retries, so a consumer can dedupe — which '
  'is what makes delivery idempotent for them (M8 criterion 8).';
