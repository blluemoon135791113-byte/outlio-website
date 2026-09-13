-- ---------------------------------------------------------------------------
-- 0125 — The LinkedIn release pipeline: enrollments, tasks, and the version
-- that makes a cancellation durable.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  `lib/linkedin/` HAS SEVEN MODULES THAT IMPORT ONLY EACH OTHER.           ║
-- ║                                                                           ║
-- ║  `preflight`, `enrollment`, `outcomes`, `render`, `templates`,            ║
-- ║  `variables` and `metrics` are complete, tested, and unreachable from any  ║
-- ║  page or worker — an island that looks maintained from the inside.        ║
-- ║  `tests/unit/module-reachability.test.ts` allowlists them with the reason  ║
-- ║  "the release pipeline is not built yet". This is that pipeline's schema.  ║
-- ║                                                                           ║
-- ║  ⚠️ NOTHING HERE PERFORMS A LINKEDIN ACTION. CLAUDE.md rule 1 stands: a    ║
-- ║  task is a card telling a human what to do in LinkedIn themselves, and an  ║
-- ║  outcome is that human afterwards saying what they did.                   ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The contact version — §4.7's durable cancellation.
-- ---------------------------------------------------------------------------
/*
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ `preflight()` HAS ALWAYS REQUIRED `currentContactVersion`, AND THE     ║
 * ║  COLUMN DID NOT EXIST. The decision layer was built against a fact the     ║
 * ║  schema could not supply.                                                 ║
 * ║                                                                           ║
 * ║  §4.7: "Pending outreach steps must fail their preflight once that version ║
 * ║  changes. Lost UI notifications must not restore action permission."      ║
 * ║                                                                           ║
 * ║  A cancellation delivered as a notification can be missed — a dropped      ║
 * ║  socket, a closed laptop, a stale tab — and a missed one leaves the task   ║
 * ║  clickable, which turns the guarantee into "usually". Comparing the        ║
 * ║  version an approval was granted at against the contact's version now      ║
 * ║  inverts that: permission is RE-EARNED at the moment of use, so anything   ║
 * ║  that failed to arrive fails closed by construction.                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
alter table public.crm_contacts
  add column if not exists version integer not null default 1;

/*
 * ⚠️ BUMPED BY A TRIGGER, NOT BY CALLERS. A version every writer must remember
 * to increment is a version that is wrong the first time somebody forgets, and
 * the failure is silent: a stale approval stays valid and a cancelled outreach
 * step remains clickable.
 *
 * ⚠️ AND IT EXCLUDES ITS OWN COLUMN, or the update below recurses.
 */
create or replace function public.crm_contact_bump_version()
returns trigger
language plpgsql
as $$
begin
  /*
   * Only a change to the contact's OWN meaningful state invalidates an
   * approval. `updated_at` moving on its own does not, or every touch would
   * invalidate every pending task and the mechanism would be noise.
   */
  if new.full_name        is distinct from old.full_name
     or new.owner_user_id is distinct from old.owner_user_id
     or new.deleted_at    is distinct from old.deleted_at
     or new.primary_company_id is distinct from old.primary_company_id
     or new.timezone      is distinct from old.timezone
  then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_contacts_bump_version on public.crm_contacts;
create trigger crm_contacts_bump_version
  before update on public.crm_contacts
  for each row
  execute function public.crm_contact_bump_version();

comment on column public.crm_contacts.version is
  'Bumped when the contact''s own state changes. A LinkedIn task approved at a '
  'different version fails preflight — §4.7 durable cancellation (0125).';

-- ---------------------------------------------------------------------------
-- 2. Enumerations, mirroring lib/linkedin/ exactly.
-- ---------------------------------------------------------------------------
/*
 * ⚠️ THESE MIRROR TypeScript UNIONS AND MUST NOT DRIFT FROM THEM.
 * `lib/linkedin/enrollment.ts` and `outcomes.ts` are the source; a value here
 * that the code cannot produce is a state nothing can ever leave, and a value
 * there that the database rejects is a write that fails at runtime.
 * `tests/unit/linkedin-pipeline.test.ts` compares the two lists.
 */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'linkedin_enrollment_state') then
    create type public.linkedin_enrollment_state as enum (
      'DRAFT',
      'ELIGIBILITY_REVIEW',
      'READY',
      'RUNNING',
      'WAITING_EVENT',
      'WAITING_APPROVAL',
      'WAITING_MANUAL_ACTION',
      'PAUSED',
      'COMPLETED',
      'CANCELLED',
      'FAILED'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'linkedin_terminal_reason') then
    create type public.linkedin_terminal_reason as enum (
      'GOAL_MET',
      'REPLIED',
      'NOT_INTERESTED',
      'DNC',
      'NOT_ACCEPTED',
      'NO_REPLY',
      'EXPIRED',
      'DISQUALIFIED',
      'MANUAL_STOP'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'linkedin_task_kind') then
    create type public.linkedin_task_kind as enum (
      'REVIEW_PROFILE',
      'CONNECTION_REQUEST',
      'DIRECT_MESSAGE',
      'INMAIL'
    );
  end if;

  /*
   * ⚠️ `TaskOutcome` ONLY. `Observation` — acceptance, reply, meeting held —
   * is deliberately NOT in this type. §4.13: "'Mark request sent' cannot mark
   * acceptance". An observation is something seen later about the CONTACT, not
   * the outcome of doing a task, and collapsing them sends a message into a
   * connection that was never made.
   */
  if not exists (select 1 from pg_type where typname = 'linkedin_task_outcome') then
    create type public.linkedin_task_outcome as enum (
      'REQUEST_MARKED_SENT',
      'MESSAGE_MARKED_SENT',
      'PROFILE_REVIEW_RECORDED',
      'SKIPPED',
      'FAILED',
      'OUTCOME_UNKNOWN'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'linkedin_task_state') then
    /*
     * ⚠️ SEPARATE FROM `outcome`, WHICH IS THE WHOLE POINT. §4.13: "task
     * created ≠ message sent." A single status enum cannot say both "this card
     * is finished" and "what the person actually did", and merging them is how
     * a skipped task reads as a sent one in every count downstream.
     */
    create type public.linkedin_task_state as enum (
      'PENDING',
      'RELEASED',
      'COMPLETED',
      'EXPIRED'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Enrollments — one contact's journey through a sequence.
-- ---------------------------------------------------------------------------
create table if not exists public.linkedin_enrollments (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  contact_id      uuid not null references public.crm_contacts(id) on delete cascade,

  -- Which real account performs this person's steps. Fixed at enrollment:
  -- §4.10's budgets are per sender, and moving mid-sequence would make a
  -- conversation arrive from two different people.
  sender_id       uuid not null references public.linkedin_senders(id) on delete restrict,

  state           public.linkedin_enrollment_state not null default 'DRAFT',

  -- ⚠️ SET ONLY WHEN `state` IS TERMINAL. `reasonMeansSuccess()` treats
  -- GOAL_MET alone as success; the rest are how it ended, not how it went.
  terminal_reason public.linkedin_terminal_reason,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  ended_at        timestamptz
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'linkedin_enrollments_terminal_pair'
  ) then
    /*
     * ⚠️ A REASON WITHOUT A TERMINAL STATE IS A CONTRADICTION, and a terminal
     * state without a reason loses the only field §4.18 reports on.
     */
    alter table public.linkedin_enrollments
      add constraint linkedin_enrollments_terminal_pair
      check (
        (state in ('COMPLETED', 'CANCELLED', 'FAILED')) = (terminal_reason is not null)
      );
  end if;
end
$$;

/*
 * ⚠️ ONE LIVE ENROLLMENT PER CONTACT PER WORKSPACE. Two would mean two senders
 * approaching the same person, which the prospect experiences as being spammed
 * by one company twice — the same harm `crm_collision_settings` exists to
 * prevent for owners. Terminal rows are excluded so a contact can be enrolled
 * again after a sequence ends.
 */
create unique index if not exists linkedin_enrollments_one_live_idx
  on public.linkedin_enrollments (workspace_id, contact_id)
  where state not in ('COMPLETED', 'CANCELLED', 'FAILED');

create index if not exists linkedin_enrollments_sender_idx
  on public.linkedin_enrollments (sender_id, state);

alter table public.linkedin_enrollments enable row level security;

drop policy if exists linkedin_enrollments_select_member on public.linkedin_enrollments;
create policy linkedin_enrollments_select_member
  on public.linkedin_enrollments
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

revoke all on table public.linkedin_enrollments from public, anon, authenticated;
grant select on table public.linkedin_enrollments to authenticated;
grant select, insert, update, delete on table public.linkedin_enrollments to service_role;

-- ---------------------------------------------------------------------------
-- 4. Tasks — the Action Inbox card (§4.13).
-- ---------------------------------------------------------------------------
create table if not exists public.linkedin_tasks (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  enrollment_id  uuid not null references public.linkedin_enrollments(id) on delete cascade,
  contact_id     uuid not null references public.crm_contacts(id) on delete cascade,
  sender_id      uuid not null references public.linkedin_senders(id) on delete restrict,

  kind           public.linkedin_task_kind  not null,
  state          public.linkedin_task_state not null default 'PENDING',

  /*
   * ⚠️ THE VERSION THE CONTENT WAS APPROVED AT. `preflight()` compares it with
   * `crm_contacts.version` using `!==`, not `>`: a counter that wrapped, was
   * reset, or came back from a backup would otherwise read as "nothing
   * changed".
   */
  approved_at_contact_version integer not null,

  -- The rendered message a human will paste. NULL for REVIEW_PROFILE, which
  -- asks somebody to look rather than to write.
  body           text,

  /*
   * ⚠️ WHAT THE OPERATOR DID, NOT WHAT LATER HAPPENED. Never an Observation —
   * see the note on `linkedin_task_outcome`.
   */
  outcome        public.linkedin_task_outcome,
  -- §4.13 requires a reason when a task is skipped; `requiresReason()` decides.
  skip_reason    text,

  /*
   * ⚠️ §4.13 HOLDS A TASK THAT LACKS A RECENT THREAD CHECK. Releasing a follow-up
   * without anybody having looked at the real conversation is how Outlio sends
   * a second message to somebody who already replied.
   */
  last_thread_check_at timestamptz,

  /*
   * §4.17's stable key, carried so the ledger row and the task agree.
   * DELIBERATELY EXCLUDES the attempt number: including it would make a retry a
   * new logical action, which could duplicate a real external effect.
   */
  logical_action_id text not null unique,

  released_at    timestamptz,
  completed_at   timestamptz,
  completed_by   uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'linkedin_tasks_outcome_pair'
  ) then
    /*
     * ⚠️ AN OUTCOME EXISTS EXACTLY WHEN THE TASK IS COMPLETED. Otherwise a
     * PENDING task can carry "MESSAGE_MARKED_SENT" and every count downstream
     * believes it.
     */
    alter table public.linkedin_tasks
      add constraint linkedin_tasks_outcome_pair
      check ((state = 'COMPLETED') = (outcome is not null));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'linkedin_tasks_skip_reason'
  ) then
    -- A skip without a reason is the one thing §4.13 asks for by name.
    alter table public.linkedin_tasks
      add constraint linkedin_tasks_skip_reason
      check (outcome is distinct from 'SKIPPED' or skip_reason is not null);
  end if;
end
$$;

-- The Action Inbox query: my workspace's open cards, oldest first.
create index if not exists linkedin_tasks_inbox_idx
  on public.linkedin_tasks (workspace_id, state, created_at)
  where state in ('PENDING', 'RELEASED');

create index if not exists linkedin_tasks_enrollment_idx
  on public.linkedin_tasks (enrollment_id, created_at);

alter table public.linkedin_tasks enable row level security;

drop policy if exists linkedin_tasks_select_member on public.linkedin_tasks;
create policy linkedin_tasks_select_member
  on public.linkedin_tasks
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

revoke all on table public.linkedin_tasks from public, anon, authenticated;
grant select on table public.linkedin_tasks to authenticated;
grant select, insert, update, delete on table public.linkedin_tasks to service_role;

comment on table public.linkedin_tasks is
  'One Action Inbox card. Outlio prepares it; a human performs the action in '
  'LinkedIn and records what they did. `outcome` is what they DID; an '
  'Observation is what was later seen and is not stored here (0125).';

comment on column public.linkedin_tasks.approved_at_contact_version is
  'crm_contacts.version when this content was approved. preflight() refuses '
  'when it no longer matches — §4.7 durable cancellation (0125).';
