import { createHmac } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const SECRET = 'fastspring-hmac-secret'

const mocks = vi.hoisted(() => ({
  handleFastSpringEvent: vi.fn(),
  isTest: true,
}))

vi.mock('@/lib/fastspring/server', () => ({
  getFastSpringWebhookSecret: () => 'fastspring-hmac-secret',
}))

vi.mock('@/lib/fastspring/config', () => ({
  getStorefront: () => ({
    storefront: 'husnain.test.onfastspring.com/popup-husnain',
    isTest: mocks.isTest,
  }),
}))

vi.mock('@/lib/fastspring/webhooks', () => ({
  handleFastSpringEvent: mocks.handleFastSpringEvent,
}))

import { POST } from '@/app/api/webhooks/fastspring/route'

function delivery(body: string, signature = createHmac('sha256', SECRET).update(body).digest('base64')) {
  return new Request('https://app.outlio.io/api/webhooks/fastspring', {
    method: 'POST',
    headers: { 'x-fs-signature': signature },
    body,
  })
}

function envelope(...events: Record<string, unknown>[]) {
  return JSON.stringify({ events })
}

describe('FastSpring webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isTest = true
    mocks.handleFastSpringEvent.mockResolvedValue({
      claimed: true,
      userId: 'a1b2c3d4-1111-4222-8333-444455556666',
      creditsAllocated: 0,
    })
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('rejects a missing signature before reading an event', async () => {
    const response = await POST(
      new Request('https://app.outlio.io/api/webhooks/fastspring', {
        method: 'POST',
        body: envelope({ id: 'evt_1', type: 'order.completed', data: {} }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.handleFastSpringEvent).not.toHaveBeenCalled()
  })

  it('rejects a body whose digest does not match', async () => {
    const response = await POST(
      delivery(envelope({ id: 'evt_1', type: 'order.completed', data: {} }), 'bm90LWEtc2lnbmF0dXJl'),
    )

    expect(response.status).toBe(400)
    expect(mocks.handleFastSpringEvent).not.toHaveBeenCalled()
  })

  it('processes every event in a verified batch', async () => {
    const response = await POST(
      delivery(
        envelope(
          { id: 'evt_1', type: 'account.created', live: true, data: {} },
          { id: 'evt_2', type: 'subscription.activated', live: true, data: {} },
        ),
      ),
    )

    expect(response.status).toBe(200)
    expect(mocks.handleFastSpringEvent).toHaveBeenCalledTimes(2)
    expect(mocks.handleFastSpringEvent.mock.calls[1]![0]).toMatchObject({
      id: 'evt_2',
      type: 'subscription.activated',
    })
  })

  it('drops test-mode events when the storefront is live', async () => {
    mocks.isTest = false
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const response = await POST(
      delivery(
        envelope(
          { id: 'evt_1', type: 'order.completed', live: false, data: {} },
          { id: 'evt_2', type: 'order.completed', live: true, data: {} },
        ),
      ),
    )
    warn.mockRestore()

    expect(response.status).toBe(200)
    expect(mocks.handleFastSpringEvent).toHaveBeenCalledOnce()
    expect(mocks.handleFastSpringEvent.mock.calls[0]![0]).toMatchObject({ id: 'evt_2' })
  })

  it('processes test-mode events while the storefront is a test store', async () => {
    const response = await POST(
      delivery(envelope({ id: 'evt_1', type: 'order.completed', live: false, data: {} })),
    )

    expect(response.status).toBe(200)
    expect(mocks.handleFastSpringEvent).toHaveBeenCalledOnce()
  })

  it('logs a duplicate rather than treating it as a failure', async () => {
    mocks.handleFastSpringEvent.mockResolvedValue({
      claimed: false,
      userId: null,
      creditsAllocated: 0,
    })
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    const response = await POST(
      delivery(envelope({ id: 'evt_1', type: 'order.completed', live: true, data: {} })),
    )
    const lines = info.mock.calls.map(([line]) => String(line))
    info.mockRestore()

    expect(response.status).toBe(200)
    expect(lines.some((line) => line.includes('event.duplicate_ignored'))).toBe(true)
  })

  it('returns a retryable failure when a verified handler fails', async () => {
    mocks.handleFastSpringEvent.mockRejectedValueOnce(new Error('database unavailable'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await POST(
      delivery(envelope({ id: 'evt_1', type: 'subscription.updated', live: true, data: {} })),
    )
    error.mockRestore()

    expect(response.status).toBe(500)
  })

  it('acknowledges a signed but unreadable body rather than retrying forever', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await POST(delivery('{"not":"an envelope"}'))
    error.mockRestore()

    expect(response.status).toBe(400)
    expect(mocks.handleFastSpringEvent).not.toHaveBeenCalled()
  })
})
