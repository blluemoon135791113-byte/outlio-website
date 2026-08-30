import 'server-only'

/**
 * The Flow runtime — M7 Phase 20.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE ORDER OF OPERATIONS IS THE GUARANTEE, exactly as in the email send   ║
 * ║  worker (Ledger D36):                                                     ║
 * ║                                                                           ║
 * ║    1. CLAIM   — `flow_claim_step` inserts a unique row. If it returns     ║
 * ║                 false, another worker already owns this step and we must  ║
 * ║                 NOT perform it.                                           ║
 * ║    2. ACT     — the side effect runs at most once per claim.              ║
 * ║    3. RECORD  — the outcome is written to the same row.                   ║
 * ║                                                                           ║
 * ║  A worker killed between 2 and 3 leaves a `running` row. The retry claims ║
 * ║  and gets FALSE, so the action is not repeated — which is M7 criterion 1. ║
 * ║  The cost is that the step's OUTPUT is lost, so the run needs a human;    ║
 * ║  that is the same at-most-once trade the email engine makes, and for the  ║
 * ║  same reason: a duplicate action is worse than a stalled one.             ║
 * ║                                                                           ║
 * ║  ⚠️ NEVER re-claim a step in-process after an ambiguous failure.          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import {
  actionCostsCredits,
  validateFlowDefinition,
  type ActionType,
  type FlowDefinition,
  type FlowStep,
} from '@/lib/flows/definition'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'

/**
 * ⚠️ JSONB COLUMNS TAKE `Json`, NOT `Record<string, unknown>`. The generated
 * types are strict for a good reason: `unknown` would let a Date, a Map or a
 * class instance reach the column and serialise into something nobody can
 * query. Step input/output is deliberately narrow.
 */
type JsonObject = { [key: string]: Json | undefined }

export type FlowContext = {
  workspaceId: string
  runId: string
  contactId: string | null
  /** Values the branch conditions read. Populated per run. */
  facts: Record<string, unknown>
}

export type ActionResult =
  | { ok: true; output?: JsonObject; creditsUsed?: number }
  | { ok: false; code: string; message: string; retryable: boolean }

export type ActionHandler = (
  context: FlowContext,
  config: Record<string, unknown>,
) => Promise<ActionResult>


/**
 * ⚠️ AN ACTION WITH NO HANDLER IS ABSENT, NOT STUBBED. Email actions arrive in
 * Phase 21 and Hubble actions in Phase 22; until then `handlerFor` returns
 * undefined and the run fails with a clear, named reason rather than meeting a
 * placeholder that silently succeeds.
 */
const HANDLERS: Partial<Record<ActionType, ActionHandler>> = {}

export function registerAction(type: ActionType, handler: ActionHandler): void {
  HANDLERS[type] = handler
}

export function handlerFor(type: ActionType): ActionHandler | undefined {
  return HANDLERS[type]
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

type Condition = { field: string; operator: string; value?: unknown }

/**
 * Evaluates one branch condition.
 *
 * ⚠️ A MISSING FACT IS NOT AN ERROR AND IS NOT `false`-BY-ACCIDENT. `is_empty`
 * on an absent field is TRUE, which is what a human means by "if they have no
 * job title". Treating absence as a failure would send every contact down the
 * wrong branch the moment one field was unset.
 */
export function evaluateCondition(condition: Condition, facts: Record<string, unknown>): boolean {
  const actual = facts[condition.field]
  const expected = condition.value

  switch (condition.operator) {
    case 'is_empty':
      return actual === null || actual === undefined || actual === ''
    case 'is_not_empty':
      return !(actual === null || actual === undefined || actual === '')
    case 'equals':
      return actual === expected
    case 'not_equals':
      return actual !== expected
    case 'contains':
      return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase())
    case 'not_contains':
      return !String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase())
    case 'greater_than':
      return Number(actual) > Number(expected)
    case 'less_than':
      return Number(actual) < Number(expected)
    case 'in':
      return Array.isArray(expected) && expected.includes(actual)
    case 'not_in':
      return Array.isArray(expected) && !expected.includes(actual)
    default:
      /*
       * An unknown operator must not silently pass. A branch that always
       * takes the true path is worse than a stopped run, because it looks
       * like it worked.
       */
      return false
  }
}

export function evaluateBranch(
  conditions: Condition[],
  match: 'all' | 'any',
  facts: Record<string, unknown>,
): boolean {
  if (conditions.length === 0) return true
  return match === 'all'
    ? conditions.every((c) => evaluateCondition(c, facts))
    : conditions.some((c) => evaluateCondition(c, facts))
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export type StartRunInput = {
  workspaceId: string
  flowId: string
  triggerType: string
  contactId?: string | null
  /** Deterministic per trigger occurrence, so a redelivery makes one run. */
  idempotencyKey?: string | null
  parentRunId?: string | null
  chainDepth?: number
}

export type StartRunResult =
  | { started: true; runId: string }
  | { started: false; reason: 'not_published' | 'duplicate' | 'halted'; detail: string; runId?: string }

/**
 * Starts a run, after the safety checks.
 *
 * ⚠️ LOOP PROTECTION IS CHECKED BEFORE THE RUN IS CREATED, not after. Creating
 * the run first and halting it second would still let its first action fire on
 * a fast worker, which is exactly the runaway this prevents.
 */
export async function startRun(input: StartRunInput): Promise<StartRunResult> {
  const db = createAdminClient()

  const { data: flow, error } = await db
    .from('flows')
    .select('id, status, published_version_id')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.flowId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw new Error(`startRun failed: ${error.message}`)

  if (!flow?.published_version_id || flow.status !== 'published') {
    return {
      started: false,
      reason: 'not_published',
      detail: 'This flow is not published, so nothing is triggered by it yet.',
    }
  }

  const chainDepth = input.chainDepth ?? 0
  /*
   * ⚠️ NULL IS A LEGITIMATE CONTACT HERE — a scheduled or webhook trigger has
   * no contact, and `flow_check_loop_protection` handles that case explicitly
   * (it skips the per-contact limit and checks depth only). The generated
   * types cannot express that a `uuid` PARAMETER accepts null, so the cast
   * documents the gap rather than hiding it.
   */
  const { data: haltReason } = await db.rpc('flow_check_loop_protection', {
    p_flow_id: input.flowId,
    p_contact_id: (input.contactId ?? null) as unknown as string,
    p_chain_depth: chainDepth,
  })

  if (haltReason) {
    /*
     * ⚠️ THE HALT IS RECORDED, NOT JUST REFUSED. Criterion 2 requires the
     * reason to be surfaced, and a refusal that leaves no trace is invisible
     * to the customer wondering why their flow stopped firing.
     */
    const { data: halted } = await db
      .from('flow_runs')
      .insert({
        workspace_id: input.workspaceId,
        flow_id: input.flowId,
        version_id: flow.published_version_id,
        trigger_type: input.triggerType,
        contact_id: input.contactId ?? null,
        status: 'halted',
        halt_reason: haltReason,
        parent_run_id: input.parentRunId ?? null,
        chain_depth: chainDepth,
        finished_at: new Date().toISOString(),
      })
      .select('id')
      .maybeSingle()

    return { started: false, reason: 'halted', detail: haltReason, runId: halted?.id }
  }

  const { data: version } = await db
    .from('flow_versions')
    .select('definition')
    .eq('id', flow.published_version_id)
    .single()

  const definition = validateFlowDefinition(version!.definition)

  const { data: run, error: runError } = await db
    .from('flow_runs')
    .insert({
      workspace_id: input.workspaceId,
      flow_id: input.flowId,
      version_id: flow.published_version_id,
      trigger_type: input.triggerType,
      contact_id: input.contactId ?? null,
      current_step: definition.entryStepId,
      idempotency_key: input.idempotencyKey ?? null,
      parent_run_id: input.parentRunId ?? null,
      chain_depth: chainDepth,
    })
    .select('id')
    .single()

  if (runError) {
    // 23505 is the trigger-idempotency index: this event already started a run.
    if (runError.code === '23505') {
      return {
        started: false,
        reason: 'duplicate',
        detail: 'This trigger has already started a run for this event.',
      }
    }
    throw new Error(`startRun failed: ${runError.message}`)
  }

  return { started: true, runId: run.id }
}

export type AdvanceResult = {
  status: 'completed' | 'waiting' | 'failed' | 'running'
  stepsExecuted: number
  /** Set when the run stopped because a step failed. */
  error?: { stepId: string; code: string; message: string }
}

/**
 * Drives a run forward until it finishes, waits, or fails.
 *
 * ⚠️ BOUNDED BY `maxSteps` PER CALL. Even with the definition validator
 * rejecting waitless cycles, a runtime bound is the backstop that keeps a
 * pathological definition from occupying a worker indefinitely.
 */
export async function advanceRun(
  workspaceId: string,
  runId: string,
  maxSteps = 50,
): Promise<AdvanceResult> {
  const db = createAdminClient()
  let stepsExecuted = 0

  const { data: run, error } = await db
    .from('flow_runs')
    .select('id, flow_id, version_id, contact_id, current_step, status')
    .eq('workspace_id', workspaceId)
    .eq('id', runId)
    .single()

  if (error) throw new Error(`advanceRun failed: ${error.message}`)
  if (run.status !== 'running' && run.status !== 'waiting') {
    return { status: run.status as AdvanceResult['status'], stepsExecuted: 0 }
  }

  /*
   * ⚠️ THE DEFINITION COMES FROM THE RUN'S PINNED VERSION, never from the
   * flow's current pointer. This is criterion 3 at the point it actually
   * matters — one line away from being wrong.
   */
  const { data: version } = await db
    .from('flow_versions')
    .select('definition')
    .eq('id', run.version_id)
    .single()

  const definition = validateFlowDefinition(version!.definition)
  const byId = new Map(definition.steps.map((s) => [s.id, s]))
  const facts = await gatherFacts(workspaceId, run.contact_id)

  let currentStepId: string | null = run.current_step

  while (currentStepId && stepsExecuted < maxSteps) {
    const step: FlowStep | undefined = byId.get(currentStepId)
    if (!step) {
      await finish(db, runId, 'failed')
      return {
        status: 'failed',
        stepsExecuted,
        error: {
          stepId: currentStepId,
          code: 'STEP_MISSING',
          message: 'The flow refers to a step that is not in this version.',
        },
      }
    }

    // --- WAIT: park the run rather than sleeping a worker. ---
    if (step.type === 'WAIT') {
      const resumeAt = new Date(Date.now() + step.hours * 3_600_000).toISOString()
      await db
        .from('flow_runs')
        .update({ status: 'waiting', resume_at: resumeAt, current_step: step.next })
        .eq('id', runId)
      return { status: 'waiting', stepsExecuted }
    }

    // --- BRANCH: pure, no side effect, so no claim is needed. ---
    if (step.type === 'BRANCH') {
      const taken = evaluateBranch(step.conditions, step.match, facts)
      currentStepId = taken ? step.onTrue : step.onFalse
      stepsExecuted += 1
      continue
    }

    // --- ACTION: claim, act, record. ---
    const { data: claimed } = await db.rpc('flow_claim_step', {
      p_workspace_id: workspaceId,
      p_run_id: runId,
      p_step_id: step.id,
      p_step_type: step.action,
      // Cast at the boundary: the definition schema already guarantees this
      // is plain JSON, having come from JSONB in the first place.
      p_input: { config: step.config as Json },
    })

    if (!claimed) {
      /*
       * ⚠️ ALREADY DONE OR ALREADY IN FLIGHT — either way we must NOT repeat
       * it. Moving on is correct for a completed step; for one abandoned
       * mid-flight it means the run continues without that step's output,
       * which is the at-most-once cost and is visible in the log.
       */
      currentStepId = step.next
      stepsExecuted += 1
      continue
    }

    const startedAt = Date.now()
    const handler = handlerFor(step.action)

    const result: ActionResult = handler
      ? await handler({ workspaceId, runId, contactId: run.contact_id, facts }, step.config)
      : {
          ok: false,
          code: 'ACTION_NOT_AVAILABLE',
          message: `The "${step.action}" action is not available yet.`,
          retryable: false,
        }

    const duration = Date.now() - startedAt

    await db
      .from('flow_step_runs')
      .update({
        status: result.ok ? 'succeeded' : 'failed',
        output: result.ok ? ((result.output ?? {}) as Json) : {},
        error_code: result.ok ? null : result.code,
        error_message: result.ok ? null : result.message,
        credits_used: result.ok ? (result.creditsUsed ?? 0) : 0,
        finished_at: new Date().toISOString(),
        duration_ms: duration,
      })
      .eq('run_id', runId)
      .eq('step_id', step.id)

    stepsExecuted += 1

    if (!result.ok) {
      await finish(db, runId, 'failed')
      return {
        status: 'failed',
        stepsExecuted,
        error: { stepId: step.id, code: result.code, message: result.message },
      }
    }

    // A deterministic action must never report credits. Caught here rather
    // than trusted, because a handler is where that mistake would be made.
    if (!actionCostsCredits(step.action) && (result.creditsUsed ?? 0) > 0) {
      throw new Error(
        `Action ${step.action} is declared free but reported ${result.creditsUsed} credits.`,
      )
    }

    currentStepId = step.next
  }

  if (!currentStepId) {
    await finish(db, runId, 'completed')
    return { status: 'completed', stepsExecuted }
  }

  // Hit the per-call bound with work left; the next pass picks it up.
  await db.from('flow_runs').update({ current_step: currentStepId }).eq('id', runId)
  return { status: 'running', stepsExecuted }
}

async function finish(
  db: ReturnType<typeof createAdminClient>,
  runId: string,
  status: 'completed' | 'failed',
): Promise<void> {
  await db
    .from('flow_runs')
    .update({ status, current_step: null, resume_at: null, finished_at: new Date().toISOString() })
    .eq('id', runId)
}

/**
 * The facts a branch can read.
 *
 * ⚠️ READ ONCE PER RUN, not per condition. A branch evaluating against a
 * contact that changed mid-run would take inconsistent paths on adjacent
 * conditions, which is impossible to reason about after the fact.
 */
async function gatherFacts(
  workspaceId: string,
  contactId: string | null,
): Promise<Record<string, unknown>> {
  if (!contactId) return {}

  const { data } = await createAdminClient()
    .from('crm_contacts')
    .select('id, full_name, first_name, last_name, job_title, headline, location, owner_user_id, primary_company_id')
    .eq('workspace_id', workspaceId)
    .eq('id', contactId)
    .maybeSingle()

  if (!data) return {}

  return {
    'contact.full_name': data.full_name,
    'contact.first_name': data.first_name,
    'contact.last_name': data.last_name,
    'contact.job_title': data.job_title,
    'contact.headline': data.headline,
    'contact.location': data.location,
    'contact.owner_user_id': data.owner_user_id,
    'contact.company_id': data.primary_company_id,
  }
}

/** Runs that are due to wake up. */
export async function claimWaitingRuns(limit = 20): Promise<{ id: string; workspaceId: string }[]> {
  const { data } = await createAdminClient()
    .from('flow_runs')
    .select('id, workspace_id')
    .eq('status', 'waiting')
    .lte('resume_at', new Date().toISOString())
    .limit(limit)

  return (data ?? []).map((r) => ({ id: r.id, workspaceId: r.workspace_id }))
}
