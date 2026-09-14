'use server'

/**
 * Task actions — M9 screens over M2 Phase 5's schema, and §7's My Work actions.
 *
 * ⚠️ COMPLETING A TASK WRITES AN ACTIVITY, because every metric in the product
 * derives from the append-only event stream rather than from a status column.
 * A task quietly flipped to `completed` without an event would be invisible to
 * every report that counts "tasks completed".
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ COMPLETION, SNOOZE AND REASSIGNMENT GO THROUGH 0126, NOT HERE.        ║
 * ║                                                                           ║
 * ║  `setTaskDone` used to update the task and THEN call `recordActivity`     ║
 * ║  with the task id in `metadata` only. For a task with no contact that     ║
 * ║  insert has no contact, no company and `refs = {}` — which                ║
 * ║  `crm_activities_has_subject` refuses. Reproduced against real Postgres:  ║
 * ║  the task stayed completed, got no TASK_COMPLETED row, the                ║
 * ║  `task_completed` flow trigger never fired, and the person saw an error   ║
 * ║  for an action that had succeeded. My Work and the New Task form both     ║
 * ║  create contactless tasks, so it was the common case.                     ║
 * ║                                                                           ║
 * ║  The 0126 functions lock the row, check the version, write the change and ║
 * ║  its activity (with `refs.task_id`, which always satisfies the subject    ║
 * ║  constraint) in one transaction, and return a reason code instead of      ║
 * ║  raising for things a person does by clicking.                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { revalidatePath } from 'next/cache'

import { emitDomainEvent } from '@/lib/events/emit'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission } from '@/lib/workspaces/context'
import { dataScope } from '@/lib/workspaces/permissions'

export type TaskActionState = { ok: true; message: string } | { ok: false; error: string } | null

type WorkspaceCtx = Awaited<ReturnType<typeof assertWorkspacePermission>>

/** The refusals 0126 returns as results rather than exceptions. */
type TaskRefusal =
  | 'not_found'
  | 'not_open'
  | 'stale'
  | 'invalid_outcome'
  | 'invalid_until'
  | 'invalid_assignee'
  | 'not_a_member'

type TaskRpcResult =
  | {
      ok: true
      changed: boolean
      activity_id: string | null
      task_id: string
      contact_id?: string | null
      version: number
    }
  | { ok: false; reason: TaskRefusal }

/*
 * ⚠️ `not_found` ALSO MEANS "NOT YOURS". The function answers that way on
 * purpose so a setter cannot probe which task ids exist in someone else's
 * queue, and the copy has to cover both without revealing which it was.
 */
const REFUSAL_COPY: Record<TaskRefusal, string> = {
  not_found: 'That task no longer exists, or is not yours to change.',
  not_open: 'That task is already closed.',
  stale: 'Someone changed this task while you had it open. Reload to see the latest.',
  invalid_outcome: 'Keep the outcome under 500 characters.',
  invalid_until: 'Pick a review date after today and within a year.',
  invalid_assignee: 'Choose someone to hand this task to.',
  not_a_member: 'That person is not a member of this workspace.',
}

const OUTCOME_MAX = 500
const SNOOZE_MAX_MS = 365 * 24 * 60 * 60 * 1000

/**
 * The optimistic-lock token the screen last saw.
 *
 * ⚠️ PASSED BACK EXACTLY AS READ. A missing or malformed version is refused
 * here rather than defaulted — defaulting would turn "I cannot tell whether
 * this screen is stale" into "assume it is not", which is the one thing the
 * version exists to prevent.
 */
function readVersion(formData: FormData): number | null {
  const version = Number(formData.get('version'))
  return Number.isInteger(version) && version >= 1 ? version : null
}

/**
 * ⚠️ A SETTER ACTS ONLY ON THEIR OWN TASKS — the constitution's "only assigned
 * data" rule, enforced by the database function rather than trusted from the
 * form. Before this, `setTaskDone` checked the workspace and nothing else, so a
 * setter could complete any task in it by id.
 */
function assigneeRestriction(ctx: WorkspaceCtx): string | undefined {
  return dataScope(ctx.role) === 'all' ? undefined : (ctx.userId ?? undefined)
}

function refusal(result: TaskRpcResult, fallback: string): { ok: false; error: string } {
  return { ok: false, error: result.ok ? fallback : (REFUSAL_COPY[result.reason] ?? fallback) }
}

function revalidateTaskScreens(): void {
  revalidatePath('/crm/tasks')
  revalidatePath('/crm/my-work')
  revalidatePath('/dashboard')
}

async function completeTask(
  ctx: WorkspaceCtx,
  taskId: string,
  version: number,
  outcome: string,
): Promise<TaskActionState> {
  if (!ctx.userId) return { ok: false, error: 'Sign in again to change tasks.' }

  const restrict = assigneeRestriction(ctx)
  const db = createAdminClient()
  const { data, error } = await db.rpc('crm_complete_task', {
    p_workspace_id: ctx.workspace.id,
    p_task_id: taskId,
    p_actor_id: ctx.userId,
    // An empty string is stored as null by the function's nullif(btrim(...)).
    p_outcome: outcome,
    p_expected_version: version,
    ...(restrict ? { p_restrict_to_assignee: restrict } : {}),
  })

  if (error) return { ok: false, error: 'Could not complete that task.' }

  const result = data as TaskRpcResult
  if (!result.ok) return refusal(result, 'Could not complete that task.')

  /*
   * ⚠️ AFTER THE TRANSACTION COMMITS, and only on a real completion. Keyed on
   * the task, so completing, reopening and completing again is one task
   * finished twice by a person and does not run the follow-up flow twice —
   * `startRun` de-duplicates on this key.
   */
  await emitDomainEvent({
    workspaceId: ctx.workspace.id,
    triggerType: 'task_completed',
    contactId: result.contact_id ?? null,
    idempotencyKey: `task_completed:${taskId}`,
    payload: { taskId, contactId: result.contact_id ?? null },
  })

  revalidateTaskScreens()
  return { ok: true, message: 'Done.' }
}

export async function setTaskDone(
  _previous: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.task.manage')
  } catch {
    return { ok: false, error: 'You do not have permission to change tasks.' }
  }

  const id = String(formData.get('taskId') ?? '')
  const done = formData.get('done') === 'true'

  if (done) {
    const version = readVersion(formData)
    if (version === null) return { ok: false, error: 'Reload the page and try again.' }
    return completeTask(ctx, id, version, '')
  }

  /*
   * Reopening. ⚠️ `outcome` IS CLEARED ALONGSIDE `completed_at`, and has to
   * be: 0126's `crm_tasks_outcome_only_when_completed` refuses an open task
   * that still carries an outcome, so a reopen that forgot it would fail
   * outright. The TASK_COMPLETED activity keeps the original outcome.
   *
   * No activity and no event, as before: the stream is append-only, and a
   * "reopened" event would not un-count the completion every report has
   * already read.
   */
  const restrict = assigneeRestriction(ctx)
  const db = createAdminClient()

  let reopen = db
    .from('crm_tasks')
    .update({ status: 'open', completed_at: null, completed_by: null, outcome: null })
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', id)
    .eq('status', 'completed')

  if (restrict) reopen = reopen.eq('assigned_to_user_id', restrict)

  const { data, error } = await reopen.select('id').maybeSingle()

  if (error) return { ok: false, error: 'Could not update that task.' }
  if (!data) return { ok: false, error: 'That task is not completed, or is not yours to change.' }

  revalidateTaskScreens()
  return { ok: true, message: 'Reopened.' }
}

/** Complete, with an optional outcome — §7 "completion with an outcome". */
export async function completeTaskAction(
  _previous: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.task.manage')
  } catch {
    return { ok: false, error: 'You do not have permission to change tasks.' }
  }

  const taskId = String(formData.get('taskId') ?? '')
  const version = readVersion(formData)
  if (!taskId || version === null) return { ok: false, error: 'Reload the page and try again.' }

  const outcome = String(formData.get('outcome') ?? '').trim()
  // Checked here for the message; the database enforces the same limit.
  if (outcome.length > OUTCOME_MAX) return { ok: false, error: REFUSAL_COPY.invalid_outcome }

  return completeTask(ctx, taskId, version, outcome)
}

/** Snooze until a review date — §7 "explicit snooze with a new review date". */
export async function snoozeTaskAction(
  _previous: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.task.manage')
  } catch {
    return { ok: false, error: 'You do not have permission to change tasks.' }
  }
  if (!ctx.userId) return { ok: false, error: 'Sign in again to change tasks.' }

  const taskId = String(formData.get('taskId') ?? '')
  const version = readVersion(formData)
  if (!taskId || version === null) return { ok: false, error: 'Reload the page and try again.' }

  /*
   * ⚠️ A DATE INPUT GIVES A DAY, READ AS THE START OF THAT DAY in the server's
   * timezone — the same rule `createTaskAction` applies to due dates (end of
   * day there), because no user or workspace timezone exists to read. The
   * task reappears when that day begins.
   */
  const raw = String(formData.get('until') ?? '')
  const until = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : null
  if (!until || Number.isNaN(until.getTime())) {
    return { ok: false, error: 'Pick a review date.' }
  }
  // Checked here for the message; the database enforces the same bounds.
  const now = Date.now()
  if (until.getTime() <= now || until.getTime() > now + SNOOZE_MAX_MS) {
    return { ok: false, error: REFUSAL_COPY.invalid_until }
  }

  const restrict = assigneeRestriction(ctx)
  const db = createAdminClient()
  const { data, error } = await db.rpc('crm_snooze_task', {
    p_workspace_id: ctx.workspace.id,
    p_task_id: taskId,
    p_actor_id: ctx.userId,
    p_until: until.toISOString(),
    p_expected_version: version,
    ...(restrict ? { p_restrict_to_assignee: restrict } : {}),
  })

  if (error) return { ok: false, error: 'Could not snooze that task.' }

  const result = data as TaskRpcResult
  if (!result.ok) return refusal(result, 'Could not snooze that task.')

  revalidateTaskScreens()
  return { ok: true, message: 'Snoozed.' }
}

/**
 * Hand a task to another member — §7 "reassignment where permitted".
 *
 * ⚠️ GATED ON `crm.contact.assign`, the manager permission, not on
 * `crm.task.manage`. A setter may finish or defer their own work; deciding who
 * ELSE does it is the same authority as deciding who owns a contact, and the
 * tasks page already treats that permission as "sees the whole workspace".
 */
export async function reassignTaskAction(
  _previous: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.contact.assign')
  } catch {
    return { ok: false, error: 'You do not have permission to reassign tasks.' }
  }
  if (!ctx.userId) return { ok: false, error: 'Sign in again to change tasks.' }

  const taskId = String(formData.get('taskId') ?? '')
  const version = readVersion(formData)
  if (!taskId || version === null) return { ok: false, error: 'Reload the page and try again.' }

  const assigneeId = String(formData.get('assigneeId') ?? '')
  if (!assigneeId) return { ok: false, error: REFUSAL_COPY.invalid_assignee }

  const db = createAdminClient()
  const { data, error } = await db.rpc('crm_reassign_task', {
    p_workspace_id: ctx.workspace.id,
    p_task_id: taskId,
    p_actor_id: ctx.userId,
    // Membership is checked by the function; an id from a form is a claim.
    p_new_assignee: assigneeId,
    p_expected_version: version,
  })

  if (error) return { ok: false, error: 'Could not reassign that task.' }

  const result = data as TaskRpcResult
  if (!result.ok) return refusal(result, 'Could not reassign that task.')

  revalidateTaskScreens()
  return {
    ok: true,
    message: result.changed ? 'Reassigned.' : 'It is already assigned to them.',
  }
}


// ---------------------------------------------------------------------------
// Creating a task — R2
//
// ⚠️ UNTIL NOW A TASK COULD ONLY ARRIVE FROM A FLOW. The tasks page listed and
// completed them and offered no way to make one, so the queue was empty for
// anyone who had not built an automation first.
// ---------------------------------------------------------------------------

export type CreateTaskState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

export async function createTaskAction(
  _previous: CreateTaskState,
  formData: FormData,
): Promise<CreateTaskState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.task.manage')
  } catch {
    return { ok: false, error: 'You do not have permission to create tasks.' }
  }

  const title = String(formData.get('title') ?? '').trim()
  if (!title) return { ok: false, error: 'Give the task a title.' }

  const contactId = String(formData.get('contactId') ?? '') || null
  const opportunityId = String(formData.get('opportunityId') ?? '') || null
  const dueAt = String(formData.get('dueAt') ?? '').trim() || null

  const db = createAdminClient()

  /*
   * ⚠️ A CONTACT ID FROM A FORM IS A CLAIM. The service role bypasses RLS, so
   * without this check a crafted request could attach a task to a contact in
   * another workspace and surface that contact's name in this one.
   */
  if (contactId) {
    const { data: contact } = await db
      .from('crm_contacts')
      .select('id')
      .eq('workspace_id', ctx.workspace.id)
      .eq('id', contactId)
      .maybeSingle()

    if (!contact) return { ok: false, error: 'That contact is not in this workspace.' }
  }

  /*
   * ⚠️ CHECKED IN CODE TOO, THOUGH 0124's COMPOSITE FK WOULD ALSO REFUSE IT.
   *
   * `(opportunity_id, workspace_id)` against `crm_opportunities (id,
   * workspace_id)` makes a cross-tenant link unrepresentable, so the database
   * is the real wall here. This check exists for the answer it gives: the FK
   * violation surfaces as "Could not create that task", which tells somebody
   * nothing, while this says which claim was rejected. Same reasoning as the
   * contact check above, which the FK also backstops.
   */
  if (opportunityId) {
    const { data: deal } = await db
      .from('crm_opportunities')
      .select('id')
      .eq('workspace_id', ctx.workspace.id)
      .eq('id', opportunityId)
      .is('deleted_at', null)
      .maybeSingle()

    if (!deal) return { ok: false, error: 'That deal is not in this workspace.' }
  }

  const { error } = await db.from('crm_tasks').insert({
    workspace_id: ctx.workspace.id,
    title,
    body: String(formData.get('body') ?? '').trim() || null,
    contact_id: contactId,
    opportunity_id: opportunityId,
    /*
     * Assigned to the creator by default. An unassigned task belongs to
     * nobody and is the kind that sits in a queue forever.
     */
    assigned_to_user_id: ctx.userId,
    // A date input gives a local day; storing it as end-of-day avoids a task
    // created for "today" reading as already overdue.
    due_at: dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : null,
    status: 'open',
    created_by: ctx.userId,
  })

  if (error) return { ok: false, error: 'Could not create that task.' }

  revalidatePath('/crm/tasks')
  revalidatePath('/dashboard')
  return { ok: true, message: 'Task created.' }
}
