/**
 * Flow definition validation — M7 Phase 20.
 *
 * ⚠️ THE GRAPH CHECKS ARE WHY THIS FILE EXISTS. Per-step validation is
 * ordinary; what matters is catching a definition that is individually
 * well-formed and collectively impossible — a dangling target, an unreachable
 * step, or a cycle with no wait in it. Every one of those passes a naive check
 * and then strands a run at execution time, when the contact is already
 * halfway through.
 */
import { describe, expect, it } from 'vitest'

import {
  actionCostsCredits,
  ACTION_TYPES,
  creditBearingSteps,
  FlowDefinitionError,
  validateFlowDefinition,
} from '@/lib/flows/definition'

const valid = {
  trigger: { type: 'contact_created', config: {} },
  entryStepId: 'assign',
  steps: [
    { id: 'assign', type: 'ACTION', action: 'ASSIGN_OWNER', config: {}, next: 'wait' },
    { id: 'wait', type: 'WAIT', hours: 24, next: 'branch' },
    {
      id: 'branch', type: 'BRANCH', match: 'all',
      conditions: [{ field: 'replied', operator: 'equals', value: true }],
      onTrue: 'task', onFalse: null,
    },
    { id: 'task', type: 'ACTION', action: 'CREATE_TASK', config: {}, next: null },
  ],
}

describe('the free/paid split is explicit', () => {
  it('makes every deterministic action free', () => {
    /*
     * A customer building a flow must see, before running it on 10,000
     * contacts, exactly which steps will charge them.
     */
    const deterministic = (Object.keys(ACTION_TYPES) as (keyof typeof ACTION_TYPES)[])
      .filter((t) => !t.startsWith('HUBBLE_'))

    for (const type of deterministic) {
      expect(actionCostsCredits(type)).toBe(false)
    }
  })

  it('makes every HUBBLE_ action cost credits', () => {
    // If one of these were ever free, the customer would be charged by a
    // provider for work the product told them was included.
    const hubble = (Object.keys(ACTION_TYPES) as (keyof typeof ACTION_TYPES)[])
      .filter((t) => t.startsWith('HUBBLE_'))

    expect(hubble.length).toBeGreaterThan(0)
    for (const type of hubble) {
      expect(actionCostsCredits(type)).toBe(true)
    }
  })

  it('reports no credit-bearing steps in a deterministic flow', () => {
    expect(creditBearingSteps(validateFlowDefinition(valid))).toEqual([])
  })

  it('names the credit-bearing steps in a mixed flow, before it runs', () => {
    const mixed = validateFlowDefinition({
      ...valid,
      entryStepId: 'score',
      steps: [
        { id: 'score', type: 'ACTION', action: 'HUBBLE_ICP_SCORE', config: {}, next: 'tag' },
        { id: 'tag', type: 'ACTION', action: 'ADD_TAG', config: {}, next: null },
      ],
    })
    // Only the AI step, named — so the editor can badge it.
    expect(creditBearingSteps(mixed)).toEqual(['score'])
  })

  it('marks SEND_EMAIL irreversible even though it is free', () => {
    // Free of AI credits, but the only action here that cannot be undone.
    expect(ACTION_TYPES.SEND_EMAIL.reversible).toBe(false)
    expect(ACTION_TYPES.ASSIGN_OWNER.reversible).toBe(true)
  })
})

describe('a well-formed flow validates', () => {
  it('accepts the canonical shape', () => {
    const result = validateFlowDefinition(valid)
    expect(result.steps).toHaveLength(4)
    expect(result.trigger.type).toBe('contact_created')
  })

  it('defaults re-enrollment to OFF', () => {
    /*
     * A contact re-entering a flow they already completed is occasionally
     * wanted and usually a mistake — and the mistake mails someone the same
     * sequence twice. Opt in, never out.
     */
    expect(validateFlowDefinition(valid).allowReEnrollment).toBe(false)
  })
})

describe('the graph must actually be traversable', () => {
  it('rejects a step pointing at something that does not exist', () => {
    const broken = {
      ...valid,
      steps: [{ id: 'a', type: 'ACTION', action: 'CREATE_TASK', config: {}, next: 'ghost' }],
      entryStepId: 'a',
    }
    expect(() => validateFlowDefinition(broken)).toThrow(/does not exist/)
  })

  it('rejects an entry step that is not in the list', () => {
    expect(() => validateFlowDefinition({ ...valid, entryStepId: 'nowhere' })).toThrow(
      /not one of the steps/,
    )
  })

  it('rejects duplicate step ids', () => {
    const dupes = {
      ...valid,
      entryStepId: 'a',
      steps: [
        { id: 'a', type: 'ACTION', action: 'CREATE_TASK', config: {}, next: null },
        { id: 'a', type: 'ACTION', action: 'ADD_TAG', config: {}, next: null },
      ],
    }
    expect(() => validateFlowDefinition(dupes)).toThrow(/share the id/)
  })

  it('names a step that can never be reached', () => {
    // The author thinks they configured something that will never run.
    const orphan = {
      ...valid,
      entryStepId: 'a',
      steps: [
        { id: 'a', type: 'ACTION', action: 'CREATE_TASK', config: {}, next: null },
        { id: 'stranded', type: 'ACTION', action: 'ADD_TAG', config: {}, next: null },
      ],
    }
    expect(() => validateFlowDefinition(orphan)).toThrow(/cannot be reached/)
  })
})

describe('cycles', () => {
  it('REJECTS a loop with no wait in it', () => {
    /*
     * The database's loop protection catches a flow that RE-TRIGGERS itself,
     * but cannot help with a cycle inside a single run — that spins the worker
     * until something else kills it.
     */
    const spin = {
      ...valid,
      entryStepId: 'a',
      steps: [
        { id: 'a', type: 'ACTION', action: 'ADD_TAG', config: {}, next: 'b' },
        { id: 'b', type: 'ACTION', action: 'REMOVE_TAG', config: {}, next: 'a' },
      ],
    }
    expect(() => validateFlowDefinition(spin)).toThrow(/run forever/)
  })

  it('ALLOWS a loop that contains a wait', () => {
    // A nurture loop that checks back weekly is legitimate.
    const nurture = {
      ...valid,
      entryStepId: 'a',
      steps: [
        { id: 'a', type: 'ACTION', action: 'ADD_TAG', config: {}, next: 'pause' },
        { id: 'pause', type: 'WAIT', hours: 168, next: 'a' },
      ],
    }
    expect(() => validateFlowDefinition(nurture)).not.toThrow()
  })

  it('rejects a waitless cycle reached through a branch', () => {
    const branchLoop = {
      ...valid,
      entryStepId: 'a',
      steps: [
        { id: 'a', type: 'ACTION', action: 'ADD_TAG', config: {}, next: 'check' },
        {
          id: 'check', type: 'BRANCH', match: 'any',
          conditions: [{ field: 'x', operator: 'is_empty' }],
          onTrue: 'a', onFalse: null,
        },
      ],
    }
    expect(() => validateFlowDefinition(branchLoop)).toThrow(/run forever/)
  })
})

describe('bounds', () => {
  it('rejects a wait longer than 90 days', () => {
    // An unbounded wait is a run that never finishes and never surfaces —
    // nobody notices until someone asks why a contact stalled months ago.
    const forever = {
      ...valid,
      entryStepId: 'w',
      steps: [{ id: 'w', type: 'WAIT', hours: 24 * 365, next: null }],
    }
    expect(() => validateFlowDefinition(forever)).toThrow(FlowDefinitionError)
  })

  it('allows a zero-hour wait, which is a legitimate no-op yield', () => {
    const instant = {
      ...valid,
      entryStepId: 'w',
      steps: [{ id: 'w', type: 'WAIT', hours: 0, next: null }],
    }
    expect(() => validateFlowDefinition(instant)).not.toThrow()
  })

  it('rejects a flow with no steps', () => {
    expect(() => validateFlowDefinition({ ...valid, steps: [] })).toThrow(FlowDefinitionError)
  })

  it('rejects an unknown trigger type', () => {
    expect(() => validateFlowDefinition({ ...valid, trigger: { type: 'telepathy' } })).toThrow(
      FlowDefinitionError,
    )
  })

  it('rejects an unknown action', () => {
    const bogus = {
      ...valid,
      entryStepId: 'a',
      steps: [{ id: 'a', type: 'ACTION', action: 'LAUNCH_MISSILES', config: {}, next: null }],
    }
    expect(() => validateFlowDefinition(bogus)).toThrow(FlowDefinitionError)
  })

  it('rejects a step id that would be unsafe to print or compare', () => {
    const nasty = {
      ...valid,
      entryStepId: 'a b',
      steps: [{ id: 'a b', type: 'ACTION', action: 'ADD_TAG', config: {}, next: null }],
    }
    expect(() => validateFlowDefinition(nasty)).toThrow(FlowDefinitionError)
  })
})

describe('errors are actionable', () => {
  it('reports every problem at once, not just the first', () => {
    // One round trip should tell the author everything to fix.
    const messy = {
      ...valid,
      entryStepId: 'missing',
      steps: [{ id: 'a', type: 'ACTION', action: 'ADD_TAG', config: {}, next: 'ghost' }],
    }
    try {
      validateFlowDefinition(messy)
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(FlowDefinitionError)
      expect((error as FlowDefinitionError).problems.length).toBeGreaterThan(1)
    }
  })
})
