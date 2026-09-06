/**
 * Branch condition evaluation — M7 Phase 20.
 *
 * ⚠️ THE MISSING-FACT CASES ARE THE POINT. A branch is where a flow decides
 * what happens to a real person, and the common shape of that decision is
 * "if they have no job title, do X". Treating an absent field as an error, or
 * as a silent false, sends every under-filled contact down the wrong path —
 * and cold-outbound data is under-filled by default.
 */
import { describe, expect, it } from 'vitest'

import { evaluateBranch, evaluateCondition } from '@/lib/flows/engine'

const facts = {
  'contact.first_name': 'Dana',
  'contact.job_title': null,
  'contact.headline': '',
  'contact.owner_user_id': 'user-1',
  score: 42,
}

describe('emptiness is a first-class question', () => {
  it('treats an absent field as empty', () => {
    expect(evaluateCondition({ field: 'nope', operator: 'is_empty' }, facts)).toBe(true)
  })

  it('treats null as empty', () => {
    expect(evaluateCondition({ field: 'contact.job_title', operator: 'is_empty' }, facts)).toBe(true)
  })

  it('treats an empty string as empty', () => {
    expect(evaluateCondition({ field: 'contact.headline', operator: 'is_empty' }, facts)).toBe(true)
  })

  it('does not treat a present value as empty', () => {
    expect(evaluateCondition({ field: 'contact.first_name', operator: 'is_empty' }, facts)).toBe(false)
    expect(evaluateCondition({ field: 'contact.first_name', operator: 'is_not_empty' }, facts)).toBe(true)
  })

  it('does not treat zero as empty', () => {
    // 0 is a value. Treating it as absent is the classic falsy-check bug, and
    // here it would misroute every contact with a score of zero.
    expect(evaluateCondition({ field: 'score', operator: 'is_empty' }, { score: 0 })).toBe(false)
  })
})

describe('comparisons', () => {
  it('compares equality strictly', () => {
    expect(evaluateCondition({ field: 'score', operator: 'equals', value: 42 }, facts)).toBe(true)
    // '42' is not 42. A loose comparison would make a string from a webhook
    // silently match a number from the database.
    expect(evaluateCondition({ field: 'score', operator: 'equals', value: '42' }, facts)).toBe(false)
  })

  it('matches contains case-insensitively', () => {
    expect(
      evaluateCondition({ field: 'contact.first_name', operator: 'contains', value: 'dan' }, facts),
    ).toBe(true)
  })

  it('handles contains against a missing field without throwing', () => {
    expect(evaluateCondition({ field: 'nope', operator: 'contains', value: 'x' }, facts)).toBe(false)
  })

  it('compares numerically', () => {
    expect(evaluateCondition({ field: 'score', operator: 'greater_than', value: 40 }, facts)).toBe(true)
    expect(evaluateCondition({ field: 'score', operator: 'less_than', value: 40 }, facts)).toBe(false)
  })

  it('handles in / not_in', () => {
    const cond = { field: 'contact.owner_user_id', operator: 'in', value: ['user-1', 'user-2'] }
    expect(evaluateCondition(cond, facts)).toBe(true)
    expect(evaluateCondition({ ...cond, operator: 'not_in' }, facts)).toBe(false)
  })

  it('returns false for `in` when the value is not a list', () => {
    // Misconfiguration must not accidentally pass.
    expect(
      evaluateCondition({ field: 'score', operator: 'in', value: 'not-a-list' }, facts),
    ).toBe(false)
  })
})

describe('an unknown operator never passes', () => {
  it('returns false rather than defaulting to true', () => {
    /*
     * A branch that always takes the true path is worse than a stopped run,
     * because it looks like it worked — and a flow that silently emails
     * everyone is exactly the failure mode.
     */
    expect(evaluateCondition({ field: 'score', operator: 'sorta_equals', value: 42 }, facts)).toBe(false)
  })
})

describe('combining conditions', () => {
  const yes = { field: 'contact.first_name', operator: 'is_not_empty' }
  const no = { field: 'contact.job_title', operator: 'is_not_empty' }

  it('requires all conditions under `all`', () => {
    expect(evaluateBranch([yes, no], 'all', facts)).toBe(false)
    expect(evaluateBranch([yes, yes], 'all', facts)).toBe(true)
  })

  it('requires only one under `any`', () => {
    expect(evaluateBranch([yes, no], 'any', facts)).toBe(true)
    expect(evaluateBranch([no, no], 'any', facts)).toBe(false)
  })

  it('treats an empty condition list as true', () => {
    // A branch with no conditions is a pass-through, not a dead end that
    // strands every run reaching it.
    expect(evaluateBranch([], 'all', facts)).toBe(true)
  })
})
