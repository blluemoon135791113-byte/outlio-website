import { describe, expect, it } from 'vitest'

import { researchIdempotencyKey } from '@/lib/intelligence/run'

const scope = {
  type: 'lead_ids' as const,
  leadIds: ['11111111-1111-4111-8111-111111111111'],
}

const plan = {
  entityScope: 'people' as const,
  requiredFields: ['work_email' as const, 'industry' as const],
  outputFields: [],
  filters: {},
  clarificationRequired: false,
  clarificationQuestions: [],
}

describe('researchIdempotencyKey', () => {
  it('normalizes whitespace and object key order', () => {
    expect(researchIdempotencyKey({ queryText: ' Find   email ', scope, plan }))
      .toBe(researchIdempotencyKey({ queryText: 'find email', scope, plan: { ...plan, filters: {} } }))
  })

  it('changes when the requested work changes', () => {
    expect(researchIdempotencyKey({ queryText: 'find email', scope, plan }))
      .not.toBe(researchIdempotencyKey({
        queryText: 'find email',
        scope,
        plan: { ...plan, requiredFields: ['mobile_phone'] },
      }))
  })
})

