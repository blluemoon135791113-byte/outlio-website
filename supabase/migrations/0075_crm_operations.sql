-- 0075 — CRM operations: activities, tasks, notes, notifications, erasure
--        (M2 Phase 5)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ACTIVITIES ARE THE EVENT STREAM EVERY METRIC IS DERIVED FROM.            ║
-- ║                                                                           ║
-- ║  Constitution A3: attribution is FROZEN AT EVENT TIME and survives        ║
-- ║  reassignment. A report asks "who did this, and who owned the contact     ║
-- ║  WHEN it happened" — never "who owns them now". Reassign a setter's book  ║
-- ║  on Monday and last quarter's numbers must not move.                      ║
-- ║                                                                           ║
-- ║  That is why every row carries actor_user_id, owner_user_id_at_event and  ║
-- ║  team_id_at_event as VALUES, not as joins to a current owner.             ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- APPEND-ONLY IS ENFORCED BY A TRIGGER, NOT BY CONVENTION. Grants stop the
-- application; a trigger stops a migration, a support script, and the service
-- role that bypasses RLS. M2 acceptance criterion 5 is "no update path
-- exposed", and a path that merely nobody has taken yet is still exposed.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_activity_type') then
    create type public.crm_activity_type as enum (
      -- Manual / LinkedIn engagement, logged by a person or ingested from the
      -- Lead Engine. NEVER from an invented LinkedIn integration (A5).
      'ENGAGEMENT',
      'OPENER_SENT',
      'PERSONALIZED_DM',
      'REPLY_RECEIVED',
      'FOLLOW_UP',
      -- Email. Written by M5/M6; declared now so those milestones add no value
      -- to a live enum.
      'EMAIL_SENT',
      'EMAIL_REPLIED',
      'EMAIL_BOUNCED',
      'EMAIL_UNSUBSCRIBED',
      -- Meetings, from Calendly (M8) or logged by hand.
      'CALL_BOOKED',
      'CALL_HELD',
      'CALL_NO_SHOW',
      -- CRM lifecycle.
      'CONTACT_CREATED',
      'OWNER_ASSIGNED',
      'TASK_COMPLETED',
      'NOTE_ADDED',
      'STAGE_CHANGED',
      'OPPORTUNITY_WON',
      'OPPORTUNITY_LOST',
      'QUALIFIED',
      'MERGED'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'crm_activity_channel') then
    create type public.crm_activity_channel as enum (
      'linkedin',
      'email',
      'phone',
      'meeting',
      'manual',
      -- Emitted by the platform itself: a merge, an assignment, an import.
      'system'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'crm_task_status') then
    create type public.crm_task_status as enum ('open', 'completed', 'cancelled');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- The append-only guard
--
-- ⚠️ TWO ESCAPE HATCHES, BOTH DELIBERATE AND BOTH NARROW.
--
--  1. GDPR erasure. The right to erasure outranks our audit convenience, so
--     `crm_erase_contact` sets `outlio.erasure` for its transaction and the
--     guard stands down. Nothing else sets it.
--  2. Cascade. Deleting a workspace, or erasing a user, cascades into these
--     tables; the parent is already gone by then, so its absence distinguishes
--     "the tenant is being destroyed" from "somebody is rewriting history".
--     Without this a workspace could never be deleted — the same trap
--     guard_last_workspace_owner documents in 0070.
-- ---------------------------------------------------------------------------

create or replace function public.crm_guard_append_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('outlio.erasure', true), '') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE'
     and not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;

  raise exception
    '%.% is append-only; % is not permitted',
    tg_table_schema, tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

-- ---------------------------------------------------------------------------
-- crm_activities
-- ---------------------------------------------------------------------------

create table if not exists public.crm_activities (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  activity_type public.crm_activity_type not null,
  channel       public.crm_activity_channel not null,

  -- ---- subject ----------------------------------------------------------
  contact_id   uuid,
  company_id   uuid,
  /* Ids of things that do not exist yet (opportunity, campaign, message,
     meeting). A jsonb bag rather than a column per future module, so M3–M8 add
     no migration here — and no nullable column nobody reads. */
  refs         jsonb not null default '{}'::jsonb,

  -- ---- attribution, FROZEN ----------------------------------------------
  /* Who performed it. NULL for something the platform did on its own. */
  actor_user_id          uuid references auth.users(id) on delete set null,
  /* Who owned the contact AT THE TIME. ⚠️ Never re-derive this from
     crm_contacts.owner_user_id when reporting: that is the current owner, and
     using it makes last quarter's numbers move when a book is reassigned. */
  owner_user_id_at_event uuid references auth.users(id) on delete set null,
  /* Reserved for Teams (Ledger DR1). Nullable and unused until M4, so teams
     arrive without a backfill of history that never had a team. */
  team_id_at_event       uuid,

  /* When it HAPPENED — backdatable, because ingested history did not happen
     at import time. `created_at` is when we recorded it; a funnel uses
     occurred_at and an audit uses created_at. */
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),

  /* Type-specific detail. Deliberately not columns: EMAIL_SENT and CALL_HELD
     share almost nothing, and a table with the union of both is mostly nulls. */
  metadata     jsonb not null default '{}'::jsonb,

  /* ⚠️ NO updated_at, and no deleted_at. This table is append-only; a column
     implying otherwise would invite exactly the writes the trigger refuses. */

  constraint crm_activities_refs_is_object check (jsonb_typeof(refs) = 'object'),
  constraint crm_activities_metadata_is_object check (jsonb_typeof(metadata) = 'object'),
  /* An event about nothing cannot be reported on and cannot be erased on
     request, because nothing links it to a person. */
  constraint crm_activities_has_subject check (
    contact_id is not null or company_id is not null or refs <> '{}'::jsonb
  ),

  constraint crm_activities_contact_fk
    foreign key (contact_id, workspace_id)
    references public.crm_contacts (id, workspace_id)
    on delete cascade,
  constraint crm_activities_company_fk
    foreign key (company_id, workspace_id)
    references public.crm_companies (id, workspace_id)
    on delete cascade
);

-- The contact timeline: one contact, newest first.
create index if not exists crm_activities_contact_idx
  on public.crm_activities (workspace_id, contact_id, occurred_at desc)
  where contact_id is not null;

-- The setter dashboard: what did this person do in this period (M4).
create index if not exists crm_activities_actor_idx
  on public.crm_activities (workspace_id, actor_user_id, occurred_at desc);

-- Attribution reporting: credited to whoever owned the contact at the time.
create index if not exists crm_activities_owner_at_event_idx
  on public.crm_activities (workspace_id, owner_user_id_at_event, occurred_at desc);

create index if not exists crm_activities_type_idx
  on public.crm_activities (workspace_id, activity_type, occurred_at desc);

create index if not exists crm_activities_company_idx
  on public.crm_activities (workspace_id, company_id, occurred_at desc)
  where company_id is not null;

drop trigger if exists crm_activities_append_only on public.crm_activities;
create trigger crm_activities_append_only
  before update or delete on public.crm_activities
  for each row execute function public.crm_guard_append_only();

-- 0074 declared crm_merge_events append-only and enforced it with grants
-- alone. Grants do not bind a migration or a support script; this does.
drop trigger if exists crm_merge_events_append_only on public.crm_merge_events;
create trigger crm_merge_events_append_only
  before update or delete on public.crm_merge_events
  for each row execute function public.crm_guard_append_only();

-- ---------------------------------------------------------------------------
-- crm_tasks
-- ---------------------------------------------------------------------------

create table if not exists public.crm_tasks (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  contact_id      uuid,
  company_id      uuid,

  title           text not null check (length(trim(title)) between 1 and 200),
  body            text,
  due_at          timestamptz,

  assigned_to_user_id uuid references auth.users(id) on delete set null,
  status          public.crm_task_status not null default 'open',
  completed_at    timestamptz,
  completed_by    uuid references auth.users(id) on delete set null,

  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,

  constraint crm_tasks_completion_consistent check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  ),
  constraint crm_tasks_contact_fk
    foreign key (contact_id, workspace_id)
    references public.crm_contacts (id, workspace_id)
    on delete cascade,
  constraint crm_tasks_company_fk
    foreign key (company_id, workspace_id)
    references public.crm_companies (id, workspace_id)
    on delete cascade
);

drop trigger if exists crm_tasks_set_updated_at on public.crm_tasks;
create trigger crm_tasks_set_updated_at
  before update on public.crm_tasks
  for each row execute function public.set_updated_at();

-- "My open tasks, soonest first" — the query a setter's day is built on.
-- NULLS LAST so an undated task does not sort above everything overdue.
create index if not exists crm_tasks_assignee_due_idx
  on public.crm_tasks (workspace_id, assigned_to_user_id, due_at asc nulls last)
  where status = 'open' and deleted_at is null;

create index if not exists crm_tasks_contact_idx
  on public.crm_tasks (workspace_id, contact_id)
  where contact_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- Notes and mentions
-- ---------------------------------------------------------------------------

create table if not exists public.crm_notes (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  contact_id   uuid,
  company_id   uuid,

  body         text not null check (length(trim(body)) between 1 and 20000),

  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  constraint crm_notes_has_subject check (contact_id is not null or company_id is not null),
  constraint crm_notes_contact_fk
    foreign key (contact_id, workspace_id)
    references public.crm_contacts (id, workspace_id)
    on delete cascade,
  constraint crm_notes_company_fk
    foreign key (company_id, workspace_id)
    references public.crm_companies (id, workspace_id)
    on delete cascade
);

drop trigger if exists crm_notes_set_updated_at on public.crm_notes;
create trigger crm_notes_set_updated_at
  before update on public.crm_notes
  for each row execute function public.set_updated_at();

create index if not exists crm_notes_contact_idx
  on public.crm_notes (workspace_id, contact_id, created_at desc)
  where contact_id is not null and deleted_at is null;

create table if not exists public.crm_note_mentions (
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  note_id           uuid not null,
  mentioned_user_id uuid not null references auth.users(id) on delete cascade,
  created_at        timestamptz not null default now(),

  primary key (note_id, mentioned_user_id),

  constraint crm_note_mentions_note_fk
    foreign key (note_id) references public.crm_notes (id) on delete cascade
);

create index if not exists crm_note_mentions_user_idx
  on public.crm_note_mentions (workspace_id, mentioned_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Notifications
--
-- In-app only. Email notification is M5's problem — there is no sender yet,
-- and inventing one here would mean two delivery paths to reconcile later.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_notifications (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,

  kind         text not null check (kind ~ '^[a-z][a-z0-9_.]{1,63}$'),
  title        text not null check (length(trim(title)) between 1 and 200),
  body         text,
  /* Where clicking it should go, and what it is about. */
  refs         jsonb not null default '{}'::jsonb,

  read_at      timestamptz,
  created_at   timestamptz not null default now(),

  constraint crm_notifications_refs_is_object check (jsonb_typeof(refs) = 'object')
);

-- The bell: unread first, newest first, for one person.
create index if not exists crm_notifications_unread_idx
  on public.crm_notifications (workspace_id, user_id, created_at desc)
  where read_at is null;

create index if not exists crm_notifications_user_idx
  on public.crm_notifications (workspace_id, user_id, created_at desc);

create table if not exists public.crm_notification_preferences (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind ~ '^[a-z][a-z0-9_.]{1,63}$'),
  /* A row means "switched off". Absence means the default, so a new
     notification kind reaches everyone without backfilling a row per user. */
  in_app       boolean not null default true,
  updated_at   timestamptz not null default now(),

  primary key (workspace_id, user_id, kind)
);

drop trigger if exists crm_notification_preferences_set_updated_at
  on public.crm_notification_preferences;
create trigger crm_notification_preferences_set_updated_at
  before update on public.crm_notification_preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- crm_audit_logs
--
-- DISTINCT FROM ACTIVITIES, and the distinction is worth stating:
--
--   crm_activities   what happened to a CONTACT. Business events. Reported on.
--   crm_audit_logs   who changed WHAT RECORD OR SETTING. Never reported on;
--                    read when someone asks "who did this to my data".
--
-- Also distinct from admin_audit_logs, which is platform staff acting on an
-- account. This is a workspace acting on itself.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_audit_logs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,

  actor_user_id uuid references auth.users(id) on delete set null,
  action        text not null check (action ~ '^[a-z][a-z0-9_.]{2,63}$'),
  target_type   text not null,
  target_id     uuid,

  before_state  jsonb,
  after_state   jsonb,
  reason        text,

  created_at    timestamptz not null default now()
);

create index if not exists crm_audit_logs_workspace_idx
  on public.crm_audit_logs (workspace_id, created_at desc);
create index if not exists crm_audit_logs_target_idx
  on public.crm_audit_logs (workspace_id, target_type, target_id, created_at desc);

drop trigger if exists crm_audit_logs_append_only on public.crm_audit_logs;
create trigger crm_audit_logs_append_only
  before update or delete on public.crm_audit_logs
  for each row execute function public.crm_guard_append_only();

-- ---------------------------------------------------------------------------
-- crm_erase_contact — the GDPR right to erasure
--
-- ⚠️ HARD DELETE. This is the ONLY path that hard-deletes CRM data; everything
-- else soft-deletes. It is also the only caller permitted to set
-- `outlio.erasure`, which stands the append-only guard down.
--
-- THE ORDER OF PRECEDENCE IS THE POINT: the right to erasure outranks our
-- audit convenience. An activity stream and a merge snapshot are ours; the
-- personal data inside them is not. So activities are deleted and merge
-- snapshots are scrubbed, not preserved.
--
-- ⚠️ `crm_lead_keys`-style hashes are NOT the model here. lib/leads/dedupe.ts
-- keeps hashed keys after a lead is purged because a hash carries no readable
-- personal data. A CRM contact's row carries names, addresses and phone
-- numbers, so the row goes.
--
-- What SURVIVES, deliberately: an audit row recording that an erasure
-- happened, carrying the contact's id and nothing about the person. Being
-- unable to prove an erasure was performed is its own compliance problem.
-- ---------------------------------------------------------------------------

create or replace function public.crm_erase_contact(
  p_workspace_id uuid,
  p_contact_id   uuid,
  p_actor_id     uuid default null,
  p_reason       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted jsonb := '{}'::jsonb;
  v_count   integer;
begin
  if not exists (
    select 1 from public.crm_contacts
     where id = p_contact_id and workspace_id = p_workspace_id
  ) then
    raise exception 'crm_erase_contact: contact % is not in workspace %',
      p_contact_id, p_workspace_id using errcode = 'no_data_found';
  end if;

  -- Scoped to THIS transaction. `set local` cannot leak into another session,
  -- and the guard reads it by name — nothing else in the codebase sets it.
  perform set_config('outlio.erasure', 'on', true);

  -- ---- anything pointing AT the person ----------------------------------
  with removed as (
    delete from public.crm_activities
     where workspace_id = p_workspace_id and contact_id = p_contact_id
    returning 1
  ) select count(*) into v_count from removed;
  v_deleted := v_deleted || jsonb_build_object('activities', v_count);

  with removed as (
    delete from public.crm_notes
     where workspace_id = p_workspace_id and contact_id = p_contact_id
    returning 1
  ) select count(*) into v_count from removed;
  v_deleted := v_deleted || jsonb_build_object('notes', v_count);

  with removed as (
    delete from public.crm_tasks
     where workspace_id = p_workspace_id and contact_id = p_contact_id
    returning 1
  ) select count(*) into v_count from removed;
  v_deleted := v_deleted || jsonb_build_object('tasks', v_count);

  -- A notification body can quote a name, so anything referring to this
  -- contact goes with them.
  with removed as (
    delete from public.crm_notifications
     where workspace_id = p_workspace_id
       and refs ->> 'contact_id' = p_contact_id::text
    returning 1
  ) select count(*) into v_count from removed;
  v_deleted := v_deleted || jsonb_build_object('notifications', v_count);

  with removed as (
    delete from public.crm_duplicate_candidates
     where workspace_id = p_workspace_id
       and (record_a_id = p_contact_id or record_b_id = p_contact_id)
    returning 1
  ) select count(*) into v_count from removed;
  v_deleted := v_deleted || jsonb_build_object('duplicate_candidates', v_count);

  -- ---- merge history ----------------------------------------------------
  -- SCRUBBED, NOT DELETED. The fact that two records became one is ours to
  -- keep and matters for attribution; the copy of the person inside the
  -- snapshot is not.
  update public.crm_merge_events
     set snapshot = jsonb_build_object(
           'erased', true,
           'erased_at', now(),
           'moved', coalesce(snapshot -> 'moved', '{}'::jsonb)
         )
   where workspace_id = p_workspace_id
     and (merged_id = p_contact_id or surviving_id = p_contact_id);

  -- ---- the person -------------------------------------------------------
  -- Emails, phones, employment, tags, batch and list membership and custom
  -- field values all cascade from this row.
  delete from public.crm_contacts
   where id = p_contact_id and workspace_id = p_workspace_id;

  -- ---- proof, carrying no personal data ---------------------------------
  insert into public.crm_audit_logs (
    workspace_id, actor_user_id, action, target_type, target_id, after_state, reason
  ) values (
    p_workspace_id, p_actor_id, 'crm.contact.erased', 'crm_contact', p_contact_id,
    v_deleted, coalesce(p_reason, 'GDPR erasure request')
  );

  perform set_config('outlio.erasure', 'off', true);

  return v_deleted;
end;
$$;

revoke all on function public.crm_erase_contact(uuid, uuid, uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
--
-- ⚠️ A member can READ their workspace's whole activity stream. Narrowing a
-- SETTER to their own records is `dataScope()` applied as a WHERE clause by
-- the caller — a policy cannot express "rows about contacts assigned to you"
-- without embedding the ownership model in SQL. Every M4 report MUST apply it.
--
-- Notifications are the exception: they are addressed to ONE person, and a
-- notification is often the first place a name appears outside a record.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_activities', 'crm_tasks', 'crm_notes', 'crm_note_mentions', 'crm_audit_logs'
  ]
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
  end loop;
end
$$;

alter table public.crm_notifications enable row level security;
drop policy if exists crm_notifications_select_own on public.crm_notifications;
create policy crm_notifications_select_own on public.crm_notifications
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

alter table public.crm_notification_preferences enable row level security;
drop policy if exists crm_notification_preferences_select_own
  on public.crm_notification_preferences;
create policy crm_notification_preferences_select_own
  on public.crm_notification_preferences
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke all on table public.crm_notifications from public, anon, authenticated;
revoke all on table public.crm_notification_preferences from public, anon, authenticated;
grant select on table public.crm_notifications to authenticated;
grant select on table public.crm_notification_preferences to authenticated;

grant select, insert, update, delete on table public.crm_tasks to service_role;
grant select, insert, update, delete on table public.crm_notes to service_role;
grant select, insert, update, delete on table public.crm_note_mentions to service_role;
grant select, insert, update, delete on table public.crm_notifications to service_role;
grant select, insert, update, delete on table public.crm_notification_preferences to service_role;

-- ⚠️ INSERT AND SELECT ONLY, for the service role too. The trigger is the real
-- guarantee; withholding the grant means an accidental UPDATE fails at the
-- door rather than inside a transaction that has already done other work.
grant select, insert on table public.crm_activities to service_role;
grant select, insert on table public.crm_audit_logs to service_role;

-- ---------------------------------------------------------------------------
-- Documentation
-- ---------------------------------------------------------------------------

comment on table public.crm_activities is
  'Append-only event stream. ALL metrics derive from it. Attribution is frozen '
  'at event time (actor_user_id, owner_user_id_at_event, team_id_at_event), so '
  'reassigning a book does not move last quarter''s numbers.';

comment on column public.crm_activities.owner_user_id_at_event is
  'Who owned the contact WHEN this happened. ⚠️ Never re-derive from '
  'crm_contacts.owner_user_id for reporting — that is the CURRENT owner.';

comment on function public.crm_erase_contact(uuid, uuid, uuid, text) is
  'GDPR erasure. The only hard delete in the CRM, and the only caller allowed '
  'to stand the append-only guard down. Merge snapshots are scrubbed rather '
  'than deleted; an audit row proving the erasure survives, carrying no '
  'personal data.';
