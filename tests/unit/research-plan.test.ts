/**
 * The ResearchPlan schema.
 *
 * This is the gate between "what a model proposed" and "what we spend money
 * on" (spec §6). In Phase 4 an LLM produces these, so the tests below are
 * really about what happens when a model returns something plausible but wrong.
 */
import { describe, expect, it } from 'vitest'

import {
  isExecutable,
  researchScopeSchema,
  validatePlan,
  type ResearchPlan,
} from '@/lib/intelligence/plan'

const VALID = {
  entityScope: 'companies',
  requiredFields: ['funding_round', 'funding_amount', 'funding_date'],
  outputFields: ['person_name', 'company_name', 'funding_amount'],
  filters: { funding_round: 'Series A', minimum_funding_amount_usd: 5_000_000 },
  clarificationRequired: false,
}

describe('validatePlan', () => {
  it('accepts the spec §6 example plan', () => {
    const result = validatePlan(VALID)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.requiredFields).toEqual([
      'funding_round',
      'funding_amount',
      'funding_date',
    ])
  })

  it('applies defaults so a minimal plan is still complete', () => {
    const result = validatePlan({ requiredFields: ['tech_stack'] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.entityScope).toBe('companies')
    expect(result.plan.filters).toEqual({})
    expect(result.plan.clarificationRequired).toBe(false)
  })

  it('REJECTS a field the system cannot research', () => {
    // A model asked for something we have no provider for. Rejecting is the
    // point: an unknown field would route to nothing and quietly return blanks.
    const result = validatePlan({ ...VALID, requiredFields: ['ceo_favourite_colour'] })
    expect(result.ok).toBe(false)
  })

  it('rejects a plan with no required fields', () => {
    // Nothing to research means nothing to spend. Refuse rather than run empty.
    expect(validatePlan({ ...VALID, requiredFields: [] }).ok).toBe(false)
  })

  it('rejects garbage without throwing', () => {
    for (const candidate of [null, undefined, 'a plan', 42, [], {}]) {
      expect(validatePlan(candidate).ok, JSON.stringify(candidate)).toBe(false)
    }
  })

  it('does not echo the offending value in the reason', () => {
    // Rejection reasons reach logs; a query can carry a customer's lead names.
    const result = validatePlan({ requiredFields: ['Jordan Rivera at Acme'] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).not.toContain('Jordan')
  })
})

describe('isExecutable', () => {
  it('blocks a plan that is still waiting on clarification', () => {
    const result = validatePlan({ ...VALID, clarificationRequired: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // A clarification-pending plan is valid; it just must not spend anything
    // until the user has answered (spec §7).
    expect(isExecutable(result.plan)).toBe(false)
  })

  it('allows a complete plan', () => {
    const result = validatePlan(VALID)
    if (!result.ok) throw new Error('expected a valid plan')
    expect(isExecutable(result.plan)).toBe(true)
  })
})

describe('researchScopeSchema', () => {
  it('accepts each supported scope', () => {
    expect(
      researchScopeSchema.safeParse({
        type: 'lead_ids',
        leadIds: ['00000000-0000-4000-8000-000000000001'],
      }).success,
    ).toBe(true)

    expect(
      researchScopeSchema.safeParse({
        type: 'extraction_job',
        extractionJobId: '00000000-0000-4000-8000-000000000002',
      }).success,
    ).toBe(true)

    expect(researchScopeSchema.safeParse({ type: 'all_leads' }).success).toBe(true)
  })

  it('has no default — a missing scope can never become "everything"', () => {
    // The expensive scope must always be chosen explicitly (spec §31).
    expect(researchScopeSchema.safeParse(undefined).success).toBe(false)
    expect(researchScopeSchema.safeParse({}).success).toBe(false)
  })

  it('rejects an empty or non-uuid lead selection', () => {
    expect(researchScopeSchema.safeParse({ type: 'lead_ids', leadIds: [] }).success).toBe(false)
    expect(
      researchScopeSchema.safeParse({ type: 'lead_ids', leadIds: ['not-a-uuid'] }).success,
    ).toBe(false)
  })

  it('caps a single run so one request cannot enqueue unbounded work', () => {
    const tooMany = Array.from({ length: 10_001 }, () => '00000000-0000-4000-8000-000000000001')
    expect(researchScopeSchema.safeParse({ type: 'lead_ids', leadIds: tooMany }).success).toBe(false)
  })
})

describe('plan shape drives cost', () => {
  it('only the required fields decide which providers run', () => {
    // Guards the rule behind spec acceptance Test 2: asking for emails must not
    // widen into funding or tech-stack research. `outputFields` is presentation
    // only and must never influence routing.
    const result = validatePlan({
      requiredFields: ['work_email'],
      outputFields: ['Company', 'Funding round', 'Tech stack'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const plan: ResearchPlan = result.plan
    expect(plan.requiredFields).toEqual(['work_email'])
  })
})
