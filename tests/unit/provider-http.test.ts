import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestJson } from '@/lib/intelligence/http'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('provider HTTP attempt hooks', () => {
  it('reserves a new distributed slot before every retry', async () => {
    const beforeAttempt = vi.fn(async () => undefined)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', {
        status: 429,
        headers: { 'retry-after': '0' },
      }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestJson({
      url: 'https://provider.example/data',
      beforeAttempt,
    })).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(beforeAttempt).toHaveBeenCalledTimes(2)
  })

  it('fails before fetch when a distributed limiter is unavailable', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestJson({
      url: 'https://provider.example/data',
      beforeAttempt: async () => {
        throw new Error('limiter unavailable')
      },
    })).rejects.toThrow('limiter unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not let retries extend an absolute deadline', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      await new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })
      return Response.json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requestJson({
        url: 'https://provider.example/data',
        timeoutMs: 1_000,
        deadlineAt: Date.now() + 20,
      }),
    ).rejects.toThrow('ERR_TIMEOUT')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('supports failover-oriented requests with retries disabled', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('{}', { status: 503 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requestJson({ url: 'https://provider.example/data', maxRetries: 0 }),
    ).rejects.toThrow('ERR_PROVIDER_UNAVAILABLE')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
