/**
 * Flow test mode — the dry run.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE PROPERTY UNDER TEST IS AN ABSENCE: NOTHING HAPPENS.                 ║
 * ║                                                                           ║
 * ║  A simulation that quietly created three tasks and assigned an owner      ║
 * ║  would pass any test that only checked its report. So the handler         ║
 * ║  registry is spied on, and the assertion is that it was never touched —   ║
 * ║  the one thing that makes "test mode" true rather than a label.           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gatherFacts = vi.fn(async () => ({} as Record<string, unknown>))
const handlerFor = vi.fn(() => undefined)

vi.mock('@/lib/flows/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flows/engine')>()
  return {
    ...actual,
    gatherFacts: (...args: unknown[]) => gatherFacts(...(args as [])),
    // ⚠️ SPIED SO ITS ABSENCE CAN BE PROVEN. If the simulator ever reaches for
    // a handler, this records it and the test below fails.
    handlerFor: (...args: unknown[]) => handlerFor(...(args as [])),
  }
})

const { simulateFlow } = await import('@/lib/flows/simulate')
import type { FlowDefinition } from '@/lib/flows/definition'

const linear: FlowDefinition = {
  trigger: { type: 'manual', config: {} },
  entryStepId: 'assign',
  allowReEnrollment: false,
  steps: [
    { id: 'assign', type: 'ACTION', action: 'ROUND_ROBIN', config: {}, next: 'wait' },
    { id: 'wait', type: 'WAIT', hours: 72, next: 'notify' },
    // NOTIFY is declared irreversible — it leaves Outlio.
    { id: 'notify', type: 'ACTION', action: 'NOTIFY', config: {}, next: null },
  ],
}

const branching: FlowDefinition = {
  trigger: { type: 'manual', config: {} },
  entryStepId: 'check',
  allowReEnrollment: false,
  steps: [
    {
      id: 'check',
      type: 'BRANCH',
      conditions: [{ field: 'job_title', operator: 'is_not_empty' }],
      match: 'all',
      onTrue: 'yes_task',
      onFalse: 'no_task',
    },
    { id: 'yes_task', type: 'ACTION', action: 'CREATE_TASK', config: {}, next: null },
    { id: 'no_task', type: 'ACTION', action: 'ADD_TAG', config: {}, next: null },
  ],
}

beforeEach(() => {
  gatherFacts.mockClear()
  handlerFor.mockClear()
  gatherFacts.mockResolvedValue({})
})

describe('nothing actually happens', () => {
  it('NEVER asks the registry for a handler', async () => {
    /*
     * ⚠️ THE ASSERTION THE WHOLE FEATURE RESTS ON. Every other check here could
     * pass while the simulator ran the flow for real and merely described it
     * accurately afterwards.
     */
    await simulateFlow({ workspaceId: 'w1', definition: linear, contactId: 'c1' })
    expect(handlerFor).not.toHaveBeenCalled()
  })

  it('reads the contact facts once, and writes nothing', async () => {
    await simulateFlow({ workspaceId: 'w1', definition: linear, contactId: 'c1' })
    // One read, so a branch resolves against reality rather than a guess.
    expect(gatherFacts).toHaveBeenCalledTimes(1)
    expect(gatherFacts).toHaveBeenCalledWith('w1', 'c1')
  })
})

describe('what it reports', () => {
  it('walks every step in order', async () => {
    const result = await simulateFlow({
      workspaceId: 'w1',
      definition: linear,
      contactId: 'c1',
    })

    expect(result.steps.map((s) => s.stepId)).toEqual(['assign', 'wait', 'notify'])
    expect(result.stoppedBecause).toBeNull()
  })

  it('STEPS OVER a wait rather than honouring it', async () => {
    // A dry run that honoured a three-day wait would tell someone nothing for
    // three days, which defeats the point.
    const result = await simulateFlow({
      workspaceId: 'w1',
      definition: linear,
      contactId: 'c1',
    })

    const wait = result.steps.find((s) => s.type === 'WAIT')!
    expect(wait.outcome).toContain('3 days')
    // It continued past it.
    expect(result.steps.at(-1)!.stepId).toBe('notify')
  })

  it('names an external step as one that cannot be undone', async () => {
    const result = await simulateFlow({
      workspaceId: 'w1',
      definition: linear,
      contactId: 'c1',
    })

    const notify = result.steps.find((s) => s.stepId === 'notify')!
    expect(notify.outcome).toContain('external')
    expect(notify.simulated).toBe(true)
  })
})

describe('branches resolve against the real contact', () => {
  it('takes the YES arm when the condition holds', async () => {
    gatherFacts.mockResolvedValue({ job_title: 'Head of Sales' })

    const result = await simulateFlow({
      workspaceId: 'w1',
      definition: branching,
      contactId: 'c1',
    })

    expect(result.steps[0]!.branchTaken).toBe('yes')
    expect(result.steps.map((s) => s.stepId)).toEqual(['check', 'yes_task'])
  })

  it('takes the NO arm when it does not', async () => {
    gatherFacts.mockResolvedValue({ job_title: '' })

    const result = await simulateFlow({
      workspaceId: 'w1',
      definition: branching,
      contactId: 'c1',
    })

    expect(result.steps[0]!.branchTaken).toBe('no')
    expect(result.steps.map((s) => s.stepId)).toEqual(['check', 'no_task'])
  })
})

describe('it cannot run away', () => {
  it('stops and says so when a definition loops', async () => {
    /*
     * ⚠️ THE ENGINE'S OWN LOOP PROTECTION DOES NOT APPLY HERE, because nothing
     * is being recorded to count against. Without a ceiling a cyclic
     * definition would spin forever inside a request.
     */
    const loop: FlowDefinition = {
      trigger: { type: 'manual', config: {} },
      entryStepId: 'a',
      allowReEnrollment: false,
      steps: [
        { id: 'a', type: 'ACTION', action: 'ADD_TAG', config: {}, next: 'b' },
        { id: 'b', type: 'ACTION', action: 'REMOVE_TAG', config: {}, next: 'a' },
      ],
    }

    const result = await simulateFlow({ workspaceId: 'w1', definition: loop, contactId: null })

    expect(result.stoppedBecause).toContain('may loop')
    expect(result.steps.length).toBeLessThanOrEqual(100)
  })

  it('stops on a dangling pointer instead of throwing', async () => {
    // The publish validator prevents this, but a DRAFT can be mid-edit — and
    // a crash is a worse answer than "that step does not exist".
    const broken: FlowDefinition = {
      trigger: { type: 'manual', config: {} },
      entryStepId: 'a',
      allowReEnrollment: false,
      steps: [{ id: 'a', type: 'ACTION', action: 'ADD_TAG', config: {}, next: 'ghost' }],
    }

    const result = await simulateFlow({ workspaceId: 'w1', definition: broken, contactId: null })

    expect(result.stoppedBecause).toContain('ghost')
    expect(result.steps).toHaveLength(1)
  })
})
