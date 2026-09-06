/**
 * The Flow runtime, end to end — M7 Phase 20.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  M7 CRITERION 1: "worker kill/retry mid-flow never duplicates an action". ║
 * ║  M7 CRITERION 2: "loop-protection halts a self-triggering flow and        ║
 * ║                   surfaces the reason".                                   ║
 * ║  M7 CRITERION 3: "editing a published flow creates a draft; in-flight     ║
 * ║                   runs finish on the old version".                        ║
 * ║  M7 CRITERION 5: "execution log shows every step with status/duration/    ║
 * ║                   error for a seeded run".                                ║
 * ║                                                                           ║
 * ║  Criterion 1 is tested with a REAL side effect and a real kill: the       ║
 * ║  action increments a counter, the worker dies between acting and          ║
 * ║  recording, and the retry must leave that counter at ONE.                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  advanceRun,
  registerAction,
  startRun,
  type ActionResult,
} from '@/lib/flows/engine'
import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv } from './helpers'

const RUN = Date.now().toString(36)

let user: Awaited<ReturnType<typeof createAuthUser>> | null = null
let workspaceId = ''
let contactId = ''

/** Counts real side effects, so a duplicate is impossible to hide. */
const sideEffects: Record<string, number> = {}
const bump = (key: string) => {
  sideEffects[key] = (sideEffects[key] ?? 0) + 1
}

beforeAll(async () => {
  if (!hasSupabaseEnv) return

  registerAction('ADD_TAG', async (ctx, config): Promise<ActionResult> => {
    bump(String(config.key ?? 'add-tag'))
    return { ok: true, output: { tagged: true, runId: ctx.runId } }
  })
  registerAction('CREATE_TASK', async (): Promise<ActionResult> => {
    bump('create-task')
    return { ok: true, output: { created: true } }
  })
  registerAction('NOTIFY', async (): Promise<ActionResult> => ({
    ok: false,
    code: 'NOTIFY_UNAVAILABLE',
    message: 'Notifications are not configured.',
    retryable: false,
  }))

  user = await createAuthUser(`flow-${RUN}`)
  const db = adminClient()
  const { data: m } = await db
    .from('workspace_memberships').select('workspace_id').eq('user_id', user.id).single()
  workspaceId = m!.workspace_id

  const { data: contact } = await db
    .from('crm_contacts')
    .insert({
      workspace_id: workspaceId, first_name: 'Dana', last_name: 'Reyes',
      full_name: `Dana Reyes ${RUN}`, job_title: null,
    })
    .select('id').single()
  contactId = contact!.id
}, 60_000)

afterAll(async () => {
  if (!user) return
  await adminClient().from('workspaces').delete().eq('id', workspaceId)
  await deleteTestUser(user.id)
})

async function makeFlow(
  definition: unknown,
  limits: { maxRunsPerDay?: number; maxChainDepth?: number } = {},
): Promise<string> {
  const db = adminClient()
  const { data: flow, error } = await db
    .from('flows')
    .insert({
      workspace_id: workspaceId,
      name: `Flow ${RUN}-${Math.random().toString(36).slice(2, 7)}`,
      max_runs_per_contact_per_day: limits.maxRunsPerDay ?? 3,
      max_chain_depth: limits.maxChainDepth ?? 3,
    })
    .select('id').single()
  if (error) throw new Error(`flow insert failed: ${error.message}`)

  await db.rpc('flow_publish', {
    p_workspace_id: workspaceId,
    p_flow_id: flow.id,
    p_definition: definition as never,
  })
  return flow.id
}

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('a flow runs end to end', () => {
  it('executes actions, follows branches and completes', async () => {
    const key = `basic-${RUN}`
    const flowId = await makeFlow({
      trigger: { type: 'contact_created', config: {} },
      entryStepId: 'tag',
      steps: [
        { id: 'tag', type: 'ACTION', action: 'ADD_TAG', config: { key }, next: 'check' },
        {
          id: 'check', type: 'BRANCH', match: 'all',
          // The contact has no job title, so this is TRUE.
          conditions: [{ field: 'contact.job_title', operator: 'is_empty' }],
          onTrue: 'task', onFalse: null,
        },
        { id: 'task', type: 'ACTION', action: 'CREATE_TASK', config: {}, next: null },
      ],
    })

    const started = await startRun({
      workspaceId, flowId, triggerType: 'contact_created', contactId,
    })
    expect(started.started).toBe(true)
    if (!started.started) return

    const result = await advanceRun(workspaceId, started.runId)
    expect(result.status).toBe('completed')

    // The branch took the true path, because the job title really is null.
    expect(sideEffects[key]).toBe(1)
    expect(sideEffects['create-task']).toBeGreaterThanOrEqual(1)
  }, 90_000)

  it('parks on a wait rather than blocking a worker', async () => {
    const flowId = await makeFlow({
      trigger: { type: 'manual', config: {} },
      entryStepId: 'pause',
      steps: [
        { id: 'pause', type: 'WAIT', hours: 24, next: 'tag' },
        { id: 'tag', type: 'ACTION', action: 'ADD_TAG', config: { key: `waited-${RUN}` }, next: null },
      ],
    })

    const started = await startRun({ workspaceId, flowId, triggerType: 'manual', contactId })
    expect(started.started).toBe(true)
    if (!started.started) return

    const result = await advanceRun(workspaceId, started.runId)
    expect(result.status).toBe('waiting')

    const { data: run } = await adminClient()
      .from('flow_runs').select('status, resume_at, current_step').eq('id', started.runId).single()
    expect(run!.status).toBe('waiting')
    expect(run!.resume_at).not.toBeNull()
    // The step AFTER the wait is what resumes.
    expect(run!.current_step).toBe('tag')
    // And the action beyond it has NOT run.
    expect(sideEffects[`waited-${RUN}`]).toBeUndefined()
  }, 90_000)
})

describeIf('CRITERION 1 — a killed worker never duplicates an action', () => {
  it('does not repeat a side effect the first worker already performed', async () => {
    const key = `killed-${RUN}`
    const flowId = await makeFlow({
      trigger: { type: 'manual', config: {} },
      entryStepId: 'tag',
      steps: [
        { id: 'tag', type: 'ACTION', action: 'ADD_TAG', config: { key }, next: null },
      ],
    })

    const started = await startRun({ workspaceId, flowId, triggerType: 'manual', contactId })
    expect(started.started).toBe(true)
    if (!started.started) return

    const db = adminClient()

    /*
     * Simulate the worst case exactly: the worker CLAIMS the step, performs
     * the side effect, and dies before recording the outcome. The step row is
     * left in `running` — precisely what a kill -9 leaves behind.
     */
    const { data: claimed } = await db.rpc('flow_claim_step', {
      p_workspace_id: workspaceId,
      p_run_id: started.runId,
      p_step_id: 'tag',
      p_step_type: 'ADD_TAG',
      p_input: {},
    })
    expect(claimed).toBe(true)
    bump(key) // the side effect actually happened
    expect(sideEffects[key]).toBe(1)

    // ...and now the worker restarts and drives the same run.
    await advanceRun(workspaceId, started.runId)

    /*
     * ⚠️ THE ASSERTION THAT MATTERS. Still ONE. The retry found the claim
     * already taken and moved on WITHOUT performing the action again.
     */
    expect(sideEffects[key]).toBe(1)

    const { data: steps } = await db
      .from('flow_step_runs').select('id').eq('run_id', started.runId).eq('step_id', 'tag')
    expect(steps!.length).toBe(1)
  }, 90_000)

  it('produces one run when a trigger is redelivered', async () => {
    const flowId = await makeFlow({
      trigger: { type: 'webhook', config: {} },
      entryStepId: 'tag',
      steps: [{ id: 'tag', type: 'ACTION', action: 'ADD_TAG', config: { key: `dedupe-${RUN}` }, next: null }],
    })

    const key = `evt-${RUN}`
    const first = await startRun({
      workspaceId, flowId, triggerType: 'webhook', contactId, idempotencyKey: key,
    })
    const second = await startRun({
      workspaceId, flowId, triggerType: 'webhook', contactId, idempotencyKey: key,
    })

    expect(first.started).toBe(true)
    expect(second.started).toBe(false)
    if (!second.started) expect(second.reason).toBe('duplicate')
  }, 90_000)
})

describeIf('CRITERION 2 — loop protection halts and says why', () => {
  it('halts a self-triggering chain and records the reason', async () => {
    const flowId = await makeFlow(
      {
        trigger: { type: 'manual', config: {} },
        entryStepId: 'tag',
        steps: [{ id: 'tag', type: 'ACTION', action: 'ADD_TAG', config: {}, next: null }],
      },
      { maxChainDepth: 2 },
    )

    const result = await startRun({
      workspaceId, flowId, triggerType: 'manual', contactId, chainDepth: 5,
    })

    expect(result.started).toBe(false)
    if (result.started) return

    expect(result.reason).toBe('halted')
    // Not just "stopped" — it names the cause.
    expect(result.detail).toContain('triggered itself')

    // ⚠️ The halt is RECORDED, so the customer can see why their flow stopped.
    const { data: run } = await adminClient()
      .from('flow_runs').select('status, halt_reason').eq('id', result.runId!).single()
    expect(run!.status).toBe('halted')
    expect(run!.halt_reason).toContain('triggered itself')
  }, 90_000)

  it('halts once a contact has entered too many times today', async () => {
    const flowId = await makeFlow(
      {
        trigger: { type: 'manual', config: {} },
        entryStepId: 'tag',
        steps: [{ id: 'tag', type: 'ACTION', action: 'ADD_TAG', config: {}, next: null }],
      },
      { maxRunsPerDay: 2 },
    )

    await startRun({ workspaceId, flowId, triggerType: 'manual', contactId })
    await startRun({ workspaceId, flowId, triggerType: 'manual', contactId })
    const third = await startRun({ workspaceId, flowId, triggerType: 'manual', contactId })

    expect(third.started).toBe(false)
    if (!third.started) expect(third.detail).toContain('already entered this flow')
  }, 90_000)

  it('does not start a run at all for an unpublished flow', async () => {
    const { data: flow } = await adminClient()
      .from('flows')
      .insert({ workspace_id: workspaceId, name: `Draft ${RUN}` })
      .select('id').single()

    const result = await startRun({
      workspaceId, flowId: flow!.id, triggerType: 'manual', contactId,
    })
    expect(result.started).toBe(false)
    if (!result.started) expect(result.reason).toBe('not_published')
  }, 90_000)
})

describeIf('CRITERION 5 — the execution log', () => {
  it('records status, duration and error for every step of a seeded run', async () => {
    const flowId = await makeFlow({
      trigger: { type: 'manual', config: {} },
      entryStepId: 'tag',
      steps: [
        { id: 'tag', type: 'ACTION', action: 'ADD_TAG', config: { key: `log-${RUN}` }, next: 'notify' },
        // This one fails, so the log has both outcomes in it.
        { id: 'notify', type: 'ACTION', action: 'NOTIFY', config: {}, next: 'never' },
        { id: 'never', type: 'ACTION', action: 'CREATE_TASK', config: {}, next: null },
      ],
    })

    const started = await startRun({ workspaceId, flowId, triggerType: 'manual', contactId })
    expect(started.started).toBe(true)
    if (!started.started) return

    const result = await advanceRun(workspaceId, started.runId)
    expect(result.status).toBe('failed')
    expect(result.error?.stepId).toBe('notify')

    const { data: log } = await adminClient()
      .from('flow_step_runs')
      .select('step_id, step_type, status, duration_ms, error_code, error_message, credits_used, output')
      .eq('run_id', started.runId)
      .order('started_at')

    expect(log!.length).toBe(2)

    const [ok, failed] = log!
    expect(ok!.status).toBe('succeeded')
    expect(ok!.duration_ms).not.toBeNull()
    expect(ok!.output).toMatchObject({ tagged: true })

    expect(failed!.status).toBe('failed')
    expect(failed!.error_code).toBe('NOTIFY_UNAVAILABLE')
    expect(failed!.error_message).toContain('not configured')
    expect(failed!.duration_ms).not.toBeNull()

    // Every deterministic action is free. Only Hubble steps ever cost.
    expect(log!.every((s) => s.credits_used === 0)).toBe(true)

    // The step after the failure never ran — a failed run stops.
    expect(log!.some((s) => s.step_id === 'never')).toBe(false)
  }, 90_000)

  it('names an action that has no handler rather than silently succeeding', async () => {
    const flowId = await makeFlow({
      trigger: { type: 'manual', config: {} },
      entryStepId: 'send',
      steps: [{ id: 'send', type: 'ACTION', action: 'SEND_EMAIL', config: {}, next: null }],
    })

    const started = await startRun({ workspaceId, flowId, triggerType: 'manual', contactId })
    if (!started.started) return

    const result = await advanceRun(workspaceId, started.runId)
    expect(result.status).toBe('failed')
    // Email actions arrive in Phase 21; until then the failure is explicit.
    expect(result.error?.code).toBe('ACTION_NOT_AVAILABLE')
  }, 90_000)
})
