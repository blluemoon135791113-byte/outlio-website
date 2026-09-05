/**
 * The qualification engine.
 *
 * Two invariants carry the most weight here:
 *
 *  1. **The score is deterministic arithmetic.** Same evidence, same profile,
 *     same number — every time. A score nobody can reproduce is a score nobody
 *     can defend to the person who has to make the calls.
 *
 *  2. **Unknown is not failure.** A company we could not research has not
 *     failed a criterion. Scoring it as a zero would quietly bury every
 *     good-fit company with a thin public footprint — which, on Sales
 *     Navigator data, is most of them.
 */
import { describe, expect, it } from 'vitest'

import { evidenceKey, type FieldKnowledge } from '@/lib/intelligence/evidence'
import type { EvidenceRecord, ResearchField } from '@/lib/intelligence/types'
import {
  evaluateCriterion,
  explainResult,
  scoreEntity,
  type Criterion,
  type QualificationProfile,
} from '@/lib/qualification/score'

const COMPANY = { id: '00000000-0000-4000-8000-000000000001', type: 'company' as const }

function known(field: ResearchField, value: Record<string, unknown>): [string, FieldKnowledge] {
  const record: EvidenceRecord = {
    id: `e-${field}`,
    entityType: 'company',
    entityId: COMPANY.id,
    field,
    value,
    sourceProvider: 'test',
    sourceUrl: 'https://example.com/source',
    sourceConfidence: 'high',
    confidence: 0.9,
    retrievedAt: new Date().toISOString(),
    expiresAt: null,
    researchRunId: null,
  }
  return [evidenceKey('company', COMPANY.id, field), { state: 'known', record, conflicting: [], corroborating: [], confidence: record.confidence }]
}

function criterion(over: Partial<Criterion> & Pick<Criterion, 'id' | 'field'>): Criterion {
  return { operator: 'exists', weight: 10, kind: 'preferred', ...over }
}

describe('evaluateCriterion', () => {
  it('compares numbers', () => {
    expect(evaluateCriterion(criterion({ id: 'a', field: 'employee_count', operator: 'gte', value: 10 }), 34)).toBe('met')
    expect(evaluateCriterion(criterion({ id: 'a', field: 'employee_count', operator: 'gte', value: 50 }), 34)).toBe('not_met')
    expect(
      evaluateCriterion(
        criterion({ id: 'a', field: 'employee_count', operator: 'between', value: [10, 50] }),
        34,
      ),
    ).toBe('met')
    expect(
      evaluateCriterion(
        criterion({ id: 'a', field: 'employee_count', operator: 'between', value: [10, 50] }),
        340,
      ),
    ).toBe('not_met')
  })

  it('matches a technology inside a detected list', () => {
    const detected = [
      { id: 'shopify', name: 'Shopify', category: 'ecommerce' },
      { id: 'react', name: 'React', category: 'framework' },
    ]

    expect(
      evaluateCriterion(criterion({ id: 't', field: 'tech_stack', operator: 'contains', value: 'shopify' }), detected),
    ).toBe('met')
    expect(
      evaluateCriterion(criterion({ id: 't', field: 'tech_stack', operator: 'contains', value: 'hubspot' }), detected),
    ).toBe('not_met')
    // "uses HubSpot and Intercom but NOT Salesforce" (spec §54)
    expect(
      evaluateCriterion(
        criterion({ id: 't', field: 'tech_stack', operator: 'not_contains', value: 'salesforce' }),
        detected,
      ),
    ).toBe('met')
  })

  it('matches set membership', () => {
    expect(
      evaluateCriterion(
        criterion({ id: 'r', field: 'funding_round', operator: 'in', value: ['Seed', 'Series A'] }),
        'Series A',
      ),
    ).toBe('met')
    expect(
      evaluateCriterion(
        criterion({ id: 'r', field: 'funding_round', operator: 'in', value: ['Seed', 'Series A'] }),
        'Series C',
      ),
    ).toBe('not_met')
  })

  it('returns unknown for a comparison it cannot make, never a failure', () => {
    // "raised undisclosed" is not "raised less than $5M".
    expect(
      evaluateCriterion(
        criterion({ id: 'a', field: 'funding_amount', operator: 'gte', value: 5_000_000 }),
        'undisclosed',
      ),
    ).toBe('unknown')
    expect(evaluateCriterion(criterion({ id: 'a', field: 'employee_count', operator: 'gte', value: 10 }), null)).toBe(
      'unknown',
    )
  })

  it('treats a missing value as failing only for `exists`', () => {
    expect(evaluateCriterion(criterion({ id: 'x', field: 'tech_stack', operator: 'exists' }), undefined)).toBe('not_met')
  })
})

describe('scoreEntity — deterministic scoring', () => {
  const profile: QualificationProfile = {
    id: 'icp',
    name: 'Seed SaaS ICP',
    criteria: [
      criterion({ id: 'industry', field: 'industry', operator: 'contains', value: 'software', weight: 20 }),
      criterion({ id: 'size', field: 'employee_count', operator: 'between', value: [10, 50], weight: 15 }),
      criterion({ id: 'round', field: 'funding_round', operator: 'in', value: ['Seed', 'Series A'], weight: 15 }),
    ],
  }

  const fullKnowledge = new Map([
    known('industry', { industry: 'software' }),
    known('employee_count', { count: 34 }),
    known('funding_round', { round: 'Series A' }),
  ])

  it('scores a perfect match at 100', () => {
    const result = scoreEntity(profile, COMPANY, fullKnowledge)
    expect(result.score).toBe(100)
    expect(result.qualified).toBe(true)
    expect(result.unknownCount).toBe(0)
  })

  it('produces the same number every time', () => {
    const first = scoreEntity(profile, COMPANY, fullKnowledge)
    const second = scoreEntity(profile, COMPANY, fullKnowledge)
    expect(first.score).toBe(second.score)
  })

  it('weights criteria proportionally', () => {
    // industry met (20) out of 20+15+15 = 50 → 40
    const partial = new Map([
      known('industry', { industry: 'software' }),
      known('employee_count', { count: 500 }),
      known('funding_round', { round: 'Series C' }),
    ])

    expect(scoreEntity(profile, COMPANY, partial).score).toBe(40)
  })

  it('NORMALISES over what could be evaluated, not the whole profile', () => {
    // Only industry is known, and it is met. Scoring out of the full 50 would
    // give 40 and punish the company for OUR missing data; it scores 100 of
    // the 20 points that could actually be judged, with unknownCount saying so.
    const thin = new Map([known('industry', { industry: 'software' })])

    const result = scoreEntity(profile, COMPANY, thin)
    expect(result.score).toBe(100)
    expect(result.unknownCount).toBe(2)
  })

  it('scores zero, and does not qualify, when nothing could be evaluated', () => {
    const result = scoreEntity(profile, COMPANY, new Map())
    expect(result.score).toBe(0)
    expect(result.qualified).toBe(false)
    expect(result.unknownCount).toBe(3)
  })
})

describe('scoreEntity — required and excluded', () => {
  it('disqualifies when a required criterion is not met', () => {
    const profile: QualificationProfile = {
      id: 'p',
      name: 'p',
      criteria: [
        criterion({ id: 'must-be-saas', field: 'industry', operator: 'contains', value: 'software', kind: 'required', weight: 20 }),
        criterion({ id: 'size', field: 'employee_count', operator: 'gte', value: 10, weight: 10 }),
      ],
    }

    const result = scoreEntity(profile, COMPANY, new Map([
      known('industry', { industry: 'construction' }),
      known('employee_count', { count: 400 }),
    ]))

    expect(result.qualified).toBe(false)
    expect(result.disqualifiedBy).toBe('must-be-saas')
  })

  it('does NOT disqualify when a required criterion is merely unknown', () => {
    // We do not know that it failed. Asserting otherwise fabricates a negative.
    const profile: QualificationProfile = {
      id: 'p',
      name: 'p',
      criteria: [
        criterion({ id: 'must-be-saas', field: 'industry', operator: 'contains', value: 'software', kind: 'required', weight: 20 }),
        criterion({ id: 'size', field: 'employee_count', operator: 'gte', value: 10, weight: 10 }),
      ],
    }

    const result = scoreEntity(profile, COMPANY, new Map([known('employee_count', { count: 400 })]))

    expect(result.disqualifiedBy).toBeNull()
    expect(result.qualified).toBe(true)
    expect(result.unknownCount).toBe(1)
  })

  it('disqualifies when an excluded criterion matches', () => {
    const profile: QualificationProfile = {
      id: 'p',
      name: 'p',
      criteria: [
        criterion({ id: 'size', field: 'employee_count', operator: 'gte', value: 10, weight: 10 }),
        criterion({ id: 'no-salesforce', field: 'tech_stack', operator: 'contains', value: 'salesforce', kind: 'excluded' }),
      ],
    }

    const result = scoreEntity(profile, COMPANY, new Map([
      known('employee_count', { count: 40 }),
      known('tech_stack', { detected: [{ id: 'salesforce', name: 'Salesforce' }] }),
    ]))

    expect(result.qualified).toBe(false)
    expect(result.disqualifiedBy).toBe('no-salesforce')
  })

  it('an excluded criterion contributes no points either way', () => {
    const profile: QualificationProfile = {
      id: 'p',
      name: 'p',
      criteria: [
        criterion({ id: 'size', field: 'employee_count', operator: 'gte', value: 10, weight: 10 }),
        criterion({ id: 'no-salesforce', field: 'tech_stack', operator: 'contains', value: 'salesforce', kind: 'excluded', weight: 99 }),
      ],
    }

    const result = scoreEntity(profile, COMPANY, new Map([
      known('employee_count', { count: 40 }),
      known('tech_stack', { detected: [{ id: 'shopify', name: 'Shopify' }] }),
    ]))

    expect(result.score).toBe(100)
    expect(result.qualified).toBe(true)
  })

  it('applies a qualification threshold', () => {
    const profile: QualificationProfile = {
      id: 'p',
      name: 'p',
      criteria: [
        criterion({ id: 'a', field: 'industry', operator: 'contains', value: 'software', weight: 50 }),
        criterion({ id: 'b', field: 'employee_count', operator: 'gte', value: 1000, weight: 50 }),
      ],
    }

    const knowledge = new Map([
      known('industry', { industry: 'software' }),
      known('employee_count', { count: 40 }),
    ])

    expect(scoreEntity(profile, COMPANY, knowledge, { qualifyAtOrAbove: 40 }).qualified).toBe(true)
    expect(scoreEntity(profile, COMPANY, knowledge, { qualifyAtOrAbove: 60 }).qualified).toBe(false)
  })
})

describe('explainResult', () => {
  it('explains a qualification from the arithmetic, not from prose', () => {
    const profile: QualificationProfile = {
      id: 'p',
      name: 'p',
      criteria: [
        criterion({ id: 'round', field: 'funding_round', operator: 'in', value: ['Series A'], weight: 15 }),
        criterion({ id: 'size', field: 'employee_count', operator: 'between', value: [10, 50], weight: 15 }),
      ],
    }

    const lines = explainResult(
      scoreEntity(profile, COMPANY, new Map([
        known('funding_round', { round: 'Series A' }),
        known('employee_count', { count: 34 }),
      ])),
    )

    expect(lines).toContain('funding_round = Series A')
    expect(lines).toContain('employee_count = 34')
  })

  it('says plainly when criteria could not be checked', () => {
    const profile: QualificationProfile = {
      id: 'p',
      name: 'p',
      criteria: [criterion({ id: 'a', field: 'industry', operator: 'exists', weight: 10 })],
    }

    expect(explainResult(scoreEntity(profile, COMPANY, new Map())).join(' ')).toContain('unknown')
  })

  it('leads with the disqualification when there is one', () => {
    const profile: QualificationProfile = {
      id: 'p',
      name: 'p',
      criteria: [
        criterion({ id: 'must-be-saas', field: 'industry', operator: 'contains', value: 'software', kind: 'required', weight: 20 }),
      ],
    }

    const lines = explainResult(
      scoreEntity(profile, COMPANY, new Map([known('industry', { industry: 'construction' })])),
    )

    expect(lines[0]).toContain('Disqualified by must-be-saas')
  })
})
