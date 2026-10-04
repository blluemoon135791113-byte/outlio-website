-- ---------------------------------------------------------------------------
-- 0147 — Account workspace, step 4 of 6: who is working an account, and since when
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ONE OWNERSHIP MODEL, NOT TWO.                                            ║
-- ║                                                                           ║
-- ║  `crm_companies.owner_user_id` already means "the person working this     ║
-- ║  account": dataScope filters on it, member handover (0129) moves it, and  ║
-- ║  the company_owner routing rule (0127) routes leads by it. A separate     ║
-- ║  assignee column would make those three disagree with the Accounts page.  ║
-- ║                                                                           ║
-- ║  So `crm_company_assignments` is the HISTORY and the multi-assignee list, ║
-- ║  and owner_user_id stays the current PRIMARY assignee — a projection of   ║
-- ║  it, exactly as crm_contacts.primary_company_id projects                  ║
-- ║  crm_contact_company_relationships.                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- KEEPING THEM IN STEP, WHOEVER WRITES:
--
--   crm_assign_company / crm_unassign_company   the account workspace's path:
--                                               lock, history, owner, activity
--                                               in one transaction.
--   any other write of owner_user_id            ingestion setting an owner on
--   (trigger on crm_companies)                  insert, member handover, a user
--                                               being deleted. The trigger
--                                               opens/closes history to match,
--                                               so no existing caller has to
--                                               change — and none can forget.
--   a member leaving (trigger on memberships)   closes the secondary assignments
--                                               handover does not know about.
--
-- AUTO-MOVE New → Assigned happens in a BEFORE trigger on the owner column, so
-- it applies on every path above and only while the status is still New; an
-- account left with nobody moves back from Assigned to New the same way.
--
-- ⚠️ ONE ACTIVE ASSIGNEE unless crm_account_settings.allow_multiple_assignees.
-- Enforced by trigger on insert, under the company row lock every writer
-- takes, and the setting cannot be switched back off while any account still
-- has more than one.
--
-- ⚠️ VALIDATE BEFORE APPLYING. `alter type ... add value` cannot run inside the
-- rollback-only rehearsal; use the throwaway cluster:
--   scripts/check-migration.sh supabase/migrations/0147_crm_account_assignment.sql \
--     supabase/migrations/smoke/0147_crm_account_assignment.smoke.sql
--
-- ROLLBACK — roll back 0149 → 0144 strictly in reverse order; this file's
-- triggers write crm_companies.status_id, which 0145's rollback removes.
--   drop trigger if exists workspace_memberships_release_accounts on public.workspace_memberships;
--   drop trigger if exists crm_companies_sync_assignment on public.crm_companies;
--   drop trigger if exists crm_companies_status_on_assign on public.crm_companies;
--   drop trigger if exists crm_account_settings_guard_multiple on public.crm_account_settings;
--   drop table if exists public.crm_company_assignments;   -- takes its guard trigger with it
--   drop function if exists public.crm_release_member_accounts(), public.crm_companies_sync_assignment(),
--     public.crm_companies_status_on_assign(), public.crm_guard_disable_multiple(),
--     public.crm_unassign_company(uuid, uuid, uuid, uuid),
--     public.crm_assign_company(uuid, uuid, uuid, uuid, text),
--     public.crm_account_status_id(uuid, text), public.crm_allow_multiple_assignees(uuid),
--     public.crm_guard_company_assignment();
--   ⚠️ The four crm_activity_type values cannot be dropped; unused, they are harmless.
--
-- ⚠️ KNOWN LIMITS, accepted:
--   • crm_company_assignments.user_id cascades on auth user deletion, so a
--     deleted user's assignment history goes with them. A user with any CRM
--     activity cannot be deleted anyway (crm_activities.actor_user_id has no
--     ON DELETE action), so this only reaches people who never worked a lead.
--   • In multi-assignee mode, promoting a secondary by writing owner_user_id
--     directly keeps the old primary as an assignee. Only crm_assign_company
--     (replace) removes people; an owner write is not a removal.
-- ---------------------------------------------------------------------------

/*
 * Used only inside function bodies, which are not resolved until first call,
 * so this is safe even where the whole script runs as one transaction.
 * STATUS_CHANGED and TAGS_CHANGED are written by the account service (build
 * step 2); declared now so it adds no value to a live enum.
 */
alter type public.crm_activity_type add value if not exists 'ACCOUNT_ASSIGNED';
alter type public.crm_activity_type add value if not exists 'ACCOUNT_UNASSIGNED';
alter type public.crm_activity_type add value if not exists 'ACCOUNT_STATUS_CHANGED';
alter type public.crm_activity_type add value if not exists 'ACCOUNT_TAGS_CHANGED';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.crm_allow_multiple_assignees(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select s.allow_multiple_assignees
       from public.crm_account_settings s
      where s.workspace_id = p_workspace_id),
    false
  )
$$;

create or replace function public.crm_account_status_id(p_workspace_id uuid, p_system_key text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id
    from public.crm_account_statuses s
   where s.workspace_id = p_workspace_id
     and s.system_key = p_system_key
$$;

-- ---------------------------------------------------------------------------
-- crm_company_assignments
-- ---------------------------------------------------------------------------

create table if not exists public.crm_company_assignments (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  company_id     uuid not null,
  user_id        uuid not null references auth.users(id) on delete cascade,
  assigned_by    uuid references auth.users(id) on delete set null,
  assigned_at    timestamptz not null default now(),
  unassigned_at  timestamptz,
  unassigned_by  uuid references auth.users(id) on delete set null,
  end_reason     text check (
    end_reason is null
    or end_reason in ('reassigned', 'unassigned', 'member_removed')
  ),

  constraint crm_company_assignments_end_consistent
    check ((unassigned_at is null) = (end_reason is null)),
  constraint crm_company_assignments_dates
    check (unassigned_at is null or unassigned_at >= assigned_at),
  constraint crm_company_assignments_company_fk
    foreign key (company_id, workspace_id)
    references public.crm_companies (id, workspace_id)
    on delete cascade
);

-- A person holds an account at most once at a time.
create unique index if not exists crm_company_assignments_open_uniq
  on public.crm_company_assignments (company_id, user_id)
  where unassigned_at is null;

-- "My Accounts".
create index if not exists crm_company_assignments_user_open_idx
  on public.crm_company_assignments (workspace_id, user_id, company_id)
  where unassigned_at is null;

-- An account's history, newest first.
create index if not exists crm_company_assignments_company_idx
  on public.crm_company_assignments (workspace_id, company_id, assigned_at desc);

/*
 * History is immutable except for closing an open row once, and for the
 * ON DELETE SET NULL on the two actor columns when a user is deleted.
 */
create or replace function public.crm_guard_company_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.unassigned_at is null
       and not public.crm_allow_multiple_assignees(new.workspace_id)
       and exists (
         select 1 from public.crm_company_assignments a
          where a.company_id = new.company_id
            and a.unassigned_at is null
            and a.user_id <> new.user_id
       ) then
      raise exception 'account % already has an active assignee; reassign it instead', new.company_id
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.id <> old.id
     or new.workspace_id <> old.workspace_id
     or new.company_id <> old.company_id
     or new.user_id <> old.user_id
     or new.assigned_at <> old.assigned_at
     or (old.unassigned_at is not null and (
           new.unassigned_at is distinct from old.unassigned_at
           or new.end_reason is distinct from old.end_reason))
     or (new.assigned_by is not null and new.assigned_by is distinct from old.assigned_by)
     or (old.unassigned_at is not null
         and new.unassigned_by is not null
         and new.unassigned_by is distinct from old.unassigned_by) then
    raise exception 'crm_company_assignments history is immutable; only an open row may be closed'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists crm_company_assignments_guard on public.crm_company_assignments;
create trigger crm_company_assignments_guard
  before insert or update on public.crm_company_assignments
  for each row execute function public.crm_guard_company_assignment();

-- ---------------------------------------------------------------------------
-- The setting cannot be switched off under accounts that still use it
-- ---------------------------------------------------------------------------

create or replace function public.crm_guard_disable_multiple()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not new.allow_multiple_assignees
     and (tg_op = 'INSERT' or old.allow_multiple_assignees)
     and exists (
       select 1
         from public.crm_company_assignments a
        where a.workspace_id = new.workspace_id
          and a.unassigned_at is null
        group by a.company_id
       having count(a.id) > 1
     ) then
    raise exception 'some accounts still have more than one assignee; reduce them to one first'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists crm_account_settings_guard_multiple on public.crm_account_settings;
create trigger crm_account_settings_guard_multiple
  before insert or update of allow_multiple_assignees on public.crm_account_settings
  for each row execute function public.crm_guard_disable_multiple();

-- ---------------------------------------------------------------------------
-- Status default and the New → Assigned auto-move
-- ---------------------------------------------------------------------------

create or replace function public.crm_companies_status_on_assign()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status_id is null then
      new.status_id := public.crm_account_status_id(
        new.workspace_id,
        case when new.owner_user_id is null then 'new' else 'assigned' end
      );
    end if;
    return new;
  end if;

  -- Only while still New: a status somebody chose is never overwritten.
  if new.owner_user_id is not null
     and old.owner_user_id is distinct from new.owner_user_id
     and new.status_id is not distinct from public.crm_account_status_id(new.workspace_id, 'new') then
    new.status_id := coalesce(
      public.crm_account_status_id(new.workspace_id, 'assigned'),
      new.status_id
    );
  end if;

  /*
   * The mirror image: an account that loses its last assignee while still
   * merely "Assigned" goes back to New, so the New filter is the unworked
   * queue. A status somebody chose (Researching, Meeting, ...) is kept.
   */
  if new.owner_user_id is null
     and old.owner_user_id is not null
     and new.status_id is not distinct from public.crm_account_status_id(new.workspace_id, 'assigned') then
    new.status_id := coalesce(
      public.crm_account_status_id(new.workspace_id, 'new'),
      new.status_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists crm_companies_status_on_assign on public.crm_companies;
create trigger crm_companies_status_on_assign
  before insert or update of owner_user_id on public.crm_companies
  for each row execute function public.crm_companies_status_on_assign();

-- ---------------------------------------------------------------------------
-- History follows owner_user_id, whoever wrote it
--
-- A no-op when the new owner already holds an open assignment — which is
-- always the case on the crm_assign_company path, because that function writes
-- the history first. So the activity below is written ONLY for owner changes
-- made elsewhere, and never twice.
-- ---------------------------------------------------------------------------

create or replace function public.crm_companies_sync_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.owner_user_id is not null then
      insert into public.crm_company_assignments
        (workspace_id, company_id, user_id, assigned_by, assigned_at)
      values
        (new.workspace_id, new.id, new.owner_user_id, new.created_by, least(new.created_at, now()));
    end if;
    return null;
  end if;

  if new.owner_user_id is not distinct from old.owner_user_id then
    return null;
  end if;

  if new.owner_user_id is null then
    update public.crm_company_assignments
       set unassigned_at = now(), end_reason = 'unassigned'
     where company_id = new.id
       and workspace_id = new.workspace_id
       and unassigned_at is null;
    return null;
  end if;

  if exists (
    select 1 from public.crm_company_assignments
     where company_id = new.id
       and user_id = new.owner_user_id
       and unassigned_at is null
  ) then
    return null;
  end if;

  update public.crm_company_assignments
     set unassigned_at = now(), end_reason = 'reassigned'
   where company_id = new.id
     and workspace_id = new.workspace_id
     and unassigned_at is null
     and (
       not public.crm_allow_multiple_assignees(new.workspace_id)
       or user_id = old.owner_user_id
     );

  insert into public.crm_company_assignments (workspace_id, company_id, user_id)
  values (new.workspace_id, new.id, new.owner_user_id);

  -- A deleted account has no timeline to write to, as for contacts in 0129.
  if new.deleted_at is null then
    insert into public.crm_activities (
      workspace_id, company_id, activity_type, channel,
      actor_user_id, owner_user_id_at_event, metadata
    )
    values (
      new.workspace_id, new.id, 'ACCOUNT_ASSIGNED', 'system',
      null, old.owner_user_id,
      jsonb_build_object('from', old.owner_user_id, 'to', new.owner_user_id, 'reason', 'owner_changed')
    );
  end if;

  return null;
end;
$$;

drop trigger if exists crm_companies_sync_assignment on public.crm_companies;
create trigger crm_companies_sync_assignment
  after insert or update of owner_user_id on public.crm_companies
  for each row execute function public.crm_companies_sync_assignment();

-- ---------------------------------------------------------------------------
-- crm_assign_company
--
-- p_mode 'replace' (default): p_user_id becomes the only assignee; everyone
--   else's row is closed as 'reassigned'.
-- p_mode 'add': p_user_id joins the current assignees. Refused unless the
--   workspace allows multiple assignees.
--
-- Returns {changed, from, to, activity_id}. `changed` is false, and nothing is
-- written, when the request describes what is already true.
-- ---------------------------------------------------------------------------

create or replace function public.crm_assign_company(
  p_workspace_id uuid,
  p_company_id   uuid,
  p_user_id      uuid,
  p_actor_id     uuid default null,
  p_mode         text default 'replace'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company     public.crm_companies%rowtype;
  v_has_open    boolean;
  v_others      integer;
  v_activity_id uuid;
begin
  if p_mode not in ('replace', 'add') then
    raise exception 'crm_assign_company: unknown mode %', p_mode
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_company
    from public.crm_companies
   where id = p_company_id
     and workspace_id = p_workspace_id
     and deleted_at is null
   for update;
  if v_company.id is null then
    raise exception 'crm_assign_company: no such account in workspace %', p_workspace_id
      using errcode = 'no_data_found';
  end if;

  if not exists (
    select 1 from public.workspace_memberships
     where workspace_id = p_workspace_id and user_id = p_user_id
  ) then
    raise exception 'crm_assign_company: the assignee is not in this workspace'
      using errcode = 'check_violation';
  end if;

  if p_mode = 'add' and not public.crm_allow_multiple_assignees(p_workspace_id) then
    raise exception 'crm_assign_company: this workspace allows one assignee per account'
      using errcode = 'check_violation';
  end if;

  select exists (
    select 1 from public.crm_company_assignments
     where company_id = p_company_id and user_id = p_user_id and unassigned_at is null
  ) into v_has_open;

  select count(id) into v_others
    from public.crm_company_assignments
   where company_id = p_company_id and user_id <> p_user_id and unassigned_at is null;

  if v_has_open
     and (p_mode = 'add' or v_others = 0)
     and (p_mode = 'add' or v_company.owner_user_id is not distinct from p_user_id) then
    return jsonb_build_object(
      'changed', false, 'from', v_company.owner_user_id,
      'to', v_company.owner_user_id, 'activity_id', null
    );
  end if;

  if p_mode = 'replace' then
    update public.crm_company_assignments
       set unassigned_at = now(), unassigned_by = p_actor_id, end_reason = 'reassigned'
     where company_id = p_company_id
       and workspace_id = p_workspace_id
       and user_id <> p_user_id
       and unassigned_at is null;
  end if;

  if not v_has_open then
    insert into public.crm_company_assignments
      (workspace_id, company_id, user_id, assigned_by)
    values
      (p_workspace_id, p_company_id, p_user_id, p_actor_id);
  end if;

  -- The open row exists before the owner moves, so the sync trigger is a no-op.
  if p_mode = 'replace' or v_company.owner_user_id is null then
    update public.crm_companies
       set owner_user_id = p_user_id
     where id = p_company_id
       and workspace_id = p_workspace_id;
  end if;

  insert into public.crm_activities (
    workspace_id, company_id, activity_type, channel,
    actor_user_id, owner_user_id_at_event, metadata
  )
  values (
    p_workspace_id, p_company_id, 'ACCOUNT_ASSIGNED', 'system',
    p_actor_id, v_company.owner_user_id,
    jsonb_build_object('from', v_company.owner_user_id, 'to', p_user_id, 'mode', p_mode)
  )
  returning id into v_activity_id;

  return jsonb_build_object(
    'changed', true,
    'from', v_company.owner_user_id,
    'to', case when p_mode = 'replace' then p_user_id
               else coalesce(v_company.owner_user_id, p_user_id) end,
    'activity_id', v_activity_id
  );
end;
$$;

comment on function public.crm_assign_company(uuid, uuid, uuid, uuid, text) is
  'Assigns an account (replace, or add when multiple assignees are allowed), keeps '
  'owner_user_id and history in step, and writes ACCOUNT_ASSIGNED, in one transaction. '
  'Trusts the caller''s accounts.assign check.';

-- ---------------------------------------------------------------------------
-- crm_unassign_company — p_user_id NULL removes every assignee.
-- ---------------------------------------------------------------------------

create or replace function public.crm_unassign_company(
  p_workspace_id uuid,
  p_company_id   uuid,
  p_user_id      uuid default null,
  p_actor_id     uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company     public.crm_companies%rowtype;
  v_closed      integer;
  v_next_owner  uuid;
  v_activity_id uuid;
begin
  select * into v_company
    from public.crm_companies
   where id = p_company_id
     and workspace_id = p_workspace_id
     and deleted_at is null
   for update;
  if v_company.id is null then
    raise exception 'crm_unassign_company: no such account in workspace %', p_workspace_id
      using errcode = 'no_data_found';
  end if;

  with closed as (
    update public.crm_company_assignments
       set unassigned_at = now(), unassigned_by = p_actor_id, end_reason = 'unassigned'
     where company_id = p_company_id
       and workspace_id = p_workspace_id
       and unassigned_at is null
       and (p_user_id is null or user_id = p_user_id)
    returning id
  )
  select count(id) into v_closed from closed;

  if v_closed = 0 then
    return jsonb_build_object('changed', false, 'owner', v_company.owner_user_id, 'activity_id', null);
  end if;

  -- The primary passes to whoever has held the account longest, or to nobody.
  select a.user_id into v_next_owner
    from public.crm_company_assignments a
   where a.company_id = p_company_id
     and a.unassigned_at is null
   order by a.assigned_at, a.id
   limit 1;

  if v_company.owner_user_id is distinct from v_next_owner
     and (v_next_owner is null or v_company.owner_user_id is null
          or not exists (
            select 1 from public.crm_company_assignments
             where company_id = p_company_id
               and user_id = v_company.owner_user_id
               and unassigned_at is null)) then
    update public.crm_companies
       set owner_user_id = v_next_owner
     where id = p_company_id
       and workspace_id = p_workspace_id;
  end if;

  insert into public.crm_activities (
    workspace_id, company_id, activity_type, channel,
    actor_user_id, owner_user_id_at_event, metadata
  )
  values (
    p_workspace_id, p_company_id, 'ACCOUNT_UNASSIGNED', 'system',
    p_actor_id, v_company.owner_user_id,
    jsonb_strip_nulls(jsonb_build_object('user', p_user_id, 'removed', v_closed))
  )
  returning id into v_activity_id;

  return jsonb_build_object(
    'changed', true,
    'owner', (select owner_user_id from public.crm_companies where id = p_company_id),
    'activity_id', v_activity_id
  );
end;
$$;

comment on function public.crm_unassign_company(uuid, uuid, uuid, uuid) is
  'Closes one assignee''s (or every) open assignment, passes the primary to the '
  'longest-standing remaining assignee or to nobody, and writes ACCOUNT_UNASSIGNED. '
  'Trusts the caller''s accounts.assign check.';

-- ---------------------------------------------------------------------------
-- A member leaving releases what handover did not move
--
-- Member handover (0129) moves owner_user_id, which the sync trigger turns
-- into history. A SECONDARY assignment is not an owner, so handover never sees
-- it; this closes it when the membership goes.
--
-- Skipped when the workspace itself is being deleted: everything is about to
-- cascade away, and touching it first would only race the cascade.
-- ---------------------------------------------------------------------------

create or replace function public.crm_release_member_accounts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return null;
  end if;

  -- Closed FIRST, so the rows record why they ended rather than the sync
  -- trigger's generic 'unassigned' when the owner below becomes nobody.
  update public.crm_company_assignments
     set unassigned_at = now(), end_reason = 'member_removed'
   where workspace_id = old.workspace_id
     and user_id = old.user_id
     and unassigned_at is null;

  -- Anything still owned by the leaver passes to a remaining assignee, or nobody.
  update public.crm_companies co
     set owner_user_id = (
       select a.user_id
         from public.crm_company_assignments a
        where a.company_id = co.id
          and a.unassigned_at is null
          and a.user_id <> old.user_id
        order by a.assigned_at, a.id
        limit 1
     )
   where co.workspace_id = old.workspace_id
     and co.owner_user_id = old.user_id;

  return null;
end;
$$;

drop trigger if exists workspace_memberships_release_accounts on public.workspace_memberships;
create trigger workspace_memberships_release_accounts
  after delete on public.workspace_memberships
  for each row execute function public.crm_release_member_accounts();

-- ---------------------------------------------------------------------------
-- Backfill, once
--
-- Every existing owner becomes an open assignment dated when the account was
-- created — the best date available, and labelled as such by having no
-- `assigned_by`. Every account gets a status: Assigned if it has an owner,
-- New if not.
-- ---------------------------------------------------------------------------

insert into public.crm_company_assignments (workspace_id, company_id, user_id, assigned_at)
select co.workspace_id, co.id, co.owner_user_id, least(co.created_at, now())
  from public.crm_companies co
 where co.owner_user_id is not null
   and not exists (
     select 1 from public.crm_company_assignments a
      where a.company_id = co.id and a.user_id = co.owner_user_id and a.unassigned_at is null
   );

-- updated_at is left alone: GET /api/v1/companies exposes it (see 0145).
alter table public.crm_companies disable trigger crm_companies_set_updated_at;

update public.crm_companies co
   set status_id = public.crm_account_status_id(
         co.workspace_id,
         case when co.owner_user_id is null then 'new' else 'assigned' end)
 where co.status_id is null;

alter table public.crm_companies enable trigger crm_companies_set_updated_at;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

/*
 * ⚠️ SERVICE ROLE ONLY. Both are security definer and trust their caller's
 * `accounts.assign` check, exactly as crm_assign_contact_owner trusts
 * `crm.contact.assign`. Granting them to `authenticated` would let any
 * signed-in member reassign any account.
 */
revoke all on function public.crm_assign_company(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.crm_assign_company(uuid, uuid, uuid, uuid, text) to service_role;
revoke all on function public.crm_unassign_company(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_unassign_company(uuid, uuid, uuid, uuid) to service_role;
revoke all on function public.crm_allow_multiple_assignees(uuid) from public, anon, authenticated;
grant execute on function public.crm_allow_multiple_assignees(uuid) to service_role;
revoke all on function public.crm_account_status_id(uuid, text) from public, anon, authenticated;
grant execute on function public.crm_account_status_id(uuid, text) to service_role;
revoke all on function public.crm_guard_company_assignment() from public, anon, authenticated;
revoke all on function public.crm_guard_disable_multiple() from public, anon, authenticated;
revoke all on function public.crm_companies_status_on_assign() from public, anon, authenticated;
revoke all on function public.crm_companies_sync_assignment() from public, anon, authenticated;
revoke all on function public.crm_release_member_accounts() from public, anon, authenticated;

alter table public.crm_company_assignments enable row level security;
drop policy if exists crm_company_assignments_select_member on public.crm_company_assignments;
create policy crm_company_assignments_select_member on public.crm_company_assignments
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());
revoke all on table public.crm_company_assignments from public, anon, authenticated;
grant select on table public.crm_company_assignments to authenticated;
grant select, insert, update, delete on table public.crm_company_assignments to service_role;

comment on table public.crm_company_assignments is
  'Who has worked each account, and when. Open rows are the current assignees; '
  'crm_companies.owner_user_id is the primary one. Closed rows are immutable.';
