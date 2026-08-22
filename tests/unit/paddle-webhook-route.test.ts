import { EventName } from '@paddle/paddle-node-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  unmarshal: vi.fn(),
  syncCustomerEvent: vi.fn(),
  syncSubscriptionEvent: vi.fn(),
  syncTransactionCompletedEvent: vi.fn(),
}))

vi.mock('@/lib/paddle/server', () => ({
  getPaddleClient: () => ({ webhooks: { unmarshal: mocks.unmarshal } }),
  getPaddleWebhookSecret: () => 'pdl_ntfset_secret',
}))

vi.mock('@/lib/paddle/webhooks', () => ({
  syncCustomerEvent: mocks.syncCustomerEvent,
  syncSubscriptionEvent: mocks.syncSubscriptionEvent,
  syncTransactionCompletedEvent: mocks.syncTransactionCompletedEvent,
}))

import { POST } from '@/app/api/webhooks/paddle/route'

function delivery(signature = 'ts=1;h1=signature') {
  return new Request('https://outlio.io/api/webhooks/paddle', {
    method: 'POST',
    headers: { 'paddle-signature': signature },
    body: '{"untouched":true}',
  })
}

describe('Paddle webhook route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects a missing signature before reading an event', async () => {
    const response = await POST(new Request('https://outlio.io/api/webhooks/paddle', {
      method: 'POST',
      body: '{"untouched":true}',
    }))

    expect(response.status).toBe(400)
    expect(mocks.unmarshal).not.toHaveBeenCalled()
  })

  it('passes the raw body and signing secret to unmarshal', async () => {
    mocks.unmarshal.mockResolvedValue({
      eventId: 'evt_customer',
      eventType: EventName.CustomerCreated,
      data: {},
    })

    const response = await POST(delivery())

    expect(response.status).toBe(200)
    expect(mocks.unmarshal).toHaveBeenCalledWith(
      '{"untouched":true}',
      'pdl_ntfset_secret',
      'ts=1;h1=signature',
    )
    expect(mocks.syncCustomerEvent).toHaveBeenCalledOnce()
  })

  it('returns a retryable failure for invalid signatures', async () => {
    mocks.unmarshal.mockRejectedValue(new Error('invalid signature'))

    const response = await POST(delivery())

    expect(response.status).toBe(400)
    expect(mocks.syncCustomerEvent).not.toHaveBeenCalled()
  })

  it('returns a retryable failure when a verified handler fails', async () => {
    mocks.unmarshal.mockResolvedValue({
      eventId: 'evt_subscription',
      eventType: EventName.SubscriptionUpdated,
      data: {},
    })
    mocks.syncSubscriptionEvent.mockRejectedValue(new Error('database unavailable'))

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await POST(delivery())
    consoleError.mockRestore()

    expect(response.status).toBe(500)
  })
})
