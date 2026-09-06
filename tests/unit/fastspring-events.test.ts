import { describe, expect, it } from 'vitest'

import {
  fastSpringEnvelopeSchema,
  parseOrderEvent,
  parseSubscriptionEvent,
} from '@/lib/fastspring/events'

const EXPANDED_ACCOUNT = {
  id: 'acct_fabricated',
  country: 'GB',
  language: 'en',
  contact: { email: 'buyer@example.com', first: 'Ada', last: 'Lovelace', company: 'Example Ltd' },
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_fabricated',
    account: EXPANDED_ACCOUNT,
    product: 'pro-monthly',
    state: 'active',
    active: true,
    autoRenew: true,
    currency: 'GBP',
    price: 79,
    begin: 1_767_225_600_000,
    nextChargeDate: 1_769_904_000_000,
    tags: { outlio_user_id: 'a1b2c3d4-1111-4222-8333-444455556666' },
    ...overrides,
  }
}

describe('fastSpringEnvelopeSchema', () => {
  it('accepts a batch of events and keeps each identifier', () => {
    const parsed = fastSpringEnvelopeSchema.parse({
      events: [
        { id: 'evt_1', type: 'order.completed', live: true, created: 1_767_225_600_000, data: {} },
        { id: 'evt_2', type: 'subscription.activated', live: false, created: 1, data: {} },
      ],
    })

    expect(parsed.events.map((event) => event.id)).toEqual(['evt_1', 'evt_2'])
    expect(parsed.events[0]!.created).toBe('2026-01-01T00:00:00.000Z')
    expect(parsed.events[1]!.live).toBe(false)
  })

  it('rejects an envelope with no events array', () => {
    expect(fastSpringEnvelopeSchema.safeParse({ order: 'not an envelope' }).success).toBe(false)
  })

  it('rejects an event with no identifier, since idempotency depends on it', () => {
    expect(
      fastSpringEnvelopeSchema.safeParse({ events: [{ type: 'order.completed', data: {} }] }).success,
    ).toBe(false)
  })
})

describe('parseSubscriptionEvent', () => {
  it('normalizes an expanded payload', () => {
    expect(parseSubscriptionEvent(subscription())).toEqual({
      subscriptionId: 'sub_fabricated',
      account: {
        accountId: 'acct_fabricated',
        email: 'buyer@example.com',
        name: 'Ada Lovelace',
        company: 'Example Ltd',
        country: 'GB',
        language: 'en',
      },
      productPath: 'pro-monthly',
      state: 'active',
      active: true,
      autoRenew: true,
      currency: 'GBP',
      price: 79,
      beginAt: '2026-01-01T00:00:00.000Z',
      nextChargeAt: '2026-02-01T00:00:00.000Z',
      canceledAt: null,
      deactivatedAt: null,
      tags: { outlio_user_id: 'a1b2c3d4-1111-4222-8333-444455556666' },
    })
  })

  it('accepts an unexpanded payload where account and product are bare IDs', () => {
    const parsed = parseSubscriptionEvent(
      subscription({ account: 'acct_fabricated', product: { product: 'pro-yearly' } }),
    )

    expect(parsed.account).toEqual({
      accountId: 'acct_fabricated',
      email: null,
      name: null,
      company: null,
      country: null,
      language: null,
    })
    expect(parsed.productPath).toBe('pro-yearly')
  })

  it('treats a canceled subscription with no explicit active flag as still paid', () => {
    const parsed = parseSubscriptionEvent(subscription({ state: 'canceled', active: undefined }))
    expect(parsed.active).toBe(true)
  })

  it('treats a deactivated subscription with no explicit active flag as ended', () => {
    const parsed = parseSubscriptionEvent(subscription({ state: 'deactivated', active: undefined }))
    expect(parsed.active).toBe(false)
  })

  it('reads the end of a cancellation from whichever field FastSpring sent', () => {
    expect(parseSubscriptionEvent(subscription({ end: 1_769_904_000_000 })).deactivatedAt).toBe(
      '2026-02-01T00:00:00.000Z',
    )
    expect(
      parseSubscriptionEvent(subscription({ deactivationDate: 1_769_904_000_000 })).deactivatedAt,
    ).toBe('2026-02-01T00:00:00.000Z')
  })

  it('refuses an unrecognised state rather than guessing at access', () => {
    expect(() => parseSubscriptionEvent(subscription({ state: 'suspended' }))).toThrow()
  })

  it('refuses a payload with no product path', () => {
    expect(() => parseSubscriptionEvent(subscription({ product: undefined }))).toThrow()
  })
})

describe('parseOrderEvent', () => {
  it('picks the subscription-bearing item out of a multi-item order', () => {
    const parsed = parseOrderEvent({
      id: 'order_fabricated',
      reference: 'EXAMPLE260101-1234-56789',
      account: EXPANDED_ACCOUNT,
      live: true,
      currency: 'GBP',
      total: 79,
      completed: 1_767_225_600_000,
      items: [
        { product: 'one-off-setup', subscription: null },
        { product: 'pro-monthly', subscription: 'sub_fabricated' },
      ],
      tags: { outlio_user_id: 'a1b2c3d4-1111-4222-8333-444455556666' },
    })

    expect(parsed.subscriptionId).toBe('sub_fabricated')
    expect(parsed.productPath).toBe('pro-monthly')
    expect(parsed.email).toBe('buyer@example.com')
    expect(parsed.completedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(parsed.live).toBe(true)
  })

  it('falls back to the top-level customer contact for the email', () => {
    const parsed = parseOrderEvent({
      id: 'order_fabricated',
      account: 'acct_fabricated',
      customer: { email: 'buyer@example.com' },
      currency: 'USD',
      items: [],
    })

    expect(parsed.email).toBe('buyer@example.com')
    expect(parsed.subscriptionId).toBeNull()
    expect(parsed.productPath).toBeNull()
    // An order that omits `live` is treated as real money, never as a test.
    expect(parsed.live).toBe(true)
  })
})
