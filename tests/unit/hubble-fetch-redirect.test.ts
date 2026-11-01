/**
 * Redirect chains on the Hubble page reader.
 *
 * A company site commonly answers `example.com` → `www.example.com` → `/home`.
 * One hop was all the reader followed, so such a site read as nothing. Every
 * hop is still screened, and a loop or a long chain still stops.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/hubble/net/guard', () => ({
  assertFetchable: async (raw: string) => {
    const url = new URL(raw)
    return url.hostname === 'internal.example.com'
      ? { allowed: false, reason: 'resolves to reserved address' }
      : { allowed: true, url: url.toString(), host: url.hostname }
  },
}))

import { HttpPageFetcher } from '@/lib/hubble/fetch/fetcher'

const PAGE = `<html><head><title>Example Health</title></head><body><main>${'<p>Example Health serves members across the region with plans and care. Call us any weekday for help with your coverage.</p>'.repeat(6)}</main></body></html>`

function redirect(location: string): Response {
  return new Response(null, { status: 301, headers: { location } })
}

function stubFetch(routes: Record<string, () => Response>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const route = routes[url]
    if (!route) throw new Error(`unexpected fetch ${url}`)
    return route()
  }))
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('following redirects', () => {
  it('reads a page two hops away', async () => {
    const calls = stubFetch({
      'https://example.com/': () => redirect('https://www.example.com/'),
      'https://www.example.com/': () => redirect('/home'),
      'https://www.example.com/home': () => new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html' } }),
    })
    const page = await new HttpPageFetcher().fetchPage('https://example.com/')
    expect('content' in page && page.url).toBe('https://www.example.com/home')
    expect(calls).toHaveLength(3)
  })

  it('stops at a hop the guard refuses', async () => {
    stubFetch({
      'https://example.com/': () => redirect('https://www.example.com/'),
      'https://www.example.com/': () => redirect('https://internal.example.com/'),
    })
    const page = await new HttpPageFetcher().fetchPage('https://example.com/')
    expect(page).toMatchObject({ code: 'blocked' })
  })

  it('stops a loop', async () => {
    stubFetch({
      'https://example.com/': () => redirect('https://www.example.com/'),
      'https://www.example.com/': () => redirect('https://example.com/'),
    })
    const page = await new HttpPageFetcher().fetchPage('https://example.com/')
    expect(page).toMatchObject({ code: 'http_error', detail: 'redirect loop or chain too long' })
  })
})
