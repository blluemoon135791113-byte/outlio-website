import 'server-only'

/**
 * The LinkedIn release pipeline — where seven pure modules meet the database.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ NOTHING HERE PERFORMS A LINKEDIN ACTION, AND NOTHING EVER WILL.       ║
 * ║                                                                           ║
 * ║  CLAUDE.md rule 1: no requests to linkedin.com, no automated navigation.   ║
 * ║  A task is a CARD telling a person what to do in LinkedIn themselves, and  ║
 * ║  an outcome is that person afterwards saying what they did. Every verb in  ║
 * ║  this file is about Outlio's own records.                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THE LEDGER WRITE IS WHAT MAKES BUDGETS REAL. `linkedin_sender_used()`
 * counts rows in `linkedin_sender_actions`, and until this file existed nothing
 * wrote any — so every budget on the settings page read as the full stage cap
 * and could not fall. `tests/unit/linkedin-senders.test.ts` asserts that gap and
 * will now fail, which is the correct way for it to end.
 */
import {
  budgetKindForTask,
  senderBudget,
} from '@/lib/linkedin/senders'
import {
  isAllowedOutcome,
  releasesQuota,
  requiresReason,
  isObservation,
  type TaskKind,
  type TaskOutcome,
} from '@/lib/linkedin/outcomes'
import {
  preflight,
  refusalMessage,
  DEFAULT_THREAD_CHECK_MAX_AGE_MS,
  type PreflightRefusal,
  type SenderCondition,
} from '@/lib/linkedin/preflight'
import { contactIsStopped } from '@/lib/crm/contact-stop'
import { advanceAfterTask } from '@/lib/linkedin/walk'
import { createAdminClient } from '@/lib/supabase/admin'

export type ReleaseResult =
  | { released: true }
  | { released: false; refusal: PreflightRefusal | 'not_found'; message: string }

/**
 * Maps a sender row's status to the condition `preflight` reasons about.
 *
 * ⚠️ `limit_reached` IS DERIVED, NEVER STORED — 0122 says why: it is true at
 * 16:00 and false at midnight with nothing written, so a stored value would
 * need a job to clear it and a window where a sender is wrongly frozen because
 * that job did not run.
 */
function senderConditionOf(status: string, budgetRemaining: number): SenderCondition {
  switch (status) {
    case 'warning':
      return 'warning'
    case 'restricted':
      return 'restricted'
    case 'paused':
      return 'paused'
    case 'disconnected':
    case 'auth_expired':
      return 'disconnected'
    default:
      return budgetRemaining <= 0 ? 'limit_reached' : 'ok'
  }
}

/**
 * Asks whether a prepared task may be shown as actionable, and reserves its
 * quota slot if so.
 *
 * ⚠️ THE RESERVATION HAPPENS AT RELEASE, NOT AT COMPLETION. §4.10's budget is a
 * count over the ledger including `reserved` rows, so a card sitting in
 * somebody's inbox already holds its slot. Reserving only on completion would
 * let a day's worth of cards be released against a cap of twenty.
 */
export async function releaseTask(input: {
  workspaceId: string
  taskId: string
  now?: Date
}): Promise<ReleaseResult> {
  const db = createAdminClient()
  const now = input.now ?? new Date()

  const { data: task } = await db
    .from('linkedin_tasks')
    .select(
      'id, kind, state, contact_id, sender_id, enrollment_id, approved_at_contact_version, last_thread_check_at, logical_action_id',
    )
    // Service role bypasses RLS — scoping by workspace is mandatory.
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.taskId)
    .maybeSingle()

  if (!task || task.state !== 'PENDING') {
    return { released: false, refusal: 'not_found', message: 'That task is not awaiting release.' }
  }

  const [{ data: contact }, { data: sender }] = await Promise.all([
    db.from('crm_contacts').select('version').eq('id', task.contact_id).maybeSingle(),
    db.from('linkedin_senders').select('status, stage').eq('id', task.sender_id).maybeSingle(),
  ])

  /*
   * ⚠️ A MISSING CONTACT OR SENDER REFUSES, rather than defaulting. Both are
   * inputs to a permission decision, and "we could not read it" is not
   * permission — the same asymmetry `contactIsStopped` runs on.
   */
  if (!contact || !sender) {
    return { released: false, refusal: 'not_found', message: 'That task is not actionable.' }
  }

  const kind = task.kind as TaskKind
  const budget = await senderBudget(task.sender_id, budgetKindForTask(kind), {
    stage: sender.stage,
    externalReservePerDay: 0,
    customerDailyCap: null,
  })

  const stop = await contactIsStopped({
    workspaceId: input.workspaceId,
    channel: 'linkedin',
    contactId: task.contact_id,
  })

  const verdict = preflight({
    channel: 'linkedin',
    stage: 'release',
    approvedAtContactVersion: task.approved_at_contact_version,
    currentContactVersion: contact.version,
    contactStopped: stop.stopped,
    senderCondition: senderConditionOf(sender.status, budget.remaining),
    lastThreadCheckAt: task.last_thread_check_at ? new Date(task.last_thread_check_at) : null,
    threadCheckMaxAgeMs: DEFAULT_THREAD_CHECK_MAX_AGE_MS,
    now,
  })

  if (!verdict.ok) {
    return { released: false, refusal: verdict.refusal, message: refusalMessage(verdict.refusal) }
  }

  /*
   * ⚠️ THE LEDGER ROW IS WRITTEN BEFORE THE TASK MOVES. If the reservation
   * fails, the task stays PENDING and can be released again; if the order were
   * reversed, a released card could hold no slot and the cap would leak.
   *
   * `logical_action_id` is unique in 0122, so a double release is refused by
   * the database rather than by remembering to check.
   */
  const { error: ledgerError } = await db.from('linkedin_sender_actions').insert({
    sender_id: task.sender_id,
    workspace_id: input.workspaceId,
    contact_id: task.contact_id,
    kind: budgetKindForTask(kind),
    lifecycle: 'reserved',
    logical_action_id: task.logical_action_id,
  })

  if (ledgerError) {
    console.error('linkedin reservation failed', { taskId: task.id, error: ledgerError })
    return {
      released: false,
      refusal: 'not_found',
      message: 'That task could not be released. Try again.',
    }
  }

  const { error } = await db
    .from('linkedin_tasks')
    .update({ state: 'RELEASED', released_at: now.toISOString() })
    .eq('workspace_id', input.workspaceId)
    .eq('id', task.id)
    .eq('state', 'PENDING')

  if (error) {
    console.error('linkedin release failed after reservation', { taskId: task.id })
    return { released: false, refusal: 'not_found', message: 'That task could not be released.' }
  }

  return { released: true }
}

export type OutcomeResult = { ok: true } | { ok: false; error: string }

/**
 * Records what a person did with a released task.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ AN OUTCOME IS NOT AN OBSERVATION, AND THIS REFUSES ONE EXPLICITLY.    ║
 * ║                                                                           ║
 * ║  §4.13: "'Mark request sent' cannot mark acceptance." `TaskOutcome` is     ║
 * ║  what the operator DID; an `Observation` is what was later seen to happen  ║
 * ║  and belongs to the contact, not to the completion of a task. Collapsing   ║
 * ║  them sends a message into a connection that was never made.              ║
 * ║                                                                           ║
 * ║  0132's enum rejects an Observation too. Both, because a constraint says   ║
 * ║  what the database will store and this says what the product means.       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export async function recordOutcome(input: {
  workspaceId: string
  taskId: string
  outcome: string
  reason?: string | null
  actorUserId: string
  now?: Date
}): Promise<OutcomeResult> {
  const db = createAdminClient()
  const now = input.now ?? new Date()

  if (isObservation(input.outcome)) {
    return {
      ok: false,
      error: 'That is something you observed later, not what you did with this task.',
    }
  }

  const { data: task } = await db
    .from('linkedin_tasks')
    .select('id, kind, state, sender_id, logical_action_id, enrollment_id')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.taskId)
    .maybeSingle()

  if (!task) return { ok: false, error: 'That task could not be found.' }
  if (task.state !== 'RELEASED') {
    return { ok: false, error: 'That task is not awaiting a result.' }
  }

  const kind = task.kind as TaskKind
  if (!isAllowedOutcome(kind, input.outcome)) {
    return { ok: false, error: 'That is not a result this task can have.' }
  }
  const outcome = input.outcome as TaskOutcome

  const reason = input.reason?.trim() || null
  if (requiresReason(outcome) && !reason) {
    return { ok: false, error: 'Say what happened, so the next person is not guessing.' }
  }

  /*
   * ⚠️ THE LEDGER MOVES FIRST, AND `OUTCOME_UNKNOWN` KEEPS ITS SLOT. §4.17: an
   * action we cannot rule out having happened has to keep counting, because the
   * cost of being wrong is a restriction on somebody's real account. Only a
   * definite non-action — skipped or failed — gives the slot back.
   */
  const lifecycle = releasesQuota(outcome) ? 'skipped' : outcome === 'OUTCOME_UNKNOWN' ? 'unknown' : 'performed'

  const { error: ledgerError } = await db
    .from('linkedin_sender_actions')
    .update({
      lifecycle,
      // ⚠️ When the owner says it HAPPENED, not when the card was made.
      occurred_at: lifecycle === 'performed' ? now.toISOString() : null,
      resolved_at: now.toISOString(),
      resolution_note: reason,
    })
    .eq('logical_action_id', task.logical_action_id)

  if (ledgerError) {
    console.error('linkedin ledger update failed', { taskId: task.id, error: ledgerError })
    return { ok: false, error: 'That result could not be recorded. Try again.' }
  }

  const { error } = await db
    .from('linkedin_tasks')
    .update({
      state: 'COMPLETED',
      outcome,
      skip_reason: reason,
      completed_at: now.toISOString(),
      completed_by: input.actorUserId,
    })
    .eq('workspace_id', input.workspaceId)
    .eq('id', task.id)
    .eq('state', 'RELEASED')

  if (error) {
    console.error('linkedin outcome write failed', { taskId: task.id })
    return { ok: false, error: 'That result could not be recorded.' }
  }

  /*
   * ╔═══════════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ THE SEQUENCE MOVES HERE, AFTER THE OUTCOME IS DURABLE — AND A FAILURE ║
   * ║  TO MOVE MUST NOT UNDO IT.                                                ║
   * ║                                                                           ║
   * ║  The operator has already performed a real action against a real person.   ║
   * ║  Returning an error now would invite them to record it again, which is     ║
   * ║  how one connection request becomes two. The outcome is the fact; the      ║
   * ║  next card is a consequence, and a missing consequence is recoverable      ║
   * ║  (the worker picks the enrolment up) while a duplicated action is not.    ║
   * ║                                                                           ║
   * ║  ⚠️ IT IS ALSO NOT DONE BY THE TICK. The enrolment is waiting on a person, ║
   * ║  and the moment that changes is the moment they answer. A worker polling   ║
   * ║  for completed tasks would do the same work minutes later for no reason.  ║
   * ╚═══════════════════════════════════════════════════════════════════════════╝
   *
   * ⚠️ AND IT ADVANCES ON `OUTCOME_UNKNOWN` TOO. §4.17 already treats an unknown
   * outcome as possibly delivered; refusing to advance on it would strand every
   * enrolment whose operator was honest about not knowing, punishing exactly the
   * answer the vocabulary exists to make safe.
   */
  try {
    const walked = await advanceAfterTask({
      workspaceId: input.workspaceId,
      enrollmentId: task.enrollment_id,
    })
    if (walked.kind === 'failed' || walked.kind === 'orphaned') {
      console.error('linkedin advance after outcome failed', {
        enrollmentId: task.enrollment_id,
        kind: walked.kind,
      })
    }
  } catch (advanceError) {
    console.error('linkedin advance after outcome threw', {
      enrollmentId: task.enrollment_id,
      error: advanceError instanceof Error ? advanceError.message : 'unknown',
    })
  }

  return { ok: true }
}

export type InboxTask = {
  id: string
  kind: TaskKind
  state: 'PENDING' | 'RELEASED'
  contactId: string
  contactName: string | null
  body: string | null
  createdAt: string
}

/**
 * The Action Inbox — §4.13.
 *
 * ⚠️ PENDING AND RELEASED BOTH APPEAR, and they are not the same thing. A
 * PENDING card has not passed preflight yet; a RELEASED one holds a quota slot
 * and is waiting on a person. Showing only the second would hide work that is
 * being held back and make the queue look emptier than it is.
 */
export async function listInbox(workspaceId: string, limit = 100): Promise<InboxTask[]> {
  const { data, error } = await createAdminClient()
    .from('linkedin_tasks')
    .select('id, kind, state, contact_id, body, created_at, crm_contacts!inner(full_name)')
    .eq('workspace_id', workspaceId)
    .in('state', ['PENDING', 'RELEASED'])
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`listInbox failed: ${error.message}`)

  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind as TaskKind,
    state: row.state as 'PENDING' | 'RELEASED',
    contactId: row.contact_id,
    contactName: row.crm_contacts?.full_name ?? null,
    body: row.body,
    createdAt: row.created_at,
  }))
}
