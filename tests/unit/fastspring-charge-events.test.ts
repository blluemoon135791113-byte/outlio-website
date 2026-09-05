/**
 * Parsing for the two charge payloads, which are shaped unlike each other and
 * unlike `order.completed`:
 *
 *   subscription.charge.completed — an order at the root, its ID under `order`
 *                                   rather than `id`, subscription nested.
 *   subscription.charge.failed    — no order at all: {reason, account,
 *                                   subscription}, money on the subscription.
 */
import { describe, expect, it } from 'vitest'

import { parseChargeFailedEvent, parseOrderEvent } from '@/lib/fastspring/events'

const ACCOUNT = {
  id: 'acct_fabricated',
  country: 'GB',
  language: 'en',
  contact: { email: 'buyer@example.com', first: 'Ada', last: 'Lovelace' },
}

describe('parseOrderEvent for subscription.charge.completed', () => {
  it('reads the order id from `order` and the subscription from the root', () => {
    const parsed = parseOrderEvent({
      order: 'order_rebill_fabricated',
      reference: 'EXAMPLE260201-1234-56789',
      currency: 'GBP',
      total: 79,
      status: 'completed',
      timestamp: 1_769_904_000_000,
      account: ACCOUNT,
      subscription: { id: 'sub_fabricated', product: 'pro-monthly' },
      items: [{ product: 'pro-monthly', subscription: 'sub_fabricated' }],
      tags: { outlio_user_id: 'a1b2c3d4-1111-4222-8333-444455556666' },
    })

    expect(parsed.orderId).toBe('order_rebill_fabricated')
    expect(parsed.subscriptionId).toBe('sub_fabricated')
    expect(parsed.productPath).toBe('pro-monthly')
    expect(parsed.total).toBe(79)
    expect(parsed.completedAt).toBe('2026-02-01T00:00:00.000Z')
  })

  it('accepts a bare subscription id at the root', () => {
    const parsed = parseOrderEvent({
      order: 'order_rebill_fabricated',
      currency: 'USD',
      total: 29,
      account: 'acct_fabricated',
      subscription: 'sub_fabricated',
      items: [],
    })

    expect(parsed.subscriptionId).toBe('sub_fabricated')
  })

  it('prefers the root subscription over an item subscription', () => {
    const parsed = parseOrderEvent({
      order: 'order_rebill_fabricated',
      currency: 'USD',
      total: 29,
      subscription: 'sub_root',
      items: [{ product: 'pro-monthly', subscription: 'sub_item' }],
    })

    expect(parsed.subscriptionId).toBe('sub_root')
  })

  it('refuses a payload carrying neither `id` nor `order`', () => {
    expect(() => parseOrderEvent({ currency: 'USD', items: [] })).toThrow(
      'no order identifier',
    )
  })
})

describe('parseChargeFailedEvent', () => {
  it('reads the subscription, money and decline reason off the nested object', () => {
    const parsed = parseChargeFailedEvent({
      reason: 'EXPIRED_CARD',
      account: ACCOUNT,
      subscription: {
        id: 'sub_fabricated',
        product: 'pro-monthly',
        currency: 'GBP',
        price: 79,
        state: 'overdue',
        declineReason: 'Card expired',
        tags: { outlio_user_id: 'a1b2c3d4-1111-4222-8333-444455556666' },
      },
    })

    expect(parsed.subscriptionId).toBe('sub_fabricated')
    expect(parsed.account?.accountId).toBe('acct_fabricated')
    expect(parsed.email).toBe('buyer@example.com')
    expect(parsed.productPath).toBe('pro-monthly')
    expect(parsed.currency).toBe('GBP')
    expect(parsed.total).toBe(79)
    expect(parsed.declineReason).toBe('EXPIRED_CARD: Card expired')
    expect(parsed.tags).toEqual({ outlio_user_id: 'a1b2c3d4-1111-4222-8333-444455556666' })
  })

  it('falls back to the account nested on the subscription', () => {
    const parsed = parseChargeFailedEvent({
      reason: 'DECLINED',
      subscription: { subscription: 'sub_fabricated', account: ACCOUNT },
    })

    expect(parsed.subscriptionId).toBe('sub_fabricated')
    expect(parsed.account?.accountId).toBe('acct_fabricated')
    expect(parsed.declineReason).toBe('DECLINED')
  })

  it('refuses a payload with no subscription identifier', () => {
    expect(() => parseChargeFailedEvent({ reason: 'DECLINED', subscription: {} })).toThrow(
      'no subscription identifier',
    )
  })
})
