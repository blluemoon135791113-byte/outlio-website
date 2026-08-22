import { describe, expect, it } from 'vitest'

import { paddleSubscriptionGrantsAccess } from '@/lib/paddle/access'

describe('paddleSubscriptionGrantsAccess', () => {
  it.each(['active', 'trialing'] as const)('grants access for %s', (status) => {
    expect(paddleSubscriptionGrantsAccess(status)).toBe(true)
  })

  it.each(['paused', 'past_due', 'canceled'] as const)('denies access for %s', (status) => {
    expect(paddleSubscriptionGrantsAccess(status)).toBe(false)
  })
})
