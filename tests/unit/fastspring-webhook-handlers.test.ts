/**
 * Routing and money behaviour for verified FastSpring events.
 *
 * The credit arithmetic itself lives in SQL
 * (`grant_fastspring_period_credits`); what is asserted here is that each event
 * type reaches the right function with the right server-derived plan, that a
 * failed charge can never take the credit path, and that a duplicate is
 * reported as such.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
  }),
}))

vi.mock('@/lib/fastspring/config', () => ({
  planKeyForProductPath: (path: string) =>
    ({ 'pro-monthly': 'professional', 'lead-engine-yearly': 'starter' })[path] ?? null,
  billingIntervalForProductPath: (path: string) =>
    path.includes('year') ? 'year' : 'month',
}))

vi.mock('@/lib/fastspring/catalog', () => ({
  resolveProductMapping: async (path: string | null) =>
    path === 'pro-monthly'
      ? {
          productPath: path,
          planKey: 'professional',
          billingInterval: 'month',
          creditsPerMonth: 300,
        }
      : path
        ? { productPath: path, planKey: null, billingInterval: null, creditsPerMonth: null }
        : null,
}))

import { handleFastSpringEvent } from '@/lib/fastspring/webhooks'

const ACCOUNT = {
  id: 'acct_fabricated',
  contact: { email: 'buyer@example.com', first: 'Ada', last: 'Lovelace' },
}

function event(type: string, data: Record<string, unknown>, id = 'evt_1') {
  return { id, type, live: true, created: '2026-02-01T00:00:00.000Z', data }
}

function chargeCompleted(overrides: Record<string, unknown> = {}) {
  return event('subscription.charge.completed', {
    order: 'order_rebill',
    currency: 'GBP',
    total: 79,
    account: ACCOUNT,
    subscription: 'sub_fabricated',
    items: [{ product: 'pro-monthly', subscription: 'sub_fabricated' }],
    ...overrides,
  })
}

function chargeFailed() {
  return event('subscription.charge.failed', {
    reason: 'EXPIRED_CARD',
    account: ACCOUNT,
    subscription: {
      id: 'sub_fabricated',
      product: 'pro-monthly',
      currency: 'GBP',
      price: 79,
      declineReason: 'Card expired',
    },
  })
}

function args(): Record<string, unknown> {
  return mocks.rpc.mock.calls[0]![1] as Record<string, unknown>
}

describe('handleFastSpringEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({
      data: { claimed: true, user_id: 'a1b2c3d4-1111-4222-8333-444455556666', credits_allocated: 300 },
      error: null,
    })
    mocks.maybeSingle.mockResolvedValue({ data: { user_id: null }, error: null })
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('routes a successful rebill to the charge sync with status completed', async () => {
    const outcome = await handleFastSpringEvent(chargeCompleted())

    expect(mocks.rpc).toHaveBeenCalledWith('sync_fastspring_charge', expect.anything())
    expect(args()).toMatchObject({
      p_status: 'completed',
      p_subscription_id: 'sub_fabricated',
      p_charge_id: 'order_rebill',
      p_plan_key: 'professional',
      p_total: 79,
      p_decline_reason: null,
    })
    expect(outcome.creditsAllocated).toBe(300)
  })

  it('routes a failed rebill to the charge sync with status failed and a reason', async () => {
    mocks.rpc.mockResolvedValue({
      data: { claimed: true, user_id: 'a1b2c3d4-1111-4222-8333-444455556666', credits_allocated: 0 },
      error: null,
    })

    const outcome = await handleFastSpringEvent(chargeFailed())

    expect(mocks.rpc).toHaveBeenCalledWith('sync_fastspring_charge', expect.anything())
    expect(args()).toMatchObject({
      p_status: 'failed',
      p_subscription_id: 'sub_fabricated',
      p_decline_reason: 'EXPIRED_CARD: Card expired',
      p_charge_id: null,
    })
    // A failed charge must never allocate credits.
    expect(outcome.creditsAllocated).toBe(0)
  })

  it('derives the plan from the product path, never from the payload', async () => {
    await handleFastSpringEvent(
      event('order.completed', {
        id: 'order_first',
        currency: 'GBP',
        total: 79,
        account: ACCOUNT,
        // A hostile payload naming a different plan and a credit count.
        plan_key: 'custom',
        credits: 999_999,
        items: [{ product: 'pro-monthly', subscription: 'sub_fabricated' }],
      }),
    )

    expect(mocks.rpc).toHaveBeenCalledWith('sync_fastspring_order', expect.anything())
    const passed = args()
    expect(passed.p_plan_key).toBe('professional')
    expect(passed).not.toHaveProperty('p_credits')
    expect(Object.values(passed)).not.toContain(999_999)
    expect(Object.values(passed)).not.toContain('custom')
  })

  it('passes a null plan key for a product path outside the catalog', async () => {
    await handleFastSpringEvent(
      event('order.completed', {
        id: 'order_first',
        currency: 'GBP',
        total: 10,
        account: ACCOUNT,
        items: [{ product: 'some-other-product', subscription: null }],
      }),
    )

    expect(args().p_plan_key).toBeNull()
  })

  it('reports a duplicate rather than re-applying it', async () => {
    mocks.rpc.mockResolvedValue({
      data: { claimed: false, user_id: null, credits_allocated: 0 },
      error: null,
    })

    const outcome = await handleFastSpringEvent(chargeCompleted())

    expect(outcome).toEqual({ claimed: false, userId: null, creditsAllocated: 0 })
  })

  it.each([
    ['subscription.activated', 'sync_fastspring_subscription'],
    ['subscription.updated', 'sync_fastspring_subscription'],
    ['subscription.canceled', 'sync_fastspring_subscription'],
    ['subscription.deactivated', 'sync_fastspring_subscription'],
  ])('routes %s to %s', async (type, fn) => {
    mocks.rpc.mockResolvedValue({ data: true, error: null })

    await handleFastSpringEvent(
      event(type, {
        id: 'sub_fabricated',
        account: ACCOUNT,
        product: 'pro-monthly',
        state: type === 'subscription.deactivated' ? 'deactivated' : 'active',
        active: type !== 'subscription.deactivated',
      }),
    )

    expect(mocks.rpc).toHaveBeenCalledWith(fn, expect.anything())
  })

  it('ignores an event type outside the fulfillment contract', async () => {
    const outcome = await handleFastSpringEvent(
      event('subscription.trial.reminder', { id: 'sub_fabricated' }),
    )

    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(outcome).toEqual({ claimed: false, userId: null, creditsAllocated: 0 })
  })

  it('surfaces a database failure so the route can return a retryable 500', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'deadlock detected' } })

    await expect(handleFastSpringEvent(chargeCompleted())).rejects.toThrow('deadlock detected')
  })
})
