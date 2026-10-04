import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let bag: Record<string, unknown>
const auth = { accessToken: 'fixture-access', refreshToken: 'fixture-refresh', deviceId: 'fixture-device' }
const rotated = { ...auth, accessToken: 'fixture-new-access', refreshToken: 'fixture-new-refresh' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

beforeEach(() => {
  vi.resetModules()
  bag = { 'outlio.auth': auth, 'outlio.session': 'fixture-session' }
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async () => ({ ...bag })),
    set: vi.fn(async (items) => { Object.assign(bag, items) }),
    remove: vi.fn(async (keys: string[]) => { keys.forEach((key) => { delete bag[key] }) }),
  } } })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('extension API client', () => {
  it('uses the product host directly, not an auth-stripping marketing redirect', async () => {
    const { API_BASE } = await import('../../extensions/core/api')
    expect(API_BASE).toBe('https://app.outlio.io')
  })
  it('shares a refresh across concurrent sidebar polling and captures', async () => {
    let refreshes = 0
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/refresh')) {
        refreshes++
        await new Promise((resolve) => setTimeout(resolve, 10))
        return json(rotated)
      }
      const headers = init.headers as Record<string, string>
      return headers.authorization === `Bearer ${rotated.accessToken}`
        ? json({ canCapture: true, device: { id: auth.deviceId }, success: true })
        : json({ error: 'TOKEN_EXPIRED' }, 401)
    })
    vi.stubGlobal('fetch', fetch)
    const { fetchMe, sendPage } = await import('../../extensions/core/api')
    const page = { sessionId: 's', html: '<html>fixture</html>', sourceUrl: 'fixture', pageName: 'Accounts', pageIdentifier: '1', contentHash: 'hash' }
    await Promise.all([fetchMe(), fetchMe(), sendPage(page)])
    expect(refreshes).toBe(1)
    expect(bag['outlio.auth']).toEqual(rotated)
    const posts = fetch.mock.calls.filter(([url]) => url.endsWith('/capture'))
    expect(posts).toHaveLength(2)
    expect(posts[1][1].body).toBe(JSON.stringify(page))
  })
  it('does not rotate again when a late 401 used the previous access token', async () => {
    let release!: () => void
    const delayed = new Promise<void>((resolve) => { release = resolve })
    let oldRequests = 0
    let refreshes = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/refresh')) { refreshes++; return json(rotated) }
      if ((init.headers as Record<string, string>).authorization === `Bearer ${auth.accessToken}`) {
        if (++oldRequests === 2) await delayed
        return json({ error: 'TOKEN_EXPIRED' }, 401)
      }
      return json({ canCapture: true })
    }))
    const { fetchMe } = await import('../../extensions/core/api')
    const first = fetchMe(); const second = fetchMe()
    await first; release(); await second
    expect(refreshes).toBe(1)
  })
  it('retains credentials and the session during a transient refresh outage', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/refresh') ? json({}, 503) : json({ error: 'TOKEN_EXPIRED' }, 401)))
    const { fetchMe } = await import('../../extensions/core/api')
    await expect(fetchMe()).rejects.toMatchObject({ code: 'NETWORK' })
    expect(bag['outlio.auth']).toEqual(auth)
    expect(bag['outlio.session']).toBe('fixture-session')
  })
  it('clears local capture consent when refresh revokes the device', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'UNAUTHENTICATED' }, 401)))
    const { fetchMe } = await import('../../extensions/core/api')
    await expect(fetchMe()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(bag['outlio.auth']).toBeUndefined()
    expect(bag['outlio.session']).toBeUndefined()
  })
  it('retries only once even when the new access token is rejected', async () => {
    const fetch = vi.fn(async (url: string) => url.endsWith('/refresh') ? json(rotated) : json({ error: 'TOKEN_EXPIRED' }, 401))
    vi.stubGlobal('fetch', fetch)
    const { fetchMe } = await import('../../extensions/core/api')
    await expect(fetchMe()).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})
