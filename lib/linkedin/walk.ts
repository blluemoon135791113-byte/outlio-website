import 'server-only'

/**
 * Walking a campaign's workflow — Phase 20, the part that produces tasks.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ WALKING IS NOT SENDING, AND THE DISTINCTION IS THE PRODUCT.           ║
 * ║                                                                           ║
 * ║  Everything here schedules the ASKING. It creates a card that says what a  ║
 * ║  human should go and do in LinkedIn's own interface, and moves an          ║
 * ║  enrolment forward once they say they did it. Rule 1 is not worked around  ║
 * ║  — nothing in this file can reach linkedin.com, and no step exists that    ║
 * ║  would want to.                                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ AN ENROLMENT NEVER ADVANCES ITSELF PAST A HUMAN. `advance` is called after
 * an outcome is recorded — and `OUTCOME_UNKNOWN` counts as recorded, because
 * §4.17 already treats an unknown outcome as possibly delivered. Refusing to
 * advance on it would strand every enrolment whose operator was honest about not
 * knowing, which is precisely the honesty the outcome exists to make safe.
 *
 * ⚠️ IDEMPOTENCE IS THE DATABASE'S JOB. `linkedin_tasks.logical_action_id` is
 * `unique` (0125), and the key is workspace + enrolment + STEP ID + occurrence.
 * Two ticks racing on the same enrolment both try to insert; one gets 23505 and
 * treats it as success, because the task it wanted already exists. Nothing here
 * checks-then-inserts, because that is the pattern that produces a second
 * connection request to a stranger who already had one.
 */
import { contactIsStopped } from '@/lib/crm/contact-stop'
import { ensureTagAttached } from '@/lib/crm/tags'
import { resolveBody, type ContactValues } from '@/lib/linkedin/placeholders'
import { producesTask, taskKindFor } from '@/lib/linkedin/steps'
import { nextStep, type WorkflowStep } from '@/lib/linkedin/workflow'
import { getWorkflow } from '@/lib/linkedin/workflow-store'
import { createAdminClient } from '@/lib/supabase/admin'

/** Postgres unique-violation — here it means "that task already exists". */
const UNIQUE_VIOLATION = '23505'

/**
 * §4.17's stable key. Identical to `enroll.ts`, including what it omits.
 *
 * ⚠️ THE ATTEMPT NUMBER IS DELIBERATELY ABSENT. Including it would make a retry
 * a new logical action, which could duplicate a real external effect — a second
 * connection request to somebody who already received one.
 */
function logicalActionId(input: {
  workspaceId: string
  enrollmentId: string
  stepId: string
  occurrence: number
}): string {
  return `${input.workspaceId}:${input.enrollmentId}:${input.stepId}:${input.occurrence}`
}

export type AdvanceResult =
  | { kind: 'task_created'; taskId: string; stepId: string }
  | { kind: 'waiting'; until: string; stepId: string }
  | { kind: 'finished' }
  | { kind: 'stopped'; because: string }
  | { kind: 'orphaned' }
  | { kind: 'failed'; message: string }

type ContactRow = {
  id: string
  full_name: string | null
  first_name: string | null
  location: string | null
  version: number
}

/**
 * Moves one enrolment onto a given step, performing internal steps as it goes.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ IT LOOPS, BECAUSE INTERNAL STEPS DO NOT STOP THE WALK. `ADD_TAG` runs ║
 * ║  inside Outlio and completes instantly, so an enrolment landing on one     ║
 * ║  must keep going or it would sit on a finished step forever. `WAIT` is the ║
 * ║  one internal step that DOES stop it — that is its entire purpose.        ║
 * ║                                                                           ║
 * ║  ⚠️ AND THE LOOP IS BOUNDED. `MAX_STEPS` is 40, so a walk cannot exceed   ║
 * ║  that many hops; without the bound, a workflow that somehow cycled would   ║
 * ║  spin inside a worker tick rather than fail. Linear workflows cannot       ║
 * ║  cycle today — the bound is for the branching version that can.           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
async function walkFrom(input: {
  workspaceId: string
  enrollmentId: string
  contact: ContactRow
  senderId: string
  steps: readonly WorkflowStep[]
  from: WorkflowStep
}): Promise<AdvanceResult> {
  const db = createAdminClient()
  let current: WorkflowStep | null = input.from

  for (let hop = 0; hop < input.steps.length + 1 && current; hop += 1) {
    const step: WorkflowStep = current

    // ---- a wait stops the walk -------------------------------------------
    if (step.action === 'WAIT') {
      const until = new Date(Date.now() + (step.waitDays ?? 1) * 86_400_000).toISOString()
      const { error } = await db
        .from('linkedin_enrollments')
        .update({
          current_step_id: step.id,
          next_step_due_at: until,
          state: 'RUNNING',
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', input.workspaceId)
        .eq('id', input.enrollmentId)

      if (error) return { kind: 'failed', message: error.message }
      return { kind: 'waiting', until, stepId: step.id }
    }

    // ---- an internal step runs now, then the walk continues ---------------
    if (!producesTask(step.action)) {
      if (step.action === 'ADD_TAG') {
        const tag = typeof step.config?.tag === 'string' ? step.config.tag : ''
        const tagged = await ensureTagAttached({
          workspaceId: input.workspaceId,
          contactId: input.contact.id,
          name: tag,
        })
        /*
         * ⚠️ A FAILED TAG STOPS THE WALK RATHER THAN BEING SKIPPED. The customer
         * put the step there; a tag silently not applied is a segment that
         * quietly excludes people, and segments decide who gets messaged next.
         * 0132's CHECK makes the "no tag configured" case unstorable, so
         * reaching here means a genuine write failure worth retrying.
         */
        if (!tagged.ok) return { kind: 'failed', message: tagged.message }
      }

      const after = nextStep(input.steps, step.id)
      if (after.kind === 'deleted') return { kind: 'orphaned' }
      if (after.kind === 'end') return finish(input.workspaceId, input.enrollmentId)
      current = after.step
      continue
    }

    // ---- a step a human must perform --------------------------------------
    return createTaskFor({ ...input, step })
  }

  return { kind: 'failed', message: 'This workflow did not terminate.' }
}

/**
 * Writes the card for one step.
 *
 * ⚠️ THE BODY IS RESOLVED PER CONTACT, AND A MISSING VALUE LEAVES IT NULL
 * RATHER THAN RENDERING A GAP. `placeholders.ts` states the rule: "I loved what
 * you're building at " is not a degraded message, it tells the recipient they
 * were mail-merged.
 *
 * ⚠️ THE TASK IS STILL CREATED. Refusing to create it would strand the enrolment
 * on a step nobody can see, and the operator — who can read the profile in front
 * of them — is exactly the person able to fix the record or write the line
 * themselves. `lib/linkedin/task-body.ts` re-derives what is missing at render,
 * so the card's explanation cannot go stale after they fix the contact.
 */
async function createTaskFor(input: {
  workspaceId: string
  enrollmentId: string
  contact: ContactRow
  senderId: string
  steps: readonly WorkflowStep[]
  step: WorkflowStep
}): Promise<AdvanceResult> {
  const db = createAdminClient()
  const kind = taskKindFor(input.step.action)
  if (!kind) return { kind: 'failed', message: 'That step creates no task.' }

  let body: string | null = null
  if (input.step.body) {
    const resolved = resolveBody(input.step.body, contactValues(input.contact))
    body = resolved.ok ? resolved.text : null
  }

  const { data, error } = await db
    .from('linkedin_tasks')
    .insert({
      workspace_id: input.workspaceId,
      enrollment_id: input.enrollmentId,
      contact_id: input.contact.id,
      sender_id: input.senderId,
      step_id: input.step.id,
      kind,
      state: 'PENDING',
      // ⚠️ The version the content was approved AT — §4.7's durable cancellation
      // compares against it and refuses when the contact has moved since.
      approved_at_contact_version: input.contact.version,
      body,
      logical_action_id: logicalActionId({
        workspaceId: input.workspaceId,
        enrollmentId: input.enrollmentId,
        stepId: input.step.id,
        occurrence: 1,
      }),
    })
    .select('id')
    .single()

  if (error) {
    /*
     * ⚠️ A DUPLICATE IS SUCCESS. Two ticks raced and the other one won; the card
     * this call wanted to exist does exist. Treating it as an error would have
     * the loser retry forever, and treating it as a reason to create a DIFFERENT
     * task would send a stranger a second connection request.
     */
    if (error.code === UNIQUE_VIOLATION) {
      const existing = await db
        .from('linkedin_tasks')
        .select('id')
        .eq('workspace_id', input.workspaceId)
        .eq('enrollment_id', input.enrollmentId)
        .eq('step_id', input.step.id)
        .maybeSingle()
      if (existing.data) {
        await pointAt(input.workspaceId, input.enrollmentId, input.step.id)
        return { kind: 'task_created', taskId: existing.data.id, stepId: input.step.id }
      }
    }
    return { kind: 'failed', message: error.message }
  }

  const moved = await pointAt(input.workspaceId, input.enrollmentId, input.step.id)
  if (!moved) return { kind: 'failed', message: 'Could not move this person onto the step.' }

  return { kind: 'task_created', taskId: data.id, stepId: input.step.id }
}

/**
 * ⚠️ `next_step_due_at` IS CLEARED, NOT LEFT. It is the due-date for a WAIT, and
 * an enrolment now standing on a task step is not waiting on a clock — it is
 * waiting on a person. A stale timestamp here would have `releaseDue` pick the
 * enrolment up again and try to walk past a task nobody has done.
 */
async function pointAt(
  workspaceId: string,
  enrollmentId: string,
  stepId: string,
): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('linkedin_enrollments')
    .update({
      current_step_id: stepId,
      next_step_due_at: null,
      state: 'RUNNING',
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', enrollmentId)
    .select('id')

  return !error && (data ?? []).length > 0
}

async function finish(workspaceId: string, enrollmentId: string): Promise<AdvanceResult> {
  /*
   * ⚠️ `COMPLETED` WITH `NO_REPLY`, NOT `GOAL_MET`. `reasonMeansSuccess` treats
   * only `GOAL_MET` as success, and reaching the end of a workflow is not
   * success — it means every step was performed and nothing came back. §4.18
   * keeps qualified conversations and held meetings as separate denominators
   * precisely so a wall of completed sequences cannot be read as things working.
   */
  const { error } = await createAdminClient()
    .from('linkedin_enrollments')
    .update({
      state: 'COMPLETED',
      terminal_reason: 'NO_REPLY',
      current_step_id: null,
      next_step_due_at: null,
      ended_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', enrollmentId)

  if (error) return { kind: 'failed', message: error.message }
  return { kind: 'finished' }
}

/**
 * The three placeholder values for one contact, with their evidence.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ `first_name` IS ONLY OFFERED WHEN THE COLUMN HOLDS ONE. It is NEVER   ║
 * ║  SPLIT OUT OF `full_name` HERE.                                           ║
 * ║                                                                           ║
 * ║  `crm_contacts.first_name` is written by `normalizePersonName`, which had ║
 * ║  the whole record in front of it. Deriving one at render from whatever    ║
 * ║  `full_name` happens to contain is the inference that produces "Hi Van"   ║
 * ║  for "Van der Berg" — and `buildLinkedInContext` already refuses to do it. ║
 * ║  A second, more permissive answer here would quietly overrule that.       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ COMPANY COMES FROM THE RELATIONSHIP, NOT FROM A STRING ON THE CONTACT.
 * `primary_company_id` is resolved by the caller, because a name typed into a
 * lead row and a company record the CRM actually holds are different degrees of
 * evidence and `placeholders.ts` ranks them differently.
 */
function contactValues(contact: ContactRow & { company_name?: string | null }): ContactValues {
  return {
    first_name: contact.first_name
      ? { value: contact.first_name, verification: 'VERIFIED' }
      : null,
    company: contact.company_name
      ? { value: contact.company_name, verification: 'USER_RECORDED' }
      : null,
    location: contact.location
      ? { value: contact.location, verification: 'USER_RECORDED' }
      : null,
  }
}

/**
 * Puts a contact into a campaign, at the first step or one the customer chose.
 *
 * ⚠️ ENTRY AT ANY STEP IS THE OWNER'S REQUIREMENT ("people can entre at diff
 * points"), and it must NOT backfill. Somebody entering at step five has not had
 * steps one to four done to them, and creating those tasks would ask an operator
 * to send a first message to a person who is already mid-conversation.
 */
export async function enrollInCampaign(input: {
  workspaceId: string
  campaignId: string
  contactId: string
  senderId: string
  /** Defaults to the first step. */
  startStepId?: string | null
}): Promise<AdvanceResult & { enrollmentId?: string }> {
  const db = createAdminClient()

  /*
   * ⚠️ THE STOP CHECK COMES FIRST, THROUGH THE ONE PREDICATE. `contactIsStopped`
   * fails closed and honours the LinkedIn scope exactly — somebody who said
   * "stop emailing me" has not said "stop connecting".
   */
  const stop = await contactIsStopped({
    workspaceId: input.workspaceId,
    channel: 'linkedin',
    contactId: input.contactId,
  })
  if (stop.stopped) {
    return { kind: 'stopped', because: 'This contact is marked do-not-contact.' }
  }

  const steps = await getWorkflow(input.workspaceId, input.campaignId)
  if (steps.length === 0) {
    return { kind: 'failed', message: 'This campaign has no workflow yet.' }
  }

  const start = input.startStepId
    ? steps.find((step) => step.id === input.startStepId)
    : steps[0]
  if (!start) return { kind: 'failed', message: 'That step is not in this campaign.' }

  const contact = await loadContact(input.workspaceId, input.contactId)
  if (!contact) return { kind: 'failed', message: 'That contact is not in this workspace.' }

  const { data: enrollment, error } = await db
    .from('linkedin_enrollments')
    .insert({
      workspace_id: input.workspaceId,
      campaign_id: input.campaignId,
      contact_id: input.contactId,
      sender_id: input.senderId,
      state: 'READY',
      /*
       * ⚠️ `entry_step_id` IS SET ONCE HERE AND NEVER UPDATED. `current_step_id`
       * stops answering "where did they come in" the moment they advance, and
       * that comparison is what the DM analysis will need.
       */
      entry_step_id: start.id,
      current_step_id: start.id,
    })
    .select('id')
    .single()

  if (error || !enrollment) {
    /*
     * ⚠️ THE UNIQUE INDEX IS THE CONTROL, NOT A PRIOR LOOKUP. Two people
     * enrolling the same contact at once both pass a check-then-insert; only
     * 0125's partial index can refuse the second.
     */
    return {
      kind: 'failed',
      message:
        error?.code === UNIQUE_VIOLATION
          ? 'This contact is already in a LinkedIn sequence.'
          : 'That enrolment could not be started.',
    }
  }

  const walked = await walkFrom({
    workspaceId: input.workspaceId,
    enrollmentId: enrollment.id,
    contact,
    senderId: input.senderId,
    steps,
    from: start,
  })

  return { ...walked, enrollmentId: enrollment.id }
}

/**
 * Moves an enrolment on after its current task was resolved.
 *
 * ⚠️ CALLED BY `recordOutcome`, NOT BY THE TICK. The enrolment is waiting on a
 * person, and the moment that changes is the moment they answer — a worker
 * polling for "tasks that were completed" would do the same work minutes later
 * and for no reason.
 */
export async function advanceAfterTask(input: {
  workspaceId: string
  enrollmentId: string
}): Promise<AdvanceResult> {
  const db = createAdminClient()

  const { data: enrollment } = await db
    .from('linkedin_enrollments')
    .select('id, contact_id, sender_id, campaign_id, current_step_id, state')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.enrollmentId)
    .maybeSingle()

  if (!enrollment) return { kind: 'failed', message: 'That enrolment is not in this workspace.' }

  /*
   * ⚠️ A TERMINAL ENROLMENT IS NOT ADVANCED, AND IT IS NOT AN ERROR EITHER.
   * `enrollment.ts` already decides what a late event means: recorded for
   * review, never replayed. Advancing one would restart outreach at somebody who
   * replied, was marked not-interested, or asked not to be contacted.
   */
  if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(enrollment.state)) {
    return { kind: 'finished' }
  }

  // Not in a campaign: a Phase 10 enrolment, which has no workflow to walk.
  if (!enrollment.campaign_id || !enrollment.current_step_id) {
    return { kind: 'finished' }
  }

  const steps = await getWorkflow(input.workspaceId, enrollment.campaign_id)
  const after = nextStep(steps, enrollment.current_step_id)

  if (after.kind === 'deleted') {
    /*
     * ⚠️ THE STEP THEY STOOD ON IS GONE. 0130's `on delete restrict` is supposed
     * to make this impossible, so reaching it means the row was removed some
     * other way. It is reported rather than guessed at: advancing skips a
     * message the customer meant them to get, and ending drops a live
     * conversation.
     */
    return { kind: 'orphaned' }
  }
  if (after.kind === 'end') return finish(input.workspaceId, input.enrollmentId)

  const contact = await loadContact(input.workspaceId, enrollment.contact_id)
  if (!contact) return { kind: 'failed', message: 'That contact is no longer available.' }

  /*
   * ⚠️ RE-CHECKED AT EVERY HOP, NOT ONLY AT ENROLMENT. Days pass between steps,
   * and a person who asked not to be contacted after step two must not receive
   * step three. This is the check the whole sequence exists to keep honouring.
   */
  const stop = await contactIsStopped({
    workspaceId: input.workspaceId,
    channel: 'linkedin',
    contactId: enrollment.contact_id,
  })
  if (stop.stopped) {
    await createAdminClient()
      .from('linkedin_enrollments')
      .update({
        state: 'CANCELLED',
        terminal_reason: 'DNC',
        current_step_id: null,
        next_step_due_at: null,
        ended_at: new Date().toISOString(),
      })
      .eq('workspace_id', input.workspaceId)
      .eq('id', input.enrollmentId)
    return { kind: 'stopped', because: 'This contact was marked do-not-contact.' }
  }

  return walkFrom({
    workspaceId: input.workspaceId,
    enrollmentId: input.enrollmentId,
    contact,
    senderId: enrollment.sender_id,
    steps,
    from: after.step,
  })
}

export type ReleaseDueOutcome = {
  considered: number
  advanced: number
  failed: number
}

/**
 * Releases enrolments whose wait has elapsed. The worker's only LinkedIn job.
 *
 * ⚠️ IT ADVANCES WAITS AND NOTHING ELSE. Every other transition is driven by a
 * person recording an outcome. A worker that also chased task steps would be
 * asking "has somebody done this yet" on a schedule, which is what the Action
 * Inbox is for.
 */
export async function releaseDue(limit: number): Promise<ReleaseDueOutcome> {
  const db = createAdminClient()

  const { data, error } = await db
    .from('linkedin_enrollments')
    .select('id, workspace_id')
    .not('current_step_id', 'is', null)
    .not('next_step_due_at', 'is', null)
    .lte('next_step_due_at', new Date().toISOString())
    .in('state', ['READY', 'RUNNING'])
    /*
     * ⚠️ OLDEST FIRST. A campaign that enrols faster than its caps allow would
     * otherwise starve its earliest people indefinitely, and those are the ones
     * furthest into a sequence — the conversations most worth finishing.
     */
    .order('next_step_due_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`releaseDue failed: ${error.message}`)

  const rows = data ?? []
  let advanced = 0
  let failed = 0

  for (const row of rows) {
    /*
     * ⚠️ ONE ENROLMENT'S FAILURE MUST NOT STOP THE TICK. `runTick` runs every
     * five minutes for every workspace; a single bad row throwing here would
     * hold up everybody else's sequences until somebody noticed.
     */
    try {
      const result = await advanceFromWait(row.workspace_id, row.id)
      if (result.kind === 'failed' || result.kind === 'orphaned') failed += 1
      else advanced += 1
    } catch (error) {
      failed += 1
      console.error('linkedin releaseDue failed', {
        enrollmentId: row.id,
        error: error instanceof Error ? error.message : 'unknown',
      })
    }
  }

  return { considered: rows.length, advanced, failed }
}

/**
 * ⚠️ IT CLEARS `next_step_due_at` BEFORE WALKING, AND THAT CLAIM IS THE LOCK.
 *
 * Two ticks overlapping would otherwise both see the same due enrolment and both
 * walk it. The task insert's unique key would stop a duplicate CARD, but an
 * `ADD_TAG` step has no such key and would be applied twice — harmless for a
 * tag, not harmless as a pattern.
 *
 * The update is conditional on the row still being due, so only one tick's
 * update matches and the loser walks nothing.
 */
async function advanceFromWait(workspaceId: string, enrollmentId: string): Promise<AdvanceResult> {
  const { data, error } = await createAdminClient()
    .from('linkedin_enrollments')
    .update({ next_step_due_at: null, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', enrollmentId)
    .not('next_step_due_at', 'is', null)
    .lte('next_step_due_at', new Date().toISOString())
    .select('id')

  if (error) return { kind: 'failed', message: error.message }
  // Another tick claimed it. Not an error, and not work to redo.
  if ((data ?? []).length === 0) return { kind: 'finished' }

  return advanceAfterTask({ workspaceId, enrollmentId })
}

async function loadContact(
  workspaceId: string,
  contactId: string,
): Promise<(ContactRow & { company_name: string | null }) | null> {
  const { data } = await createAdminClient()
    .from('crm_contacts')
    .select('id, full_name, first_name, location, version, primary_company_id')
    // Service role bypasses RLS — scoping by workspace is mandatory.
    .eq('workspace_id', workspaceId)
    .eq('id', contactId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!data) return null

  let companyName: string | null = null
  if (data.primary_company_id) {
    const company = await createAdminClient()
      .from('crm_companies')
      .select('name')
      .eq('workspace_id', workspaceId)
      .eq('id', data.primary_company_id)
      .maybeSingle()
    companyName = company.data?.name ?? null
  }

  return {
    id: data.id,
    full_name: data.full_name,
    first_name: data.first_name,
    location: data.location,
    version: data.version,
    company_name: companyName,
  }
}
