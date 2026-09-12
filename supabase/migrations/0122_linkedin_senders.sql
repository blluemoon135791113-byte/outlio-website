-- ---------------------------------------------------------------------------
-- 0122 — LinkedIn sender identity and the budget that crosses workspaces.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ONE BUDGET PER REAL PERSON, AND NO WORKSPACE MAY SEE ANOTHER'S ACTIVITY. ║
-- ║                                                                           ║
-- ║  §4.10 asks for both, and they pull against each other. A budget shared    ║
-- ║  across every workspace an owner belongs to needs a key that is NOT        ║
-- ║  workspace-scoped — and every other table in this schema is.              ║
-- ║                                                                           ║
-- ║  So `linkedin_senders` is the one table with NO select policy for          ║
-- ║  `authenticated` at all. It is reachable only through the service role and ║
-- ║  through one security-definer function that returns an INTEGER — never a   ║
-- ║  row, never a workspace id, never a contact. §4.10: "Expose only the       ║
-- ║  current workspace's permitted view and an opaque availability result."   ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ BUDGETS ARE DERIVED, NEVER STORED. "No unused-quota carryover or
-- end-of-week catch-up burst" is guaranteed by making it unrepresentable: there
-- is no counter to carry over, no reset job to forget to run, and no drift
-- between a stored number and what actually happened. Every budget is a count
-- over a window of an append-only ledger.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'linkedin_sender_status') then
    /*
     * ⚠️ `limit_reached` IS ABSENT ON PURPOSE. It is a function of the ledger
     * and the clock — true at 16:00 and false at midnight with nothing written
     * — so storing it would need a job to clear it, and a window where a sender
     * is wrongly frozen because that job did not run. It is derived at release
     * time instead. See lib/linkedin/preflight.ts.
     */
    create type public.linkedin_sender_status as enum (
      'unknown',
      'owner_reviewed',
      'warning',
      'paused',
      'restricted',
      'disconnected',
      -- Authorized-provider connections only. Nothing sets this in manual mode;
      -- it exists so the state machine is complete rather than surprising.
      'auth_expired'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'linkedin_action_kind') then
    create type public.linkedin_action_kind as enum (
      'invitation',
      'direct_message',
      'inmail',
      'profile_review',
      'engagement'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'linkedin_action_lifecycle') then
    create type public.linkedin_action_lifecycle as enum (
      'reserved',
      'performed',
      'skipped',
      'expired',
      -- §4.17: an expired action-ready session does not prove "not sent".
      'unknown'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- The sender. Service-role only.
-- ---------------------------------------------------------------------------
create table if not exists public.linkedin_senders (
  id                         uuid primary key default gen_random_uuid(),

  /*
   * ⚠️ GLOBALLY UNIQUE, WHICH IS THE POINT AND ALSO THE ONE DISCLOSURE.
   *
   * `canonicalLinkedInUrl` produces this. It is what makes a budget shared
   * across workspaces possible at all. The same person linking their account
   * into a second workspace is the case §4.10 asks for and adds a LINK row,
   * not a second sender. A DIFFERENT user claiming the same profile is account
   * sharing, which LinkedIn's User Agreement prohibits, and this constraint
   * refuses it — with a deliberately generic error, because a specific one
   * would confirm that a given profile is on Outlio.
   */
  identity_key               text not null unique,

  -- The Outlio user who says "this is my account". Ownership is ATTESTED, never
  -- authenticated: rules 1 and 2 stand, so there is no credential to check.
  owner_user_id              uuid not null references auth.users(id) on delete cascade,
  display_label              text not null,

  status                     public.linkedin_sender_status not null default 'unknown',

  -- Stage 0 releases nothing. §4.10: "release zero proactive actions until the
  -- owner reviews account status".
  stage                      smallint not null default 0 check (stage between 0 and 3),

  /*
   * ⚠️ FIXED, AND CHANGE-CONTROLLED. §4.10: day rollover "cannot be changed
   * repeatedly to refresh quota". Without the cooldown below, moving from
   * Pacific/Auckland to America/Los_Angeles hands the sender a second Monday.
   */
  budget_timezone            text not null default 'UTC'
    check (budget_timezone ~ '^[A-Za-z][A-Za-z0-9+_/-]{1,63}$'),
  budget_timezone_changed_at timestamptz,

  -- "Owner checked at [time]", never a green "safe" badge: manual mode cannot
  -- claim continuous account-health monitoring.
  last_owner_review_at       timestamptz,

  -- §4.10: manual activity outside Outlio, subtracted from every budget.
  external_reserve_per_day   integer not null default 0 check (external_reserve_per_day >= 0),

  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

/*
 * ⚠️ NO SELECT POLICY FOR `authenticated`. This is the deliberate asymmetry:
 * RLS is enabled so nothing is readable by default, and no policy is added, so
 * the table is reachable only by the service role and by the security-definer
 * function below. A policy here would be a global browseable list of customer
 * LinkedIn accounts, which §4.10 forbids by name.
 */
alter table public.linkedin_senders enable row level security;
revoke all on table public.linkedin_senders from public, anon, authenticated;
grant select, insert, update, delete on table public.linkedin_senders to service_role;

-- ---------------------------------------------------------------------------
-- Which workspaces may use a sender. Ordinary workspace-scoped RLS.
-- ---------------------------------------------------------------------------
create table if not exists public.linkedin_sender_links (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  sender_id         uuid not null references public.linkedin_senders(id) on delete cascade,
  linked_by_user_id uuid references auth.users(id) on delete set null,
  permitted_kinds   public.linkedin_action_kind[] not null default
                      '{invitation,direct_message,profile_review}',
  created_at        timestamptz not null default now(),
  unique (workspace_id, sender_id)
);

alter table public.linkedin_sender_links enable row level security;

drop policy if exists linkedin_sender_links_select_member on public.linkedin_sender_links;
create policy linkedin_sender_links_select_member
  on public.linkedin_sender_links
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

revoke all on table public.linkedin_sender_links from public, anon, authenticated;
grant select on table public.linkedin_sender_links to authenticated;
grant select, insert, update, delete on table public.linkedin_sender_links to service_role;

-- ---------------------------------------------------------------------------
-- The ledger. Append-only in spirit; every budget is a count over it.
-- ---------------------------------------------------------------------------
create table if not exists public.linkedin_sender_actions (
  id                uuid primary key default gen_random_uuid(),
  sender_id         uuid not null references public.linkedin_senders(id) on delete cascade,
  -- Carried for attribution and for the per-workspace RLS view below. The
  -- BUDGET deliberately ignores it.
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  contact_id        uuid references public.crm_contacts(id) on delete set null,

  kind              public.linkedin_action_kind not null,
  lifecycle         public.linkedin_action_lifecycle not null default 'reserved',

  /*
   * §4.17's stable key: workspace + enrollment + published node + a bounded
   * occurrence, and DELIBERATELY EXCLUDING the attempt number — the brief calls
   * including it out as a defect, because a retry would then be a new logical
   * action and could duplicate a real external effect.
   */
  logical_action_id text not null unique,

  reserved_at       timestamptz not null default now(),
  -- When the owner says it actually happened. Never the task-created time.
  occurred_at       timestamptz,
  resolved_at       timestamptz,
  resolution_note   text
);

/*
 * The budget scan: one sender, one kind, recent first. `lifecycle` is in the
 * index because the count excludes only two of the five values.
 */
create index if not exists linkedin_sender_actions_budget_idx
  on public.linkedin_sender_actions (sender_id, kind, reserved_at desc)
  include (lifecycle);

create index if not exists linkedin_sender_actions_workspace_idx
  on public.linkedin_sender_actions (workspace_id, reserved_at desc);

alter table public.linkedin_sender_actions enable row level security;

/*
 * ⚠️ A MEMBER SEES ONLY THEIR OWN WORKSPACE'S SLICE. The budget spans every
 * workspace; the ROWS never do. That split is the whole tenancy design.
 */
drop policy if exists linkedin_sender_actions_select_member on public.linkedin_sender_actions;
create policy linkedin_sender_actions_select_member
  on public.linkedin_sender_actions
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

revoke all on table public.linkedin_sender_actions from public, anon, authenticated;
grant select on table public.linkedin_sender_actions to authenticated;
grant select, insert, update, delete on table public.linkedin_sender_actions to service_role;

-- ---------------------------------------------------------------------------
-- The only number that crosses the tenancy boundary.
-- ---------------------------------------------------------------------------
create or replace function public.linkedin_sender_used(
  p_sender_id uuid,
  p_kind      public.linkedin_action_kind,
  p_window    interval
)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_used integer;
begin
  /*
   * ⚠️ MEMBERSHIP IS CHECKED BEFORE ANYTHING IS COUNTED, or this function
   * becomes a probe: anybody could ask about any sender id and learn how busy
   * a stranger's account is.
   */
  if not exists (
    select 1
      from public.linkedin_sender_links l
     where l.sender_id = p_sender_id
       and public.is_workspace_member(l.workspace_id)
  ) and not public.is_admin() then
    raise exception 'sender not available'
      using errcode = 'insufficient_privilege';
  end if;

  /*
   * ⚠️ COUNTS EVERY WORKSPACE, WHICH IS THE ENTIRE POINT. The caller sees a
   * number that includes activity they cannot see rows for.
   *
   * ⚠️ AND `unknown` COUNTS. §4.17 requires the reservation retained
   * conservatively: an action we cannot rule out having happened has to keep
   * holding its slot, because the cost of being wrong is a restriction on
   * somebody's real account. Only a definite non-action — skipped or expired —
   * gives the slot back.
   */
  select count(*)
    into v_used
    from public.linkedin_sender_actions a
   where a.sender_id = p_sender_id
     and a.kind = p_kind
     and a.lifecycle in ('reserved', 'performed', 'unknown')
     and a.reserved_at > now() - p_window;

  return coalesce(v_used, 0);
end;
$$;

revoke all on function public.linkedin_sender_used(uuid, public.linkedin_action_kind, interval)
  from public, anon;
grant execute on function public.linkedin_sender_used(uuid, public.linkedin_action_kind, interval)
  to authenticated, service_role;

comment on table public.linkedin_senders is
  'One row per real LinkedIn account. Service-role only: no authenticated '
  'select policy, by design. §4.10 forbids a global browseable list (0122).';

comment on function public.linkedin_sender_used(uuid, public.linkedin_action_kind, interval) is
  'Actions counted across EVERY workspace this sender is linked to. Returns a '
  'scalar, never rows — §4.10 opaque availability result (0122).';
