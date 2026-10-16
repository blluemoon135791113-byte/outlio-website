import { afterEach, describe, expect, it, vi } from 'vitest'

import { isLocalFailure, ProviderHttpError, requestJson, setHostPacing } from '@/lib/intelligence/http'

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

describe('pacing never spends a request it cannot finish', () => {
  it('gives up LOCALLY, without fetching, when its turn would come after its deadline', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    setHostPacing('paced.example', 5_000)

    // The first request takes the slot; the second would wait ~5s.
    await requestJson({ url: 'https://paced.example/a', deadlineAt: Date.now() + 10_000 })
    const started = Date.now()
    const second = requestJson({ url: 'https://paced.example/b', deadlineAt: Date.now() + 2_000, maxRetries: 3 })

    const error = await second.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProviderHttpError)
    expect(isLocalFailure(error)).toBe(true)
    expect(Date.now() - started).toBeLessThan(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a real remote failure is NOT local', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    const error = await requestJson({ url: 'https://remote.example/x', maxRetries: 0 }).catch((caught: unknown) => caught)
    expect(isLocalFailure(error)).toBe(false)
  })
})

