import { describe, expect, it } from 'vitest'

import { fastSpringSubscriptionGrantsAccess } from '@/lib/fastspring/access'

describe('fastSpringSubscriptionGrantsAccess', () => {
  it.each(['active', 'trial'] as const)('grants access for an active %s subscription', (state) => {
    expect(fastSpringSubscriptionGrantsAccess(state, true)).toBe(true)
  })

  it('keeps access for a cancellation that has not taken effect yet', () => {
    // FastSpring sends state=canceled with active=true for the remainder of the
    // period the customer already paid for. Revoking here would cut off paid access.
    expect(fastSpringSubscriptionGrantsAccess('canceled', true)).toBe(true)
  })

  it('revokes access once FastSpring deactivates the subscription', () => {
    expect(fastSpringSubscriptionGrantsAccess('deactivated', false)).toBe(false)
  })

  it('denies access while a subscription is overdue', () => {
    expect(fastSpringSubscriptionGrantsAccess('overdue', true)).toBe(false)
  })

  it.each(['active', 'trial', 'canceled'] as const)(
    'never grants access when %s is not active',
    (state) => {
      expect(fastSpringSubscriptionGrantsAccess(state, false)).toBe(false)
    },
  )
})
