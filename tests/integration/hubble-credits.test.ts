/**
 * The Hubble credit boundary — M7 Phase 22.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  M7 CRITERION 4: "credit-exhausted Hubble step fails gracefully;          ║
 * ║  deterministic path continues per config."                                ║
 * ║                                                                           ║
 * ║  Tested against a REAL allowance that is really exhausted, because the    ║
 * ║  thing being proven is a money guarantee: a refused call must charge the  ║
 * ║  customer nothing, and must not cost them the deterministic automation    ║
 * ║  they are still paying for.                                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { registerAllActions } from '@/lib/flows/actions'
import { registerHubbleRunner } from '@/lib/flows/actions/hubble'
import { advanceRun, startRun } from '@/lib/flows/engine'
import { creditsRemaining, hubbleExecute } from '@/lib/hubble/execute'
import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv } from './helpers'

const RUN = Date.now().toString(36)
const PERIOD_START = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))

let user: Awaited<ReturnType<typeof createAuthUser>> | null = null
let workspaceId = ''
let contactId = ''
let planId = ''
let deterministicRan = 0

beforeAll(async () => {
  if (!hasSupabaseEnv) return
  registerAllActions()

  // A real runner, so a successful call is genuinely a call.
  registerHubbleRunner('icp_score', async () => ({ score: 72 }))

  user = await createAuthUser(`hubble-${RUN}`)
  const db = adminClient()
  const { data: m } = await db
    .from('workspace_memberships').select('workspace_id').eq('user_id', user.id).single()
  workspaceId = m!.workspace_id

  /*
   * ⚠️ AN EXISTING PLAN WITH A REAL, FINITE CEILING, rather than a fabricated
   * one. `trial` allows 10 credits a month. Using a real plan means the test
   * exercises the same rows production does — and inventing a plan would need
   * a `plan_key` enum value that does not exist.
   *
   * Usage is then pre-seeded so only 2 credits remain, which makes exhaustion
   * reachable in a handful of calls. Without a finite allowance the exhaustion
   * path would never be hit and the test would pass while proving nothing.
   */
  const { data: trial, error: planError } = await db
    .from('plans').select('id').eq('key', 'trial').single()
  if (planError) throw new Error(`could not read the trial plan: ${planError.message}`)
  planId = trial.id

  /*
   * ⚠️ ONLY `plan_id`. An earlier version also set `role: 'user'`, which is not
   * a `user_role` value — the enum has `registered_user` — so the whole UPDATE
   * failed and took plan_id with it. The user stayed on no plan, read as
   * UNLIMITED, and every exhaustion assertion failed while looking like a bug
   * in the boundary. The error is checked now.
   */
  const { error: profileError } = await db
    .from('profiles').update({ plan_id: planId }).eq('id', user.id)
  if (profileError) throw new Error(`profile plan update failed: ${profileError.message}`)

  // 10 allowed - 8 used = 2 remaining.
  const { error: usageError } = await db.from('usage_counters').insert({
    user_id: user.id,
    metric: 'credits',
    period_start: PERIOD_START.toISOString(),
    period_end: new Date(Date.UTC(PERIOD_START.getUTCFullYear(), PERIOD_START.getUTCMonth() + 1, 1)).toISOString(),
    count: 8,
  })
  if (usageError) throw new Error(`usage seed failed: ${usageError.message}`)

  const { data: contact } = await db
    .from('crm_contacts')
    .insert({
      workspace_id: workspaceId, first_name: 'Dana', last_name: 'Reyes',
      full_name: `Dana Reyes ${RUN}`,
    })
    .select('id').single()
  contactId = contact!.id
}, 60_000)

afterAll(async () => {
  if (!user) return
  const db = adminClient()
  await db.from('usage_counters').delete().eq('user_id', user.id)
  await db.from('workspaces').delete().eq('id', workspaceId)
  await deleteTestUser(user.id)
  // ⚠️ The plan is a REAL shared row, not one this test created. Deleting it
  // would remove the trial plan for every customer on it.
})

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('the boundary meters honestly', () => {
  it('spends credits and reports what is left', async () => {
    const before = await creditsRemaining(user!.id)
    expect(before.unlimited).toBe(false)
    expect(before.remaining).toBe(2)

    const outcome = await hubbleExecute(
      'icp_score',
      { workspaceId, userId: user!.id, source: 'test' },
      async () => ({ score: 72 }),
    )

    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.creditsSpent).toBe(1)
      expect(outcome.remaining).toBe(1)
    }
  }, 60_000)

  it('REFUNDS a call that fails, so a customer never pays for nothing', async () => {
    const before = await creditsRemaining(user!.id)

    const outcome = await hubbleExecute(
      'icp_score',
      { workspaceId, userId: user!.id, source: 'test' },
      async () => {
        throw new Error('the model fell over')
      },
    )

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('failed')

    // Charging for a failed call is the small dishonesty that erodes trust in
    // every number the product shows.
    const after = await creditsRemaining(user!.id)
    expect(after.remaining).toBe(before.remaining)
  }, 60_000)

  it('records the refusal as well as the success', async () => {
    const { data: calls } = await adminClient()
      .from('hubble_calls')
      .select('outcome, credits_spent, task')
      .eq('workspace_id', workspaceId)
      .order('created_at')

    // A log of successes alone cannot answer "why did my flow stop?".
    expect(calls!.some((c) => c.outcome === 'ok' && c.credits_spent === 1)).toBe(true)
    expect(calls!.some((c) => c.outcome === 'failed' && c.credits_spent === 0)).toBe(true)
  }, 60_000)
})

describeIf('CRITERION 4 — exhaustion is graceful', () => {
  it('refuses once the allowance is gone, and charges nothing for the refusal', async () => {
    const db = adminClient()

    // Spend the allowance for real: 2 credits, 1 already used above.
    await hubbleExecute('icp_score', { workspaceId, userId: user!.id }, async () => ({ x: 1 }))

    const atLimit = await creditsRemaining(user!.id)
    expect(atLimit.remaining).toBe(0)

    const { data: usedBefore } = await db
      .from('usage_counters').select('count')
      .eq('user_id', user!.id).eq('metric', 'credits')
      .eq('period_start', PERIOD_START.toISOString()).maybeSingle()

    const outcome = await hubbleExecute(
      'icp_score',
      { workspaceId, userId: user!.id, source: 'test' },
      async () => ({ shouldNotRun: true }),
    )

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.reason).toBe('no_credits')
      // The message tells the customer the flow keeps going.
      if (outcome.reason === 'no_credits') expect(outcome.message).toContain('continue')
    }

    // ⚠️ NOTHING WAS CHARGED. The exhausted spend is rolled back in full.
    const { data: usedAfter } = await db
      .from('usage_counters').select('count')
      .eq('user_id', user!.id).eq('metric', 'credits')
      .eq('period_start', PERIOD_START.toISOString()).maybeSingle()

    expect(usedAfter!.count).toBe(usedBefore!.count)
  }, 60_000)

  it('lets the DETERMINISTIC PATH CONTINUE when the author configured continue', async () => {
    const db = adminClient()

    // A flow where an AI step sits between two free ones.
    const { data: flow } = await db
      .from('flows')
      .insert({ workspace_id: workspaceId, name: `Credit flow ${RUN}` })
      .select('id').single()

    await db.rpc('flow_publish', {
      p_workspace_id: workspaceId,
      p_flow_id: flow!.id,
      p_definition: {
        trigger: { type: 'manual', config: {} },
        entryStepId: 'tag',
        steps: [
          { id: 'tag', type: 'ACTION', action: 'ADD_TAG', config: { tag: `pre-${RUN}` }, next: 'score' },
          {
            id: 'score', type: 'ACTION', action: 'HUBBLE_ICP_SCORE', next: 'task',
            config: { userId: user!.id, onNoCredits: 'continue' },
          },
          { id: 'task', type: 'ACTION', action: 'CREATE_TASK', config: { title: `after-${RUN}` }, next: null },
        ],
      } as never,
    })

    const started = await startRun({ workspaceId, flowId: flow!.id, triggerType: 'manual', contactId })
    expect(started.started).toBe(true)
    if (!started.started) return

    const result = await advanceRun(workspaceId, started.runId)

    // ⚠️ THE RUN COMPLETES. Out of credits did not abort it.
    expect(result.status).toBe('completed')

    const { data: steps } = await db
      .from('flow_step_runs')
      .select('step_id, status, credits_used, output')
      .eq('run_id', started.runId).order('started_at')

    expect(steps!.length).toBe(3)
    expect(steps!.every((s) => s.status === 'succeeded')).toBe(true)

    // The AI step is marked skipped-for-credits, and cost nothing.
    const score = steps!.find((s) => s.step_id === 'score')!
    expect(score.credits_used).toBe(0)
    expect((score.output as { skipped?: boolean; reason?: string }).skipped).toBe(true)
    expect((score.output as { reason?: string }).reason).toBe('no_credits')

    // ...and the step AFTER it really ran. This is the criterion.
    const { data: task } = await db
      .from('crm_tasks').select('id').eq('workspace_id', workspaceId).eq('title', `after-${RUN}`)
    expect(task!.length).toBe(1)

    deterministicRan += 1
    expect(deterministicRan).toBe(1)
  }, 90_000)

  it('STOPS instead when the author configured fail', async () => {
    /*
     * "Per config" means the author decides. A flow whose next branch reads the
     * AI's answer should stop rather than send every contact down the default
     * path silently.
     */
    const db = adminClient()
    const { data: flow } = await db
      .from('flows')
      .insert({ workspace_id: workspaceId, name: `Strict flow ${RUN}` })
      .select('id').single()

    await db.rpc('flow_publish', {
      p_workspace_id: workspaceId,
      p_flow_id: flow!.id,
      p_definition: {
        trigger: { type: 'manual', config: {} },
        entryStepId: 'score',
        steps: [
          {
            id: 'score', type: 'ACTION', action: 'HUBBLE_ICP_SCORE', next: 'task',
            config: { userId: user!.id, onNoCredits: 'fail' },
          },
          { id: 'task', type: 'ACTION', action: 'CREATE_TASK', config: { title: `never-${RUN}` }, next: null },
        ],
      } as never,
    })

    const started = await startRun({ workspaceId, flowId: flow!.id, triggerType: 'manual', contactId })
    if (!started.started) return

    const result = await advanceRun(workspaceId, started.runId)

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('NO_CREDITS')

    // The step after it did NOT run.
    const { data: task } = await db
      .from('crm_tasks').select('id').eq('workspace_id', workspaceId).eq('title', `never-${RUN}`)
    expect(task!.length).toBe(0)
  }, 90_000)
})
