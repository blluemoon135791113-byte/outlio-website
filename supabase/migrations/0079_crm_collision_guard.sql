-- 0079 — outreach collision guard (M3 Phase 8)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  DEDUPLICATION AND COLLISION ARE DIFFERENT QUESTIONS.                     ║
-- ║                                                                           ║
-- ║  Dedup (M2 Phase 4) asks "are these two records the same person?"          ║
-- ║  Collision asks "is a TEAMMATE already working this person?"               ║
-- ║                                                                           ║
-- ║  One record, one real person, two setters about to email them in the same ║
-- ║  week — nothing is duplicated and the prospect still gets pitched twice by ║
-- ║  the same company. That is the failure this guards, and no amount of      ║
-- ║  merging prevents it.                                                     ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ WARN IS THE DEFAULT, AND BLOCKING IS OPT-IN. A guard that stops work by
-- default gets switched off in week one and protects nobody afterwards. The
-- setter sees who owns the person, what happened last, and decides.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_collision_mode') then
    create type public.crm_collision_mode as enum (
      'off',              -- say nothing
      'warn',             -- show it, let them proceed, log the override
      'require_approval'  -- refuse until the owner or a manager agrees
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'crm_reassignment_status') then
    create type public.crm_reassignment_status as enum (
      'pending', 'approved', 'declined', 'withdrawn'
    );
  end if;
end
$$;

-- The override is a business event about the contact as well as an audit
-- record: a manager reviewing the timeline needs to see that someone stepped
-- over a warning, without going to a separate log to find out.
alter type public.crm_activity_type add value if not exists 'COLLISION_OVERRIDE';

-- ---------------------------------------------------------------------------
-- crm_collision_settings
--
-- One row per workspace. Absence means the defaults below, so a workspace that
-- has never opened the settings page is still guarded.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_collision_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,

  /* A contact owned by someone else is the sharp case: same person, two
     setters. Warned by default. */
  contact_mode public.crm_collision_mode not null default 'warn',

  /* Company-level is OFF by default and deliberately so. In a 5,000-person
     enterprise two setters working two different departments is normal, not a
     collision, and warning on it trains people to ignore the warning. Teams
     selling into small companies turn it on. */
  company_mode public.crm_collision_mode not null default 'off',

  /* How recently a teammate must have touched the record for it to count as
     "being worked". Older than this and the contact is dormant, not owned. */
  active_within_days integer not null default 30
    check (active_within_days between 1 and 365),

  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null
);

drop trigger if exists crm_collision_settings_set_updated_at on public.crm_collision_settings;
create trigger crm_collision_settings_set_updated_at
  before update on public.crm_collision_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- crm_reassignment_requests
--
-- The polite path. A setter who finds a colleague on their prospect can ask
-- for the record rather than either backing off silently or stepping over the
-- warning.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_reassignment_requests (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  contact_id            uuid not null,

  requested_by          uuid references auth.users(id) on delete set null,
  /* Frozen: who owned it when the request was made. The owner can change while
     a request sits pending, and the request has to still make sense. */
  current_owner_user_id uuid references auth.users(id) on delete set null,
  note                  text,

  status                public.crm_reassignment_status not null default 'pending',
  resolved_at           timestamptz,
  resolved_by           uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),

  constraint crm_reassignment_resolution_consistent check (
    (status = 'pending' and resolved_at is null)
    or (status <> 'pending' and resolved_at is not null)
  ),
  constraint crm_reassignment_contact_fk
    foreign key (contact_id, workspace_id)
    references public.crm_contacts (id, workspace_id)
    on delete cascade
);

-- One open request per person per contact. Asking twice is not a second
-- request, and a queue of duplicates is how the owner starts ignoring them.
create unique index if not exists crm_reassignment_open_uniq
  on public.crm_reassignment_requests (workspace_id, contact_id, requested_by)
  where status = 'pending';

create index if not exists crm_reassignment_owner_idx
  on public.crm_reassignment_requests (workspace_id, current_owner_user_id, created_at desc)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- crm_record_collision_override
--
-- The brief asks for an override to be logged as an activity AND an audit
-- entry. Both, or neither — an override that appears on the timeline but not
-- in the audit log, or the reverse, is worse than one that appears nowhere,
-- because the two records then disagree about what happened.
--
-- ⚠️ The activity type is used only at RUNTIME. `ALTER TYPE ... ADD VALUE`
-- above and this function can share a migration precisely because creating a
-- function does not evaluate the enum literal in its body; executing it later
-- does.
-- ---------------------------------------------------------------------------

create or replace function public.crm_record_collision_override(
  p_workspace_id uuid,
  p_contact_id   uuid,
  p_actor_id     uuid,
  p_reason       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contact public.crm_contacts%rowtype;
  v_activity uuid;
begin
  select * into v_contact
    from public.crm_contacts
   where id = p_contact_id and workspace_id = p_workspace_id and deleted_at is null;

  if v_contact.id is null then
    raise exception 'crm_record_collision_override: contact % is not in workspace %',
      p_contact_id, p_workspace_id using errcode = 'no_data_found';
  end if;

  insert into public.crm_activities (
    workspace_id, activity_type, channel, contact_id, company_id,
    actor_user_id, owner_user_id_at_event, metadata
  ) values (
    p_workspace_id, 'COLLISION_OVERRIDE', 'system', p_contact_id, v_contact.primary_company_id,
    p_actor_id,
    -- The owner being stepped OVER, which is the whole point of the record.
    v_contact.owner_user_id,
    jsonb_build_object(
      'overridden_owner_user_id', v_contact.owner_user_id,
      'reason', p_reason
    )
  )
  returning id into v_activity;

  insert into public.crm_audit_logs (
    workspace_id, actor_user_id, action, target_type, target_id, after_state, reason
  ) values (
    p_workspace_id, p_actor_id, 'crm.collision.override', 'crm_contact', p_contact_id,
    jsonb_build_object(
      'overridden_owner_user_id', v_contact.owner_user_id,
      'activity_id', v_activity
    ),
    p_reason
  );

  return v_activity;
end;
$$;

revoke all on function public.crm_record_collision_override(uuid, uuid, uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['crm_collision_settings', 'crm_reassignment_requests']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_member', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_workspace_member(workspace_id) or public.is_admin())',
      t || '_select_member', t
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role', t
    );
  end loop;
end
$$;

comment on table public.crm_collision_settings is
  'Per-workspace collision policy. Absence means the defaults, so a workspace '
  'that never opens the settings page is still guarded. Company-level is off '
  'by default: in a large enterprise two setters in two departments is normal, '
  'and warning on it trains people to ignore the warning.';

comment on table public.crm_reassignment_requests is
  'The polite alternative to stepping over a collision warning: ask the owner '
  'for the record.';
