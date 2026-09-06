-- 0070 — workspaces, memberships, invitations, feature flags
--
-- Outlio was single-user: every tenant-scoped table carries `user_id` and every
-- policy reads `auth.uid() = user_id`. That model cannot express "my colleague
-- works my leads", which the whole GTM platform depends on.
--
-- This migration introduces the tenancy backbone WITHOUT touching a single
-- existing table. Nothing about today's Lead Engine behaviour changes on
-- deploy: every existing user simply gains a personal workspace they own.
-- Moving Lead Engine rows under a workspace is a separate, later decision
-- (Ledger Q4/DR5) taken when CRM ingestion defines the boundary.
--
-- TWO ROLE AXES, NEVER MERGED (Ledger D4):
--   profiles.role              — may this person use Outlio at all?
--   workspace_memberships.role — what may they do inside this workspace?

-- ---------------------------------------------------------------------------
-- Roles
--
-- Ordered most to least privileged. The ORDER IS LOAD-BEARING: it is mirrored
-- by RANK in lib/workspaces/permissions.ts, and a role may only act on a role
-- strictly below its own rank.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'workspace_role') then
    create type public.workspace_role as enum (
      'owner',    -- billing, deletion, ownership transfer. Exactly one minimum.
      'admin',    -- everything except billing and workspace deletion
      'manager',  -- team data, reports, flows, campaigns. No settings/billing.
      'setter',   -- ONLY records assigned to them. No exports, no admin.
      'viewer'    -- read-only, assigned scope
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------

create table if not exists public.workspaces (
  id                    uuid primary key default gen_random_uuid(),
  owner_user_id         uuid not null references auth.users(id) on delete cascade,
  name                  text not null check (length(trim(name)) between 1 and 120),

  -- Platform-managed seat override. NULL means "use the owner's plan limit"
  -- (plans.limits.workspace_member_limit). Present so support can widen a
  -- single account without inventing a plan tier. Owners cannot set it —
  -- see protect_workspace_columns().
  member_limit_override integer check (member_limit_override is null
                                       or member_limit_override > 0),

  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create index if not exists workspaces_owner_idx
  on public.workspaces (owner_user_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- workspace_memberships
-- ---------------------------------------------------------------------------

create table if not exists public.workspace_memberships (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         public.workspace_role not null default 'setter',
  invited_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (workspace_id, user_id)
);

drop trigger if exists workspace_memberships_set_updated_at on public.workspace_memberships;
create trigger workspace_memberships_set_updated_at
  before update on public.workspace_memberships
  for each row execute function public.set_updated_at();

create index if not exists workspace_memberships_user_idx
  on public.workspace_memberships (user_id, workspace_id);
create index if not exists workspace_memberships_workspace_role_idx
  on public.workspace_memberships (workspace_id, role);

-- ---------------------------------------------------------------------------
-- workspace_invitations
--
-- DISTINCT FROM invitation_codes (Ledger D6). `invitation_codes` grants an
-- ENTITLEMENT to a stranger who types a code. This invites a NAMED PERSON to a
-- workspace with a role. Conflating them would let a team invite mint a plan.
--
-- The raw token is NEVER stored — only its SHA-256. A database leak therefore
-- yields no usable invitation link, exactly as with a password hash.
-- ---------------------------------------------------------------------------

create table if not exists public.workspace_invitations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email        text not null check (position('@' in email) > 1),
  role         public.workspace_role not null,
  token_hash   text not null unique,
  invited_by   uuid references auth.users(id) on delete set null,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),

  -- Ownership is transferred deliberately, never handed out by email.
  constraint workspace_invitations_role_not_owner check (role <> 'owner'),
  -- Email is stored already-normalised so the uniqueness of an outstanding
  -- invite cannot be defeated by casing.
  constraint workspace_invitations_email_lowercase check (email = lower(email))
);

-- At most one OUTSTANDING invitation per (workspace, email). Accepted, revoked
-- and expired rows are retained as history and excluded from the constraint.
create unique index if not exists workspace_invitations_pending_uniq
  on public.workspace_invitations (workspace_id, email)
  where accepted_at is null and revoked_at is null;

create index if not exists workspace_invitations_workspace_idx
  on public.workspace_invitations (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- workspace_feature_flags
--
-- A3: "ALL NEW MODULES SHIP BEHIND WORKSPACE-LEVEL FEATURE FLAGS."
--
-- A flag can only ever RESTRICT. The effective answer is
-- `plan entitlement AND flag`, resolved in lib/workspaces/entitlements.ts — a
-- flag can never grant a module the plan does not include.
-- ---------------------------------------------------------------------------

create table if not exists public.workspace_feature_flags (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  flag         text not null check (flag ~ '^[a-z][a-z0-9_.]{1,63}$'),
  enabled      boolean not null default false,
  updated_at   timestamptz not null default now(),

  primary key (workspace_id, flag)
);

drop trigger if exists workspace_feature_flags_set_updated_at on public.workspace_feature_flags;
create trigger workspace_feature_flags_set_updated_at
  before update on public.workspace_feature_flags
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Membership lookup helpers.
--
-- SECURITY DEFINER IS MANDATORY HERE, NOT A SHORTCUT.
--
-- A policy on workspace_memberships that itself queries workspace_memberships
-- re-enters the same policy and Postgres raises "infinite recursion detected in
-- policy". A definer function runs with RLS bypassed for that lookup only, so
-- the recursion never forms. Both functions read auth.uid() and can therefore
-- only ever answer about the CALLER.
-- ---------------------------------------------------------------------------

create or replace function public.workspace_role_of(p_workspace_id uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role
    from public.workspace_memberships m
    join public.workspaces w on w.id = m.workspace_id
   where m.workspace_id = p_workspace_id
     and m.user_id = auth.uid()
     and w.deleted_at is null
   limit 1;
$$;

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.workspace_role_of(p_workspace_id) is not null;
$$;

revoke all on function public.workspace_role_of(uuid) from public, anon;
revoke all on function public.is_workspace_member(uuid) from public, anon;
grant execute on function public.workspace_role_of(uuid) to authenticated, service_role;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- PRIVILEGE ESCALATION GUARD
--
-- Same reasoning as protect_profile_columns() in 0003: a policy can say "this
-- row is writable", it cannot say "this row is writable EXCEPT these columns".
-- Seats are what the customer pays for, so an owner must not be able to raise
-- their own seat ceiling with a crafted update.
-- ---------------------------------------------------------------------------

create or replace function public.protect_workspace_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- auth.uid() is null for the service role and the worker; allow those.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  new.id                    := old.id;
  new.owner_user_id         := old.owner_user_id;
  new.member_limit_override := old.member_limit_override;
  new.created_at            := old.created_at;

  return new;
end;
$$;

drop trigger if exists workspaces_protect_columns on public.workspaces;
create trigger workspaces_protect_columns
  before update on public.workspaces
  for each row execute function public.protect_workspace_columns();

-- ---------------------------------------------------------------------------
-- LAST-OWNER PROTECTION
--
-- A workspace with no owner is unrecoverable: nobody can pay for it, invite to
-- it, or delete it. Enforced by trigger rather than in application code because
-- the service role bypasses RLS and every future admin script would otherwise
-- have to remember this rule.
-- ---------------------------------------------------------------------------

create or replace function public.guard_last_workspace_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace uuid := old.workspace_id;
  v_owners    integer;
begin
  -- Only demotions and deletions of an OWNER can strand a workspace.
  if tg_op = 'UPDATE' then
    if old.role <> 'owner' or new.role = 'owner' then
      return new;
    end if;
  else
    if old.role <> 'owner' then
      return old;
    end if;

    -- CASCADE ESCAPE HATCH.
    --
    -- Deleting a workspace, or erasing a user under GDPR, cascades into this
    -- table. The parent row is already gone by the time the child delete runs,
    -- so its absence is how we distinguish "the workspace is being destroyed"
    -- from "somebody is removing the last owner". Without this, a workspace
    -- could never be hard-deleted and erasure would fail.
    if not exists (select 1 from public.workspaces where id = old.workspace_id)
       or not exists (select 1 from auth.users where id = old.user_id) then
      return old;
    end if;
  end if;

  -- Excludes this row: it is the one being removed or demoted.
  select count(*) into v_owners
    from public.workspace_memberships
   where workspace_id = v_workspace
     and role = 'owner'
     and id <> old.id;

  if v_owners = 0 then
    raise exception
      'Workspace % must keep at least one owner; promote another member first',
      v_workspace
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    return new;
  end if;
  return old;
end;
$$;

drop trigger if exists workspace_memberships_guard_owner on public.workspace_memberships;
create trigger workspace_memberships_guard_owner
  before update or delete on public.workspace_memberships
  for each row execute function public.guard_last_workspace_owner();

-- ---------------------------------------------------------------------------
-- redeem_workspace_invitation
--
-- ATOMICITY IS THE WHOLE POINT, exactly as with redeem_invitation_code (0010).
--
-- The row is claimed with SELECT ... FOR UPDATE, so two people clicking the
-- same link concurrently serialise on it and only one observes it unaccepted.
-- The seat count is re-taken INSIDE that lock, so a workspace cannot be pushed
-- over its limit by simultaneous acceptances.
--
-- p_member_limit is supplied by the caller (NULL = unlimited) rather than read
-- here, because the allowance lives in plans.limits JSONB and CLAUDE.md forbids
-- a second place that knows plan shapes. The COUNT still happens inside this
-- transaction, so passing the limit in costs nothing in correctness.
--
-- Returns a status string instead of raising, so the caller maps it to user
-- copy without parsing exception text.
-- ---------------------------------------------------------------------------

create or replace function public.redeem_workspace_invitation(
  p_token_hash   text,
  p_user_id      uuid,
  p_member_limit integer default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite     public.workspace_invitations%rowtype;
  v_user_email text;
  v_seats      integer;
begin
  select * into v_invite
    from public.workspace_invitations
   where token_hash = p_token_hash
   for update;

  -- A token that does not exist and a token that is spent are reported the
  -- same way to the caller. The distinction is for logs, not for an attacker
  -- probing which links were once valid.
  if v_invite.id is null then
    return 'invalid';
  end if;

  if v_invite.accepted_at is not null
     or v_invite.revoked_at is not null
     or v_invite.expires_at <= now() then
    return 'unavailable';
  end if;

  select lower(email) into v_user_email from auth.users where id = p_user_id;
  if v_user_email is null then
    return 'invalid';
  end if;

  -- An invitation is addressed to a PERSON. Without this check a forwarded
  -- link would let anyone holding it join, which is precisely the failure mode
  -- hashing the token was meant to prevent.
  if v_user_email <> v_invite.email then
    return 'wrong_email';
  end if;

  -- Idempotent: re-clicking a link after joining must not error, and must not
  -- silently change an existing member's role.
  if exists (
    select 1 from public.workspace_memberships
     where workspace_id = v_invite.workspace_id and user_id = p_user_id
  ) then
    update public.workspace_invitations
       set accepted_at = now(), accepted_by = p_user_id
     where id = v_invite.id;
    return 'already_member';
  end if;

  if p_member_limit is not null then
    select count(*) into v_seats
      from public.workspace_memberships
     where workspace_id = v_invite.workspace_id;

    if v_seats >= p_member_limit then
      return 'seat_limit';
    end if;
  end if;

  insert into public.workspace_memberships (workspace_id, user_id, role, invited_by)
  values (v_invite.workspace_id, p_user_id, v_invite.role, v_invite.invited_by);

  update public.workspace_invitations
     set accepted_at = now(), accepted_by = p_user_id
   where id = v_invite.id;

  return 'ok';
end;
$$;

revoke all on function public.redeem_workspace_invitation(text, uuid, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
--
-- Reads are scoped to members. Writes go through the service role behind the
-- policy layer in lib/workspaces/permissions.ts, following the precedent set
-- by every other table here (e.g. account_list_entries in 0067). RLS is the
-- backstop; it is not the authorization model. CLAUDE.md: "Authorization is
-- server-side."
-- ---------------------------------------------------------------------------

alter table public.workspaces             enable row level security;
alter table public.workspace_memberships  enable row level security;
alter table public.workspace_invitations  enable row level security;
alter table public.workspace_feature_flags enable row level security;

drop policy if exists workspaces_select_member on public.workspaces;
create policy workspaces_select_member on public.workspaces
  for select to authenticated
  using (public.is_workspace_member(id) or public.is_admin());

-- Renaming is the only field an owner/admin may change directly; every
-- privileged column is frozen by protect_workspace_columns() above.
drop policy if exists workspaces_update_admin on public.workspaces;
create policy workspaces_update_admin on public.workspaces
  for update to authenticated
  using (public.workspace_role_of(id) in ('owner','admin') or public.is_admin())
  with check (public.workspace_role_of(id) in ('owner','admin') or public.is_admin());

drop policy if exists workspace_memberships_select_member on public.workspace_memberships;
create policy workspace_memberships_select_member on public.workspace_memberships
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

-- Invitations expose an email address, so they are visible only to the roles
-- that can act on them. A setter must not be able to enumerate who was invited.
drop policy if exists workspace_invitations_select_admin on public.workspace_invitations;
create policy workspace_invitations_select_admin on public.workspace_invitations
  for select to authenticated
  using (public.workspace_role_of(workspace_id) in ('owner','admin') or public.is_admin());

drop policy if exists workspace_feature_flags_select_member on public.workspace_feature_flags;
create policy workspace_feature_flags_select_member on public.workspace_feature_flags
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

revoke all on table public.workspaces             from public, anon, authenticated;
revoke all on table public.workspace_memberships  from public, anon, authenticated;
revoke all on table public.workspace_invitations  from public, anon, authenticated;
revoke all on table public.workspace_feature_flags from public, anon, authenticated;

grant select on table public.workspaces             to authenticated;
grant update (name) on table public.workspaces      to authenticated;
grant select on table public.workspace_memberships  to authenticated;
grant select on table public.workspace_invitations  to authenticated;
grant select on table public.workspace_feature_flags to authenticated;

grant select, insert, update, delete on table public.workspaces             to service_role;
grant select, insert, update, delete on table public.workspace_memberships  to service_role;
grant select, insert, update, delete on table public.workspace_invitations  to service_role;
grant select, insert, update, delete on table public.workspace_feature_flags to service_role;

-- ---------------------------------------------------------------------------
-- Every new signup gets a workspace.
--
-- Folded into the EXISTING handle_new_user() trigger rather than added as a
-- second trigger on auth.users, so profile and workspace are created in one
-- transaction. A user who somehow ended up without a workspace would hit a
-- dead end on every product surface.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  -- left(…, 100) keeps the name inside the 120-character check constraint no
  -- matter how long the local part is. A failure here would fail the signup.
  insert into public.workspaces (owner_user_id, name)
  values (
    new.id,
    left(
      coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'My'),
      100
    ) || '''s workspace'
  )
  returning id into v_workspace;

  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (v_workspace, new.id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- BACKFILL (Ledger D7)
--
-- Every existing profile gets exactly one personal workspace it owns.
-- Idempotent: the NOT EXISTS guard means re-running is a no-op, so this is
-- safe to replay against an environment that already took the migration.
-- ---------------------------------------------------------------------------

with created as (
  insert into public.workspaces (owner_user_id, name)
  select
    p.id,
    left(
      coalesce(
        nullif(trim(p.company_name), ''),
        nullif(trim(p.full_name), '') || '''s workspace',
        nullif(split_part(coalesce(p.email, ''), '@', 1), '') || '''s workspace',
        'My workspace'
      ),
      120
    )
  from public.profiles p
  where p.deleted_at is null
    and not exists (
      select 1 from public.workspace_memberships m where m.user_id = p.id
    )
  returning id, owner_user_id
)
insert into public.workspace_memberships (workspace_id, user_id, role)
select c.id, c.owner_user_id, 'owner' from created c
on conflict (workspace_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Documentation
-- ---------------------------------------------------------------------------

comment on table public.workspaces is
  'A tenant. Every platform module (CRM, email, flows, reports) is scoped to '
  'one of these. Lead Engine tables remain user-scoped until Ledger DR5.';

comment on table public.workspace_memberships is
  'A person''s role INSIDE a workspace. Orthogonal to profiles.role, which '
  'governs platform access and billing (Ledger D4).';

comment on table public.workspace_invitations is
  'Invites a named person to a workspace with a role. Distinct from '
  'invitation_codes, which grants a plan entitlement (Ledger D6). Only the '
  'SHA-256 of the token is stored.';

comment on table public.workspace_feature_flags is
  'Per-workspace module kill switch. Can only restrict: the effective answer '
  'is plan entitlement AND flag.';
