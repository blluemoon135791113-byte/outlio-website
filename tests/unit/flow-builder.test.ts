/**
 * Flow builder graph editing — M7 Phase 23.
 *
 * ⚠️ THE REWIRING RULES ARE WHY THIS IS TESTED SEPARATELY FROM THE UI. The two
 * ways a builder loses someone's work are inserting a step that silently cuts
 * off everything after it, and deleting one that leaves dangling targets the
 * validator then refuses to publish. Both are pure graph operations, so both
 * are pinned here rather than discovered in a browser.
 */
import { describe, expect, it } from 'vitest'

import { validateFlowDefinition, type FlowDefinition } from '@/lib/flows/definition'
import {
  describeStep,
  insertAfter,
  layoutSteps,
  nextStepId,
  removeStep,
  unreachableStepIds,
  updateStep,
} from '@/lib/flows/builder'

const base = (): FlowDefinition =>
  validateFlowDefinition({
    trigger: { type: 'contact_created', config: {} },
    entryStepId: 'assign',
    steps: [
      { id: 'assign', type: 'ACTION', action: 'ASSIGN_OWNER', config: {}, next: 'wait' },
      { id: 'wait', type: 'WAIT', hours: 48, next: 'task' },
      { id: 'task', type: 'ACTION', action: 'CREATE_TASK', config: {}, next: null },
    ],
  })

/**
 * A plain action step. Typed as the real union member rather than `never` so
 * it can be spread — the credit-badge test builds on top of one.
 */
const action = (id: string, type = 'ADD_TAG'): Extract<FlowDefinition['steps'][number], { type: 'ACTION' }> =>
  ({ id, type: 'ACTION', action: type as never, config: {}, next: null })

describe('the list follows the real edges, not array order', () => {
  it('orders steps by what actually runs', () => {
    const shuffled = validateFlowDefinition({
      ...base(),
      // Array order deliberately wrong; the engine walks `next`.
      steps: [
        { id: 'task', type: 'ACTION', action: 'CREATE_TASK', config: {}, next: null },
        { id: 'assign', type: 'ACTION', action: 'ASSIGN_OWNER', config: {}, next: 'wait' },
        { id: 'wait', type: 'WAIT', hours: 48, next: 'task' },
      ],
    })

    expect(layoutSteps(shuffled).map((r) => r.step.id)).toEqual(['assign', 'wait', 'task'])
  })

  it('indents branch targets and labels which side they are on', () => {
    const branching = validateFlowDefinition({
      trigger: { type: 'contact_created', config: {} },
      entryStepId: 'check',
      steps: [
        {
          id: 'check', type: 'BRANCH', match: 'all',
          conditions: [{ field: 'contact.job_title', operator: 'is_empty' }],
          onTrue: 'tag', onFalse: 'task',
        },
        { id: 'tag', type: 'ACTION', action: 'ADD_TAG', config: {}, next: null },
        { id: 'task', type: 'ACTION', action: 'CREATE_TASK', config: {}, next: null },
      ],
    })

    const rows = layoutSteps(branching)
    expect(rows.map((r) => [r.step.id, r.depth, r.branchLabel])).toEqual([
      ['check', 0, null],
      ['tag', 1, 'yes'],
      ['task', 1, 'no'],
    ])
  })

  it('draws a rejoining step once, not twice', () => {
    // Drawing it twice would imply it runs twice.
    const rejoin = validateFlowDefinition({
      trigger: { type: 'contact_created', config: {} },
      entryStepId: 'check',
      steps: [
        {
          id: 'check', type: 'BRANCH', match: 'all',
          conditions: [{ field: 'x', operator: 'is_empty' }],
          onTrue: 'both', onFalse: 'both',
        },
        { id: 'both', type: 'ACTION', action: 'ADD_TAG', config: {}, next: null },
      ],
    })

    expect(layoutSteps(rejoin).filter((r) => r.step.id === 'both')).toHaveLength(1)
  })

  it('still SHOWS an orphaned step rather than hiding it', () => {
    /*
     * A step someone configured that silently vanished would be assumed
     * deleted rather than orphaned — so it is listed and flagged.
     */
    const orphaned = {
      ...base(),
      steps: [...base().steps, action('stranded')],
    } as FlowDefinition

    expect(layoutSteps(orphaned).map((r) => r.step.id)).toContain('stranded')
    expect(unreachableStepIds(orphaned)).toEqual(['stranded'])
  })

  it('badges credit-bearing steps and nothing else', () => {
    const withAi = {
      ...base(),
      entryStepId: 'score',
      steps: [
        { ...action('score', 'HUBBLE_ICP_SCORE'), next: 'assign' },
        ...base().steps,
      ],
    } as FlowDefinition

    const rows = layoutSteps(withAi)
    expect(rows.find((r) => r.step.id === 'score')!.costsCredits).toBe(true)
    expect(rows.find((r) => r.step.id === 'assign')!.costsCredits).toBe(false)
  })
})

describe('inserting a step never cuts off the rest', () => {
  it('rewires the predecessor so nothing after it is lost', () => {
    /*
     * ⚠️ THE COMMONEST WAY A BUILDER LOSES WORK. Appending without moving the
     * old `next` onto the new step orphans everything downstream.
     */
    const updated = insertAfter(base(), 'assign', action('tag'))

    const ids = layoutSteps(validateFlowDefinition(updated)).map((r) => r.step.id)
    expect(ids).toEqual(['assign', 'tag', 'wait', 'task'])
    expect(unreachableStepIds(validateFlowDefinition(updated))).toEqual([])
  })

  it('inserting at the top makes the new step the entry', () => {
    const updated = insertAfter(base(), null, action('first'))
    expect(updated.entryStepId).toBe('first')
    expect(layoutSteps(validateFlowDefinition(updated)).map((r) => r.step.id)).toEqual([
      'first', 'assign', 'wait', 'task',
    ])
  })

  it('inserting after a branch goes down the yes side', () => {
    const branching = validateFlowDefinition({
      trigger: { type: 'contact_created', config: {} },
      entryStepId: 'check',
      steps: [
        {
          id: 'check', type: 'BRANCH', match: 'all',
          conditions: [{ field: 'x', operator: 'is_empty' }],
          onTrue: 'tag', onFalse: null,
        },
        { id: 'tag', type: 'ACTION', action: 'ADD_TAG', config: {}, next: null },
      ],
    })

    const updated = validateFlowDefinition(insertAfter(branching, 'check', action('inserted')))
    const rows = layoutSteps(updated)
    expect(rows.map((r) => r.step.id)).toEqual(['check', 'inserted', 'tag'])
  })

  it('produces a definition that still validates', () => {
    const updated = insertAfter(base(), 'wait', action('extra'))
    expect(() => validateFlowDefinition(updated)).not.toThrow()
  })
})

describe('deleting a step closes the gap', () => {
  it('rewires everything pointing at it', () => {
    // Leaving dangling targets would produce definitions the validator refuses
    // to publish — a builder that can create unpublishable flows.
    const updated = removeStep(base(), 'wait')

    expect(() => validateFlowDefinition(updated)).not.toThrow()
    expect(layoutSteps(validateFlowDefinition(updated)).map((r) => r.step.id)).toEqual([
      'assign', 'task',
    ])
  })

  it('promotes the successor when the ENTRY step is deleted', () => {
    const updated = removeStep(base(), 'assign')
    expect(updated.entryStepId).toBe('wait')
    expect(() => validateFlowDefinition(updated)).not.toThrow()
  })

  it('rewires both sides of a branch that pointed at it', () => {
    const branching = {
      trigger: { type: 'contact_created', config: {} },
      entryStepId: 'check',
      steps: [
        {
          id: 'check', type: 'BRANCH', match: 'all',
          conditions: [{ field: 'x', operator: 'is_empty' }],
          onTrue: 'doomed', onFalse: 'doomed',
        },
        { id: 'doomed', type: 'ACTION', action: 'ADD_TAG', config: {}, next: 'end' },
        { id: 'end', type: 'ACTION', action: 'CREATE_TASK', config: {}, next: null },
      ],
    }

    const updated = removeStep(validateFlowDefinition(branching), 'doomed')
    expect(() => validateFlowDefinition(updated)).not.toThrow()
    const branch = updated.steps.find((s) => s.id === 'check')!
    if (branch.type === 'BRANCH') {
      expect(branch.onTrue).toBe('end')
      expect(branch.onFalse).toBe('end')
    }
  })

  it('is a no-op for a step that does not exist', () => {
    expect(removeStep(base(), 'ghost')).toEqual(base())
  })
})

describe('ids and labels', () => {
  it('never reuses an id', () => {
    const definition = base()
    expect(nextStepId(definition, 'Add tag')).toBe('add-tag')
    const withOne = { ...definition, steps: [...definition.steps, action('add-tag')] }
    expect(nextStepId(withOne as FlowDefinition, 'Add tag')).toBe('add-tag-2')
  })

  it('produces an id that passes the schema', () => {
    // The schema allows only letters, numbers, _ and -.
    expect(nextStepId(base(), 'Score against ICP!! 🎯')).toMatch(/^[a-zA-Z0-9_-]+$/)
  })

  it('describes a wait in days when it divides evenly', () => {
    expect(describeStep({ id: 'w', type: 'WAIT', hours: 48, next: null })).toBe('Wait 2 days')
    expect(describeStep({ id: 'w', type: 'WAIT', hours: 5, next: null })).toBe('Wait 5 hours')
    expect(describeStep({ id: 'w', type: 'WAIT', hours: 0, next: null })).toBe(
      'Continue immediately',
    )
  })

  it('uses words a customer would use, not enum names', () => {
    const step = action('s', 'HUBBLE_ICP_SCORE')
    expect(describeStep(step)).toBe('Score against your ICP')
  })
})

describe('updating a step keeps its position', () => {
  it('changes contents without moving it', () => {
    const updated = updateStep(base(), 'wait', { hours: 72 } as never)
    expect(layoutSteps(validateFlowDefinition(updated)).map((r) => r.step.id)).toEqual([
      'assign', 'wait', 'task',
    ])
    const wait = updated.steps.find((s) => s.id === 'wait')!
    if (wait.type === 'WAIT') expect(wait.hours).toBe(72)
  })
})
