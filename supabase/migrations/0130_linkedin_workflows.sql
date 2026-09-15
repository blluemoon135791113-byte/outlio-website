-- ---------------------------------------------------------------------------
-- 0130 — The customer's own campaign workflow. Linear. Phase 20.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  Owner decision, 2026-09-15: "keep it manual but the user can create own  ║
-- ║  workflow for thier campaigns… once its save then they have the option on ║
-- ║  actions they added only not fixed actions", and "OK ship lenier".        ║
-- ║                                                                           ║
-- ║  ⚠️ OUTLIO STILL NEVER LOGS IN AND NEVER SENDS. Nothing in this migration ║
-- ║  moves that line. A workflow is a list of things a HUMAN will do, with     ║
-- ║  waits between them, and the rows below schedule the asking — never the    ║
-- ║  doing.                                                                   ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ THE ENROLMENT POINTER IS A STEP ID, NOT A POSITION NUMBER, and that is the
-- decision this whole migration is built around.
--
-- The owner requires that "people can entre at diff points", so a live campaign
-- normally has people standing on several different steps at once. Positions
-- renumber whenever a step is inserted or reordered. An integer pointer would
-- therefore move people silently: insert a step at 3 and everybody standing on
-- old-5 is now on a step they already did, or one they never saw. No error, no
-- log line — just the wrong message, from a real account, to a real stranger.
--
-- An id pointer makes insert and reorder safe by construction, and narrows the
-- dangerous edit to exactly one case: deleting the step somebody is standing on.
-- `on delete restrict` below turns that case into a refusal instead of an
-- orphan.
-- ---------------------------------------------------------------------------

-- ---- the vocabulary -------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'linkedin_step_action') then
    /*
     * ⚠️ NO 'VOICE_NOTE'. Owner, 2026-09-15: "THE VOICE CLONING AND TEXT TO
     * SPEECH KEEP IT FOR LATER NOW JUST DO AS I SAID". Adding the enum value now
     * "so it is ready" would put a selectable action in the builder that no code
     * can execute — rule 7, and the exact shape of the complaint that produced
     * this phase.
     *
     * ⚠️ 'WAIT' IS AN ACTION RATHER THAN A SEPARATE TABLE. It occupies a card in
     * the same ordered list in the reference the owner supplied, and an
     * enrolment walking the workflow has to step over it like anything else. Two
     * tables would mean two orderings to keep in agreement.
     */
    create type public.linkedin_step_action as enum (
      'VISIT_PROFILE',
      'CONNECTION_REQUEST',
      'DIRECT_MESSAGE',
      'INMAIL',
      'LIKE_POST',
      'COMMENT_POST',
      'ADD_TAG',
      'WAIT'
    );
  end if;
end $$;

/*
 * ⚠️ TWO NEW TASK KINDS AND ONE NEW OUTCOME. `if not exists` is the idempotent
 * form used by 0079, so re-running this file by hand is safe.
 *
 * ⚠️ THERE IS NO 'VISIT_PROFILE' TASK KIND, DELIBERATELY. The step action is
 * called `VISIT_PROFILE` because that is what the owner's reference calls the
 * card, but the task it produces is the EXISTING `REVIEW_PROFILE`. Adding a
 * second kind meaning the same thing is this repository's most expensive
 * recurring defect — one question with two implementations — and it would arrive
 * pre-broken here, because `enroll.ts` already creates `REVIEW_PROFILE` and
 * every metric counting profile work already looks for it.
 *
 * `lib/linkedin/steps.ts` maps the action to the kind. One name in the UI, one
 * name in the database, and a single function that relates them.
 */
alter type public.linkedin_task_kind add value if not exists 'LIKE_POST';
alter type public.linkedin_task_kind add value if not exists 'COMMENT_POST';

/*
 * ⚠️ ONE OUTCOME FOR BOTH LIKE AND COMMENT. Owner: "outlio does not prepares the
 * comment draft it would just be marked as comments/engagement done". Which
 * action it was is already on the task's `kind`; a second outcome would be a
 * second thing every metric counting engagement has to remember to include.
 */
alter type public.linkedin_task_outcome add value if not exists 'ENGAGEMENT_RECORDED';

-- ---- the steps ------------------------------------------------------------

create table if not exists public.linkedin_workflow_steps (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id  uuid not null references public.linkedin_campaigns(id) on delete cascade,

  /*
   * ⚠️ ORDERING ONLY. Never an identity, never a pointer target. Gaps are legal
   * and expected: the builder renumbers on save, and two steps briefly sharing a
   * position during a reorder is a display artefact rather than corruption.
   */
  position     integer not null check (position >= 0),

  action       public.linkedin_step_action not null,

  /*
   * ⚠️ THE OPERATOR'S OWN WORDS. Owner, 2026-09-15: "outlio does not prepare the
   * note text or the message it will be written manually". Outlio resolves the
   * three placeholders and nothing else — it does not compose, complete, or
   * improve what is stored here.
   *
   * The 8000 cap is a storage sanity bound, not LinkedIn's limit. The real caps
   * are per-action and enforced in `lib/linkedin/workflow.ts`, which can say
   * WHICH limit was exceeded and by how much.
   */
  body         text check (body is null or length(body) <= 8000),

  /*
   * ⚠️ NULL FOR EVERY NON-WAIT STEP, ENFORCED BELOW RATHER THAN BY CONVENTION.
   * A `wait_days` sitting on a DM is a number some future reader will treat as a
   * delay before sending, and it would be wrong exactly when it mattered.
   */
  wait_days    integer check (wait_days is null or (wait_days between 1 and 90)),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint linkedin_workflow_steps_wait_shape check (
    (action = 'WAIT'  and wait_days is not null and body is null)
    or
    (action <> 'WAIT' and wait_days is null)
  ),

  /*
   * ⚠️ THE STEPS THAT CARRY NO CONTENT MUST CARRY NONE. `COMMENT_POST` is the
   * owner's explicit case — Outlio prepares no draft — and `VISIT_PROFILE`,
   * `LIKE_POST` and `ADD_TAG` are the same shape. Without this, a body typed
   * into one of them would save, never render anywhere, and be discovered as
   * missing by an operator standing in front of the post.
   */
  constraint linkedin_workflow_steps_bodyless check (
    action not in ('VISIT_PROFILE', 'LIKE_POST', 'COMMENT_POST', 'ADD_TAG')
    or body is null
  )
);

create index if not exists linkedin_workflow_steps_campaign_idx
  on public.linkedin_workflow_steps (campaign_id, position);

/*
 * ⚠️ REDUNDANT-LOOKING AND REQUIRED. `campaign_id` already implies a workspace,
 * but the service role bypasses RLS and every query scopes by `workspace_id` in
 * code (CLAUDE.md). Without this index those scoped reads cannot use the
 * campaign index at all.
 */
create index if not exists linkedin_workflow_steps_workspace_idx
  on public.linkedin_workflow_steps (workspace_id, campaign_id);

-- ---- where each person is standing ----------------------------------------

/*
 * ⚠️ `on delete restrict`, AND IT IS THE WHOLE SAFETY PROPERTY.
 *
 * Deleting a step somebody is standing on is the one edit an id pointer does not
 * make safe. `set null` would orphan them into a state indistinguishable from
 * "finished the campaign" — a completion nobody performed. `cascade` would
 * delete the enrolment, destroying the record that a real person was contacted.
 *
 * `restrict` makes the database refuse, and `lib/linkedin/workflow.ts`
 * (`canRemoveStep`) turns that refusal into a sentence naming how many people
 * are affected, so the customer decides what happens to them.
 */
alter table public.linkedin_enrollments
  add column if not exists current_step_id uuid
    references public.linkedin_workflow_steps(id) on delete restrict;

/*
 * ⚠️ WHERE THEY STARTED, KEPT SEPARATELY AND NEVER UPDATED.
 *
 * The owner requires entry at any point. Once somebody has advanced, their
 * current step no longer says where they came in — and the difference is the
 * whole question for the analysis feature the owner described next ("get back
 * with whats working and whats not"). A campaign whose step-3 entrants reply and
 * whose step-1 entrants do not is a finding; without this column it is invisible.
 *
 * `on delete set null`: losing the record of where somebody started is a
 * degraded report. Blocking the delete over it would be disproportionate, since
 * unlike `current_step_id` nothing reads it to decide what happens next.
 */
alter table public.linkedin_enrollments
  add column if not exists entry_step_id uuid
    references public.linkedin_workflow_steps(id) on delete set null;

/*
 * ⚠️ WHEN THE NEXT STEP MAY BE RELEASED — the only thing a `WAIT` actually does.
 * Null means "now": an enrolment with no pending wait is immediately eligible.
 * Storing the deadline rather than the remaining time means a worker that does
 * not run for a day does not thereby extend everybody's wait by a day.
 */
alter table public.linkedin_enrollments
  add column if not exists next_step_due_at timestamptz;

create index if not exists linkedin_enrollments_due_idx
  on public.linkedin_enrollments (workspace_id, next_step_due_at)
  where current_step_id is not null;

/*
 * ⚠️ THE STEP A TASK CAME FROM, SO A RESULT FORM CAN ASK THE WORKFLOW WHAT IT
 * MAY OFFER. This is what makes the owner's requirement enforceable rather than
 * cosmetic: "they have the option on actions they added only". Without it, a
 * result form has only the task's `kind` and is back to a fixed vocabulary.
 *
 * Nullable because every task written before this migration has no step — those
 * are real rows from Phase 10 enrolments, and inventing a step for them would
 * invent a workflow nobody built.
 */
alter table public.linkedin_tasks
  add column if not exists step_id uuid
    references public.linkedin_workflow_steps(id) on delete set null;

-- ---- RLS ------------------------------------------------------------------

alter table public.linkedin_workflow_steps enable row level security;

/*
 * Read-only to workspace members, matching `linkedin_campaigns`. Every write
 * goes through a server action that gates first.
 */
do $$ begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'linkedin_workflow_steps'
       and policyname = 'linkedin_workflow_steps_select_members'
  ) then
    create policy linkedin_workflow_steps_select_members
      on public.linkedin_workflow_steps
      for select to authenticated
      using (
        exists (
          select 1 from public.workspace_memberships m
           where m.workspace_id = linkedin_workflow_steps.workspace_id
             and m.user_id = auth.uid()
        )
      );
  end if;
end $$;

drop trigger if exists linkedin_workflow_steps_set_updated_at on public.linkedin_workflow_steps;
create trigger linkedin_workflow_steps_set_updated_at
  before update on public.linkedin_workflow_steps
  for each row
  execute function public.set_updated_at();

comment on table public.linkedin_workflow_steps is
  'The steps a customer built for one campaign, in order. Linear by decision '
  '(0130) — branching is additive later. Outlio performs none of these: each '
  'step describes what a human will do in LinkedIn themselves.';

comment on column public.linkedin_enrollments.current_step_id is
  'The step this person is standing on. An ID, never a position number: '
  'positions renumber when the customer edits the workflow, and an integer '
  'pointer would silently move live enrollments onto the wrong step.';

comment on column public.linkedin_enrollments.entry_step_id is
  'Where they entered. Never updated, because current_step_id stops answering '
  'this the moment they advance — and entry point is the comparison the DM '
  'analysis needs.';

comment on column public.linkedin_workflow_steps.body is
  'The operator''s own words. Outlio resolves three placeholders (first_name, '
  'company, location) and composes nothing (owner decision 2026-09-15).';
