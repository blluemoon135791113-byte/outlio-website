-- ---------------------------------------------------------------------------
-- 0126 — crm task actions: complete with an outcome, snooze, reassign
--
-- §7: "Allow explicit snooze with a new review date, completion with an
-- outcome, reassignment where permitted, and record navigation." My Work
-- (#28) shipped the ranked queue and record navigation. This is the rest.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️ COMPLETING A TASK WITH NO CONTACT IS BROKEN TODAY, AND THIS FIXES IT. ║
-- ║                                                                           ║
-- ║  `setTaskDone` updates the task, then calls `recordActivity` with the     ║
-- ║  task id in `metadata` only. For a task with no contact that insert has   ║
-- ║  no contact, no company and `refs = {}` — exactly what                    ║
-- ║  `crm_activities_has_subject` (0075) refuses. Reproduced against a real   ║
-- ║  Postgres before this file was written:                                   ║
-- ║                                                                           ║
-- ║    ERROR: new row for relation "crm_activities" violates check            ║
-- ║           constraint "crm_activities_has_subject"                         ║
-- ║    task row afterwards:           completed | t                           ║
-- ║    TASK_COMPLETED rows for it:    0                                       ║
-- ║                                                                           ║
-- ║  The update had already committed. The task is done, has no history, the ║
-- ║  `task_completed` flow trigger never fires, and the person who clicked    ║
-- ║  sees an error for an action that succeeded. My Work and the New Task     ║
-- ║  form both create contactless tasks, so this is the common case.          ║
-- ║                                                                           ║
-- ║  Every activity written below carries `refs.task_id`, which satisfies the ║
-- ║  subject constraint whatever else the task links to — and the change and  ║
-- ║  its history row commit together, as 0123 does for contact ownership.     ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ A VERSION COUNTER, BUMPED BY TRIGGER — NOT `updated_at`, AND NOT IN-FUNCTION.
--
-- Phase 4's acceptance line is "stale UI edit cannot overwrite reassignment".
-- `updated_at` looked like the free answer and fails twice: `set_updated_at`
-- writes `now()`, which is frozen for a whole transaction, and a timestamp that
-- passes through a JavaScript `Date` loses its microseconds, so a round-tripped
-- token would never match and every edit would read as stale.
--
-- `crm_opportunities.version` (0076) avoids both, but it is bumped only inside
-- `crm_move_opportunity_stage`. Tasks have writers that are not functions —
-- offboarding's bulk reassignment in `lib/workspaces/handover.ts`, the reopen
-- path in `setTaskDone` — and an in-function bump would let exactly the
-- offboarding reassignment slip past a stale edit. A trigger bumps on EVERY
-- update, whoever writes it, so the functions here never touch `version`.
--
-- ⚠️ EXPECTED FAILURES ARE RESULTS, NOT EXCEPTIONS. Stale, already-completed,
-- not-yours and not-a-member are things a person does by clicking; they return
-- `{ok:false, reason}` so the caller maps a code rather than parsing an error
-- message. Only an invariant violation raises.
--
-- ⚠️ VALIDATE BEFORE APPLYING. A plpgsql body is not name-resolved at creation
-- time; 0072 shipped an ambiguous one that created cleanly and failed on first
-- call. `alter type ... add value` cannot run inside the rollback-only
-- rehearsal, so use the throwaway cluster:
--
--   scripts/check-migration.sh supabase/migrations/0126_crm_task_actions.sql \
--     supabase/migrations/smoke/0126_crm_task_actions.smoke.sql
--
-- ⚠️ APPLY THIS BEFORE MERGING THE CODE THAT CALLS IT.
-- ---------------------------------------------------------------------------

/*
 * New values are only USED inside function bodies below, which are not
 * resolved until first call — so this is safe even where the whole script runs
 * as one transaction and the values are not yet committed.
 */
alter type public.crm_activity_type add value if not exists 'TASK_SNOOZED';
alter type public.crm_activity_type add value if not exists 'TASK_REASSIGNED';

alter table public.crm_tasks add column if not exists version integer not null default 1;
alter table public.crm_tasks add column if not exists snoozed_until timestamptz;
alter table public.crm_tasks add column if not exists outcome text;

comment on column public.crm_tasks.version is
  'Optimistic-lock token. Bumped by trigger on every update, whoever writes it.';
comment on column public.crm_tasks.snoozed_until is
  'Hidden from My Work until this instant. Does not change due_at: a snooze is a review date, not a new commitment.';
comment on column public.crm_tasks.outcome is
  'What completing the task achieved. Cleared on reopen; the TASK_COMPLETED activity keeps the original.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_tasks_outcome_length') then
    alter table public.crm_tasks add constraint crm_tasks_outcome_length
      check (outcome is null or length(outcome) between 1 and 500);
  end if;

  /*
   * ⚠️ AN OUTCOME BELONGS TO A COMPLETION. This makes a reopen that forgets to
   * clear it FAIL rather than leave "Booked a demo" sitting on an open task.
   * Any reopen path must set `outcome = null` alongside `completed_at = null`.
   */
  if not exists (select 1 from pg_constraint where conname = 'crm_tasks_outcome_only_when_completed') then
    alter table public.crm_tasks add constraint crm_tasks_outcome_only_when_completed
      check (outcome is null or status = 'completed');
  end if;
end $$;

create or replace function public.crm_tasks_bump_version()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  /*
   * From OLD, never from NEW. A writer that sets `version` itself — by
   * accident or to force a stale token through — is overridden rather than
   * trusted.
   */
  new.version := old.version + 1;
  return new;
end;
$$;

drop trigger if exists crm_tasks_bump_version on public.crm_tasks;
create trigger crm_tasks_bump_version
  before update on public.crm_tasks
  for each row execute function public.crm_tasks_bump_version();

-- ---------------------------------------------------------------------------
-- crm_complete_task
-- ---------------------------------------------------------------------------
create or replace function public.crm_complete_task(
  p_workspace_id         uuid,
  p_task_id              uuid,
  p_actor_id             uuid,
  p_outcome              text,
  p_expected_version     integer,
  p_restrict_to_assignee uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task        public.crm_tasks%rowtype;
  v_outcome     text := nullif(btrim(p_outcome), '');
  v_owner       uuid;
  v_activity_id uuid;
  v_version     integer;
begin
  select * into v_task
    from public.crm_tasks
   where id = p_task_id
     and workspace_id = p_workspace_id
   for update;

  /*
   * ⚠️ "NOT YOURS" READS AS "NOT FOUND", deliberately. A setter probing task
   * ids must not learn which ones exist in somebody else's queue.
   */
  if v_task.id is null
     or v_task.deleted_at is not null
     or (p_restrict_to_assignee is not null
         and v_task.assigned_to_user_id is distinct from p_restrict_to_assignee) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  /* Completing twice must write ONE event: completions are a dashboard metric. */
  if v_task.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;

  if p_expected_version is null or v_task.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;

  if v_outcome is not null and length(v_outcome) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_outcome');
  end if;

  if v_task.contact_id is not null then
    select owner_user_id into v_owner
      from public.crm_contacts
     where id = v_task.contact_id
       and workspace_id = p_workspace_id;
  end if;

  update public.crm_tasks
     set status        = 'completed',
         completed_at  = now(),
         completed_by  = p_actor_id,
         outcome       = v_outcome,
         snoozed_until = null
   where id = v_task.id
     and workspace_id = p_workspace_id
  returning version into v_version;

  insert into public.crm_activities (
    workspace_id, contact_id, company_id, activity_type, channel,
    actor_user_id, owner_user_id_at_event, refs, metadata
  )
  values (
    p_workspace_id, v_task.contact_id, v_task.company_id, 'TASK_COMPLETED', 'manual',
    p_actor_id, v_owner,
    jsonb_strip_nulls(jsonb_build_object('task_id', v_task.id, 'opportunity_id', v_task.opportunity_id)),
    jsonb_strip_nulls(jsonb_build_object('title', v_task.title, 'outcome', v_outcome))
  )
  returning id into v_activity_id;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'activity_id', v_activity_id,
    'task_id', v_task.id,
    'contact_id', v_task.contact_id,
    'version', v_version
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- crm_snooze_task
-- ---------------------------------------------------------------------------
create or replace function public.crm_snooze_task(
  p_workspace_id         uuid,
  p_task_id              uuid,
  p_actor_id             uuid,
  p_until                timestamptz,
  p_expected_version     integer,
  p_restrict_to_assignee uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task        public.crm_tasks%rowtype;
  v_owner       uuid;
  v_activity_id uuid;
  v_version     integer;
begin
  select * into v_task
    from public.crm_tasks
   where id = p_task_id
     and workspace_id = p_workspace_id
   for update;

  if v_task.id is null
     or v_task.deleted_at is not null
     or (p_restrict_to_assignee is not null
         and v_task.assigned_to_user_id is distinct from p_restrict_to_assignee) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_task.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;

  if p_expected_version is null or v_task.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;

  /*
   * ⚠️ BOUNDED BOTH WAYS. A snooze into the past is a no-op dressed as an
   * action, and an unbounded one is a quiet way to delete work nobody will
   * ever see again — which is what cancelling is for, and cancelling is
   * visible.
   */
  if p_until is null or p_until <= now() or p_until > now() + interval '365 days' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_until');
  end if;

  if v_task.contact_id is not null then
    select owner_user_id into v_owner
      from public.crm_contacts
     where id = v_task.contact_id
       and workspace_id = p_workspace_id;
  end if;

  update public.crm_tasks
     set snoozed_until = p_until
   where id = v_task.id
     and workspace_id = p_workspace_id
  returning version into v_version;

  insert into public.crm_activities (
    workspace_id, contact_id, company_id, activity_type, channel,
    actor_user_id, owner_user_id_at_event, refs, metadata
  )
  values (
    p_workspace_id, v_task.contact_id, v_task.company_id, 'TASK_SNOOZED', 'manual',
    p_actor_id, v_owner,
    jsonb_strip_nulls(jsonb_build_object('task_id', v_task.id, 'opportunity_id', v_task.opportunity_id)),
    jsonb_strip_nulls(jsonb_build_object(
      'title', v_task.title,
      'until', p_until,
      'previous_until', v_task.snoozed_until
    ))
  )
  returning id into v_activity_id;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'activity_id', v_activity_id,
    'task_id', v_task.id,
    'version', v_version
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- crm_reassign_task
-- ---------------------------------------------------------------------------
create or replace function public.crm_reassign_task(
  p_workspace_id     uuid,
  p_task_id          uuid,
  p_actor_id         uuid,
  p_new_assignee     uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task        public.crm_tasks%rowtype;
  v_owner       uuid;
  v_activity_id uuid;
  v_version     integer;
begin
  select * into v_task
    from public.crm_tasks
   where id = p_task_id
     and workspace_id = p_workspace_id
   for update;

  if v_task.id is null or v_task.deleted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  /* A completed task records who completed it; moving it would rewrite history. */
  if v_task.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;

  if p_expected_version is null or v_task.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;

  /*
   * ⚠️ UNASSIGNING IS REFUSED. An unassigned task belongs to nobody and sits in
   * no one's queue forever — the reason `createTaskAction` assigns to the
   * creator by default.
   */
  if p_new_assignee is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_assignee');
  end if;

  /*
   * ⚠️ MEMBERSHIP IS CHECKED HERE, not only in the form. The select lists
   * members, but an id from a form is a claim, and a task assigned to someone
   * outside the workspace is invisible to everyone inside it.
   */
  if not exists (
    select 1 from public.workspace_memberships
     where workspace_id = p_workspace_id
       and user_id = p_new_assignee
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_a_member');
  end if;

  /* Already theirs: no update (so no version bump) and no activity. */
  if v_task.assigned_to_user_id is not distinct from p_new_assignee then
    return jsonb_build_object(
      'ok', true, 'changed', false, 'activity_id', null,
      'task_id', v_task.id, 'version', v_task.version
    );
  end if;

  if v_task.contact_id is not null then
    select owner_user_id into v_owner
      from public.crm_contacts
     where id = v_task.contact_id
       and workspace_id = p_workspace_id;
  end if;

  /*
   * ⚠️ THE SNOOZE IS CLEARED. It was the previous assignee's personal choice
   * about when to look again; carrying it over would hide the task from the
   * person who has just been handed it.
   */
  update public.crm_tasks
     set assigned_to_user_id = p_new_assignee,
         snoozed_until       = null
   where id = v_task.id
     and workspace_id = p_workspace_id
  returning version into v_version;

  insert into public.crm_activities (
    workspace_id, contact_id, company_id, activity_type, channel,
    actor_user_id, owner_user_id_at_event, refs, metadata
  )
  values (
    p_workspace_id, v_task.contact_id, v_task.company_id, 'TASK_REASSIGNED', 'manual',
    p_actor_id, v_owner,
    jsonb_strip_nulls(jsonb_build_object('task_id', v_task.id, 'opportunity_id', v_task.opportunity_id)),
    jsonb_strip_nulls(jsonb_build_object(
      'title', v_task.title,
      'from', v_task.assigned_to_user_id,
      'to', p_new_assignee
    ))
  )
  returning id into v_activity_id;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'activity_id', v_activity_id,
    'task_id', v_task.id,
    'version', v_version
  );
end;
$$;

comment on function public.crm_complete_task(uuid, uuid, uuid, text, integer, uuid) is
  'Completes an open task with an optional outcome and writes TASK_COMPLETED in the same transaction.';
comment on function public.crm_snooze_task(uuid, uuid, uuid, timestamptz, integer, uuid) is
  'Hides an open task from My Work until a future review date and writes TASK_SNOOZED in the same transaction.';
comment on function public.crm_reassign_task(uuid, uuid, uuid, uuid, integer) is
  'Moves an open task to another workspace member and writes TASK_REASSIGNED in the same transaction.';

/*
 * ⚠️ SERVICE ROLE ONLY, for the same reason as 0123 and 0125. These are
 * `security definer` and trust their arguments: the server actions gate on
 * `crm.task.manage` (and `crm.contact.assign` for reassignment) and pass the
 * assignee restriction for setters. Granting them to `authenticated` would let
 * any signed-in user complete, snooze or move any task in a workspace they can
 * reach.
 */
revoke all on function public.crm_complete_task(uuid, uuid, uuid, text, integer, uuid) from public;
revoke all on function public.crm_complete_task(uuid, uuid, uuid, text, integer, uuid) from anon;
revoke all on function public.crm_complete_task(uuid, uuid, uuid, text, integer, uuid) from authenticated;
grant execute on function public.crm_complete_task(uuid, uuid, uuid, text, integer, uuid) to service_role;

revoke all on function public.crm_snooze_task(uuid, uuid, uuid, timestamptz, integer, uuid) from public;
revoke all on function public.crm_snooze_task(uuid, uuid, uuid, timestamptz, integer, uuid) from anon;
revoke all on function public.crm_snooze_task(uuid, uuid, uuid, timestamptz, integer, uuid) from authenticated;
grant execute on function public.crm_snooze_task(uuid, uuid, uuid, timestamptz, integer, uuid) to service_role;

revoke all on function public.crm_reassign_task(uuid, uuid, uuid, uuid, integer) from public;
revoke all on function public.crm_reassign_task(uuid, uuid, uuid, uuid, integer) from anon;
revoke all on function public.crm_reassign_task(uuid, uuid, uuid, uuid, integer) from authenticated;
grant execute on function public.crm_reassign_task(uuid, uuid, uuid, uuid, integer) to service_role;
