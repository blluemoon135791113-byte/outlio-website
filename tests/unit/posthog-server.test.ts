import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  capture: vi.fn(),
  flush: vi.fn(async (): Promise<void> => undefined),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('posthog-node', () => ({
  PostHog: class PostHog {
    capture = mocks.capture
    flush = mocks.flush
  },
}))

describe('PostHog server delivery', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = 'phc_test'
  })

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
  })

  it('awaits immediate worker delivery without using a request context', async () => {
    let releaseFlush: (() => void) | undefined
    mocks.flush.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFlush = resolve
        }),
    )

    const { captureServerEvent } = await import('@/lib/posthog-server')
    let settled = false
    const delivery = captureServerEvent(
      'user-123',
      'extractor_job_finished',
      { result: 'completed' },
      { delivery: 'immediate' },
    ).then(() => {
      settled = true
    })

    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce())
    expect(mocks.after).not.toHaveBeenCalled()
    expect(settled).toBe(false)

    releaseFlush?.()
    await delivery
    expect(settled).toBe(true)
  })

  it('keeps request delivery scheduled through Next after', async () => {
    const { captureServerEvent } = await import('@/lib/posthog-server')

    await captureServerEvent('user-123', 'account_signed_in', { requires_mfa: false })

    expect(mocks.after).toHaveBeenCalledOnce()
    expect(mocks.capture).not.toHaveBeenCalled()

    const scheduled = mocks.after.mock.calls[0]?.[0] as (() => Promise<void>) | undefined
    await scheduled?.()
    expect(mocks.capture).toHaveBeenCalledOnce()
    expect(mocks.flush).toHaveBeenCalledOnce()
  })
})
