-- 0087 — email readiness and ramp (M5 Phase 13)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  NO WARMUP NETWORK. THE BRIEF SAYS SO AND IT IS RIGHT.                    ║
-- ║                                                                           ║
-- ║  A "warmup network" is a pool of accounts that email each other and mark  ║
-- ║  the results as important. It manufactures engagement signals that no     ║
-- ║  human produced, to persuade a mailbox provider that strangers want this  ║
-- ║  mail. That is deception aimed at the recipient's spam filter, and it is  ║
-- ║  the same category of thing as the LinkedIn automation this product       ║
-- ║  refuses to do.                                                          ║
-- ║                                                                           ║
-- ║  What replaces it is honest and duller: verify the DOMAIN is configured   ║
-- ║  correctly (SPF, DKIM, DMARC, alignment), start at a low daily volume and ║
-- ║  raise it gradually, and watch REAL bounce and complaint rates. No fake   ║
-- ║  opens, no fake replies, no seed accounts.                               ║
-- ║                                                                           ║
-- ║  ⚠️ AND THE SCORE NEVER CLAIMS INBOX PLACEMENT. Nobody outside Google or  ║
-- ║  Microsoft can measure whether mail landed in the inbox or in spam. A     ║
-- ║  vendor showing you "94% inbox placement" is showing you a seed-list      ║
-- ║  estimate, not your customers. This score describes CONFIGURATION and     ║
-- ║  OBSERVED OUTCOMES, and its label must say so.                           ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

do $$
begin
  if not exists (select 1 from pg_type where typname = 'email_check_status') then
    create type public.email_check_status as enum (
      'pass',
      'warn',
      'fail',
      -- ⚠️ NOT THE SAME AS `fail`. DKIM cannot be verified without knowing the
      -- selector, and "we could not check this" must never be reported as
      -- "this is broken" — that sends a customer chasing a problem that may
      -- not exist.
      'unknown',
      'not_applicable'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Ramp columns on email_accounts.
--
-- ⚠️ CONSERVATIVE DEFAULTS, because the failure is asymmetric. Starting too
-- low costs a few days; starting too high burns the domain and there is no
-- undo. 20/day rising by 5 to a 200/day ceiling is deliberately slower than
-- most tools default to.
-- ---------------------------------------------------------------------------

alter table public.email_accounts
  add column if not exists ramp_enabled         boolean not null default true,
  add column if not exists ramp_started_on      date,
  add column if not exists ramp_initial_daily   integer not null default 20
    check (ramp_initial_daily >= 0),
  add column if not exists ramp_daily_increment integer not null default 5
    check (ramp_daily_increment >= 0),
  add column if not exists ramp_target_daily    integer not null default 200
    check (ramp_target_daily >= 0);

comment on column public.email_accounts.ramp_enabled is
  'Gradual volume increase. Disabling it is a deliberate choice for an already-'
  'warm mailbox, not a default.';

-- ---------------------------------------------------------------------------
-- email_domain_checks
--
-- ⚠️ KEYED BY DOMAIN, NOT BY MAILBOX. SPF, DKIM and DMARC are properties of a
-- DOMAIN. Twenty mailboxes on acme.com share one answer, and re-querying DNS
-- per mailbox would be twenty times the lookups for identical results — and
-- would let two mailboxes on the same domain disagree about it.
-- ---------------------------------------------------------------------------

create table if not exists public.email_domain_checks (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  domain         text not null check (domain = lower(domain)),

  spf_status     public.email_check_status not null default 'unknown',
  spf_record     text,
  spf_detail     text,

  dkim_status    public.email_check_status not null default 'unknown',
  -- Which selector actually answered, so the customer can see what we found.
  dkim_selector  text,
  dkim_detail    text,

  dmarc_status   public.email_check_status not null default 'unknown',
  -- none | quarantine | reject, straight from the record.
  dmarc_policy   text,
  dmarc_record   text,
  dmarc_detail   text,

  checked_at     timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists email_domain_checks_workspace_domain_idx
  on public.email_domain_checks (workspace_id, domain);

drop trigger if exists email_domain_checks_set_updated_at on public.email_domain_checks;
create trigger email_domain_checks_set_updated_at
  before update on public.email_domain_checks
  for each row execute function public.set_updated_at();

alter table public.email_domain_checks enable row level security;

drop policy if exists email_domain_checks_select_member on public.email_domain_checks;
create policy email_domain_checks_select_member on public.email_domain_checks
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

revoke all on table public.email_domain_checks from public, anon, authenticated;
grant select on table public.email_domain_checks to authenticated;
grant select, insert, update, delete on table public.email_domain_checks to service_role;

-- ---------------------------------------------------------------------------
-- email_readiness_checks — one row per assessment, kept as history.
--
-- ⚠️ HISTORY, NOT A SNAPSHOT COLUMN. "Was this mailbox healthy last Tuesday,
-- when we sent the campaign that bounced?" is the question people actually
-- ask, and a single overwritten column cannot answer it.
-- ---------------------------------------------------------------------------

create table if not exists public.email_readiness_checks (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  account_id    uuid not null references public.email_accounts(id) on delete cascade,

  state         public.email_account_status not null,
  -- 0-100. Configuration and observed outcomes. NOT inbox placement.
  score         smallint not null check (score between 0 and 100),

  /*
   * The individual findings: [{ id, label, status, weight, detail }].
   * ⚠️ THE SCORE IS NEVER STORED WITHOUT THEM. A number with no explanation is
   * something a customer can neither trust nor act on, and "your score is 62"
   * is a support ticket rather than an answer.
   */
  checks        jsonb not null default '[]'::jsonb,

  -- The observed window the rates were computed from.
  sent_24h      integer not null default 0,
  sent_7d       integer not null default 0,
  bounce_rate   numeric(6,4),
  complaint_rate numeric(6,4),

  -- What the ramp permitted on the day of the check.
  daily_limit   integer,

  checked_at    timestamptz not null default now()
);

create index if not exists email_readiness_checks_account_idx
  on public.email_readiness_checks (account_id, checked_at desc);

create index if not exists email_readiness_checks_workspace_idx
  on public.email_readiness_checks (workspace_id, checked_at desc);

alter table public.email_readiness_checks enable row level security;

drop policy if exists email_readiness_checks_select_member on public.email_readiness_checks;
create policy email_readiness_checks_select_member on public.email_readiness_checks
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

revoke all on table public.email_readiness_checks from public, anon, authenticated;
grant select on table public.email_readiness_checks to authenticated;
grant select, insert, update, delete on table public.email_readiness_checks to service_role;

-- ---------------------------------------------------------------------------
-- email_account_volume — what a mailbox actually sent, for the rate maths.
--
-- ⚠️ COUNTED IN SQL, NOT IN JAVASCRIPT. The same rule as the CRM reporting
-- layer (Ledger D25): a rate assembled from separately fetched pages is a rate
-- computed from whatever happened to be in memory.
-- ---------------------------------------------------------------------------

create or replace function public.email_account_volume(
  p_account_id uuid,
  p_since      timestamptz
)
returns table (
  sent        bigint,
  bounced     bigint,
  complained  bigint,
  failed      bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    count(*) filter (where m.status = 'sent'),
    /*
     * Bounces and complaints are recorded as SUPPRESSIONS, which is where a
     * hard bounce ends up. Counting them from the suppression list rather than
     * from a message column means a bounce discovered days later still counts
     * against the mailbox that caused it.
     */
    count(*) filter (
      where m.status = 'sent'
        and exists (
          select 1 from public.email_suppressions s
           where s.workspace_id = m.workspace_id
             and s.email = m.to_email
             and s.reason = 'hard_bounce'
             and s.created_at >= m.sent_at
        )
    ),
    count(*) filter (
      where m.status = 'sent'
        and exists (
          select 1 from public.email_suppressions s
           where s.workspace_id = m.workspace_id
             and s.email = m.to_email
             and s.reason = 'complaint'
             and s.created_at >= m.sent_at
        )
    ),
    count(*) filter (where m.status = 'failed')
  from public.email_messages m
  where m.account_id = p_account_id
    and coalesce(m.sent_at, m.created_at) >= p_since;
$$;

revoke all on function public.email_account_volume(uuid, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- email_sent_today — the ramp gate's input.
-- ---------------------------------------------------------------------------

create or replace function public.email_sent_today(
  p_account_id uuid,
  p_timezone   text default 'UTC'
)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  /*
   * ⚠️ "TODAY" IS THE MAILBOX'S OWN DAY, not the server's. An account set to
   * America/Los_Angeles would otherwise get its daily allowance reset at 16:00
   * or 17:00 local, mid-afternoon, and send two days' worth into one evening.
   */
  select count(*)
    from public.email_messages m
   where m.account_id = p_account_id
     and m.status = 'sent'
     and (m.sent_at at time zone p_timezone)::date
         = (now() at time zone p_timezone)::date;
$$;

revoke all on function public.email_sent_today(uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- email_domain_health — the per-domain rollup (M5 criterion 5).
--
-- ⚠️ THE WORST MAILBOX SETS THE DOMAIN'S FLOOR. Reputation is shared across a
-- sending domain: one mailbox with a 12% bounce rate damages every other
-- mailbox on that domain. Averaging the scores would hide exactly the mailbox
-- that needs stopping, so the minimum is reported alongside the average.
-- ---------------------------------------------------------------------------

create or replace function public.email_domain_health(p_workspace_id uuid)
returns table (
  domain          text,
  mailboxes       bigint,
  ready           bigint,
  blocked         bigint,
  worst_score     smallint,
  average_score   numeric,
  worst_state     public.email_account_status
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with latest as (
    select distinct on (r.account_id)
           r.account_id, r.state, r.score
      from public.email_readiness_checks r
     where r.workspace_id = p_workspace_id
     order by r.account_id, r.checked_at desc
  )
  select
    a.from_domain,
    count(*),
    count(*) filter (where l.state in ('ready', 'ramping')),
    count(*) filter (where l.state in ('error', 'disconnected', 'authentication_required', 'paused')),
    min(l.score)::smallint,
    round(avg(l.score), 1),
    /*
     * The most severe state on the domain, by the same precedence the
     * TypeScript state machine uses. Ordering an enum by its declaration
     * position would be fragile, so the ranking is explicit.
     */
    (array_agg(l.state order by case l.state
        when 'disconnected'             then 1
        when 'authentication_required'  then 2
        when 'error'                    then 3
        when 'paused'                   then 4
        when 'throttled'                then 5
        when 'warning'                  then 6
        when 'not_configured'           then 7
        when 'ramping'                  then 8
        when 'ready'                    then 9
      end))[1]
  from public.email_accounts a
  join latest l on l.account_id = a.id
  where a.workspace_id = p_workspace_id
    and a.deleted_at is null
  group by a.from_domain
  order by min(l.score);
$$;

revoke all on function public.email_domain_health(uuid)
  from public, anon, authenticated;

comment on function public.email_domain_health(uuid) is
  'Per-domain rollup. Reports the WORST mailbox alongside the average, because '
  'reputation is shared: one bad mailbox damages every other on the domain, '
  'and an average would hide it.';

comment on table public.email_readiness_checks is
  'Assessment history, one row per run. The score describes CONFIGURATION and '
  'OBSERVED OUTCOMES -- never inbox placement, which nobody outside the mailbox '
  'providers can measure.';
