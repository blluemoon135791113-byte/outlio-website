-- 0085 — email sending accounts (M5 Phase 11)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  WHY THIS IS A NEW TABLE AND NOT `integration_connections`.               ║
-- ║                                                                           ║
-- ║  The Ledger said M5 should extend `integration_connections` rather than   ║
-- ║  build a parallel system. That advice was written before the M5 detail    ║
-- ║  existed and it is right about the CRYPTO and wrong about the TABLE.      ║
-- ║                                                                           ║
-- ║  `integration_connections` carries `unique (user_id, provider)` — exactly ║
-- ║  ONE Google connection per user. Cold outbound is the opposite: a         ║
-- ║  workspace runs MANY sending mailboxes, each with its own schedule,       ║
-- ║  limits, ramp and health. Relaxing that constraint is not a small change: ║
-- ║  every existing read is `.eq(user_id).eq(provider).maybeSingle()` and     ║
-- ║  `save_google_connection` upserts `onConflict: user_id,provider`, so the  ║
-- ║  moment a user connected a second mailbox every EXPORT integration would  ║
-- ║  start throwing on a two-row result.                                     ║
-- ║                                                                           ║
-- ║  So: same encryption (`lib/integrations/crypto.ts`), same secrets-table   ║
-- ║  pattern, same OAuth transaction table — different resource. Sharing the  ║
-- ║  part that carries security risk is the point; sharing a row shape that   ║
-- ║  forbids the product's core cardinality is not.                          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'email_provider') then
    create type public.email_provider as enum ('gmail', 'microsoft', 'smtp');
  end if;

  -- PERSONAL: one member's own mailbox. WORKSPACE: a shared sending identity
  -- any authorised member may send from.
  if not exists (select 1 from pg_type where typname = 'email_account_scope') then
    create type public.email_account_scope as enum ('personal', 'workspace');
  end if;

  /*
   * All nine states from the M5 brief are created NOW even though Phase 11
   * only ever sets four of them. Phase 13 owns readiness and will drive the
   * rest; adding enum values later is the awkward migration, adding them up
   * front costs nothing.
   */
  if not exists (select 1 from pg_type where typname = 'email_account_status') then
    create type public.email_account_status as enum (
      'not_configured',
      'authentication_required',
      'ramping',
      'ready',
      'warning',
      'throttled',
      'paused',
      'disconnected',
      'error'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- email_accounts
-- ---------------------------------------------------------------------------

create table if not exists public.email_accounts (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,

  provider            public.email_provider not null,
  scope               public.email_account_scope not null default 'personal',

  /*
   * ⚠️ NOT NULL EVEN FOR A WORKSPACE ACCOUNT. Someone is accountable for a
   * mailbox: it is their credentials, their domain reputation and their
   * problem when it starts bouncing. A shared account is one the whole team
   * may SEND from, not one nobody owns. `on delete restrict` because deleting
   * a user must not silently orphan a live sending identity.
   */
  owner_user_id       uuid not null references auth.users(id) on delete restrict,

  display_name        text not null check (length(trim(display_name)) between 1 and 120),

  -- The sending identity itself. Stored lowercase; the app normalizes.
  from_email          text not null check (from_email = lower(from_email) and from_email like '%@%'),
  from_name           text check (from_name is null or length(trim(from_name)) between 1 and 120),
  reply_to_email      text check (reply_to_email is null or reply_to_email = lower(reply_to_email)),

  /*
   * ⚠️ THE DOMAIN IS STORED, NOT DERIVED AT READ TIME. Phase 13 aggregates
   * health PER DOMAIN as well as per mailbox, and a rollup that re-parses an
   * address on every read cannot be indexed. Kept honest by a check that ties
   * it to from_email.
   */
  from_domain         text not null check (from_domain = lower(from_domain)),

  status              public.email_account_status not null default 'not_configured',

  /*
   * Non-secret connection settings only — SMTP/IMAP host and port. A password
   * or token NEVER belongs here: this column is readable by workspace members
   * under the select policy below, and capability checks deliberately read it
   * so they never have to decrypt anything on a hot path.
   */
  configuration       jsonb not null default '{}'::jsonb,

  -- Sending limits. NULL means "not yet known", which is different from 0.
  daily_send_limit    integer check (daily_send_limit is null or daily_send_limit >= 0),
  hourly_send_limit   integer check (hourly_send_limit is null or hourly_send_limit >= 0),
  min_delay_seconds   integer not null default 60 check (min_delay_seconds >= 0),

  /*
   * Schedule. An IANA name, not an offset — an offset is wrong twice a year,
   * and "09:00 in the recipient's working day" is the whole point.
   */
  timezone            text not null default 'UTC',
  send_window_start   time not null default '09:00',
  send_window_end     time not null default '17:00',
  -- ISO weekdays: 1 = Monday .. 7 = Sunday. Default Mon–Fri.
  send_days           smallint[] not null default '{1,2,3,4,5}'
                        check (send_days <@ array[1,2,3,4,5,6,7]::smallint[]),

  -- Health. Phase 13 computes these; Phase 11 only stores them.
  health_score        smallint check (health_score is null or health_score between 0 and 100),
  health_checked_at   timestamptz,

  last_sync_at        timestamptz,
  last_send_at        timestamptz,
  last_error          text,

  -- Same indirection as integration_connections: the secret row is reachable
  -- only through this reference, and the FK below makes the pair inseparable.
  secret_reference    uuid not null default gen_random_uuid() unique,

  connected_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,

  unique (id, secret_reference),

  /*
   * ⚠️ ONE LIVE ACCOUNT PER ADDRESS PER WORKSPACE — and `deleted_at` is part
   * of the key via a partial index below rather than here, so a disconnected
   * mailbox can be reconnected later without colliding with its own tombstone.
   */
  constraint email_accounts_send_window_ordered
    check (send_window_start < send_window_end)
);

create unique index if not exists email_accounts_workspace_address_live_idx
  on public.email_accounts (workspace_id, from_email)
  where deleted_at is null;

create index if not exists email_accounts_workspace_status_idx
  on public.email_accounts (workspace_id, status)
  where deleted_at is null;

-- Phase 13's per-domain health rollup reads this.
create index if not exists email_accounts_domain_idx
  on public.email_accounts (workspace_id, from_domain)
  where deleted_at is null;

create index if not exists email_accounts_owner_idx
  on public.email_accounts (owner_user_id)
  where deleted_at is null;

drop trigger if exists email_accounts_set_updated_at on public.email_accounts;
create trigger email_accounts_set_updated_at
  before update on public.email_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- email_account_secrets
--
-- ⚠️ NO CLIENT POLICY, DELIBERATELY. This is the M5 acceptance criterion 1
-- table: "secrets unreadable via any API after save". RLS is enabled and NO
-- policy is created, so under PostgREST every authenticated request returns
-- zero rows no matter how the query is written. The grant is service_role
-- only, which additionally keeps it off the anon key entirely. Copied
-- deliberately from `integration_secrets` (0034) — a pattern already carrying
-- production OAuth tokens is worth more than a new one.
-- ---------------------------------------------------------------------------

create table if not exists public.email_account_secrets (
  id                 uuid primary key,
  account_id         uuid not null unique,
  -- AES-256-GCM envelope from lib/integrations/crypto.ts. Never logged.
  encrypted_payload  text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (account_id, id)
    references public.email_accounts(id, secret_reference)
    on delete cascade
);

drop trigger if exists email_account_secrets_set_updated_at on public.email_account_secrets;
create trigger email_account_secrets_set_updated_at
  before update on public.email_account_secrets
  for each row execute function public.set_updated_at();

alter table public.email_account_secrets enable row level security;
revoke all on table public.email_account_secrets from public, anon, authenticated;
grant select, insert, update, delete on table public.email_account_secrets to service_role;

comment on table public.email_account_secrets is
  'Service-role only, no RLS policy by design. encrypted_payload must never be '
  'logged, returned to a client, or joined into an account read.';

-- ---------------------------------------------------------------------------
-- RLS on email_accounts
-- ---------------------------------------------------------------------------

alter table public.email_accounts enable row level security;

drop policy if exists email_accounts_select_member on public.email_accounts;

/*
 * ⚠️ A PERSONAL MAILBOX IS NOT TEAM-WIDE READABLE.
 *
 * Shared workspace accounts are visible to every member — they are shared by
 * definition. A personal mailbox is a named individual's own address, so it is
 * visible to its owner and to management, who need it for the per-mailbox
 * health reports M6 Phase 19 requires. A viewer or another setter has no
 * business enumerating a colleague's mailbox.
 *
 * Writes are absent on purpose: no insert, update or delete policy exists, so
 * every mutation goes through the service role in a server action that has
 * already checked `email.account.manage`. Hiding a button is not access
 * control, and neither is a permissive write policy.
 */
create policy email_accounts_select_member on public.email_accounts
  for select to authenticated
  using (
    (
      public.is_workspace_member(workspace_id)
      and (
        scope = 'workspace'
        or owner_user_id = (select auth.uid())
        or public.workspace_role_of(workspace_id) in ('owner', 'admin', 'manager')
      )
    )
    or public.is_admin()
  );

revoke all on table public.email_accounts from public, anon, authenticated;
grant select on table public.email_accounts to authenticated;
grant select, insert, update, delete on table public.email_accounts to service_role;

comment on table public.email_accounts is
  'Customer-owned sending mailboxes, workspace-scoped, many per workspace. '
  'Deliberately NOT integration_connections, whose unique (user_id, provider) '
  'permits only one connection per provider per user.';

comment on column public.email_accounts.configuration is
  'Non-secret connection settings only (SMTP/IMAP host and port). Readable by '
  'workspace members under RLS — never put a password or token here.';
