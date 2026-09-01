import { readdirSync } from 'node:fs'

import {
  getRedirectUrl,
  getRewrittenUrl,
  isRewrite,
} from 'next/experimental/testing/server'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { proxy } from '@/proxy'

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

// Without Supabase configured the proxy returns before touching the network,
// which is what lets these assert routing in isolation.
beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
})

afterEach(() => {
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
  if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey
})

const appRequest = (path: string) =>
  new NextRequest(`https://app.outlio.io${path}`, {
    headers: { host: 'app.outlio.io' },
  })

describe('app.outlio.io software surface', () => {
  it('serves the Lead Engine homepage at the bare app domain, without redirecting', async () => {
    const response = await proxy(appRequest('/'))

    expect(getRedirectUrl(response)).toBeNull()
    expect(isRewrite(response)).toBe(true)
    expect(getRewrittenUrl(response)).toBe('https://app.outlio.io/app-home')
  })

  it('renders the internal homepage rewrite instead of redirecting it back into a loop', async () => {
    const response = await proxy(
      new NextRequest('https://app.outlio.io/app-home', {
        headers: {
          host: 'app.outlio.io',
          'x-outlio-internal-rewrite': '1',
        },
      }),
    )

    expect(getRedirectUrl(response)).toBeNull()
  })

  it('serves the Lead Engine terms at /terms on the app domain', async () => {
    const response = await proxy(appRequest('/terms'))

    expect(getRedirectUrl(response)).toBeNull()
    expect(getRewrittenUrl(response)).toBe('https://app.outlio.io/app-terms')
  })

  it.each(['/pricing', '/how-it-works', '/product', '/privacy-policy', '/refund-policy'])(
    'serves %s directly on the app domain',
    async (path) => {
      const response = await proxy(appRequest(path))

      expect(getRedirectUrl(response)).toBeNull()
      expect(isRewrite(response)).toBe(false)
      expect(response.headers.get('vary')).toBe('Accept, Accept-Encoding')
    },
  )

  it.each(['/crm', '/crm/pipeline'])(
    'resolves %s on the software domain rather than 404ing it',
    async (path) => {
      // Omitting /crm from APP_SUBDOMAIN_PATHS would rewrite the whole CRM to
      // /not-found on the only host it is ever reached from.
      const response = await proxy(appRequest(path))

      expect(getRewrittenUrl(response)).not.toBe('https://app.outlio.io/not-found')
      expect(getRedirectUrl(response)).toBeNull()
    },
  )

  it('keeps agency marketing off the software domain without leaving it', async () => {
    const response = await proxy(appRequest('/explainers'))

    // A cross-domain bounce is exactly what a payment reviewer must not see.
    expect(getRedirectUrl(response)).toBeNull()
    expect(getRewrittenUrl(response)).toBe('https://app.outlio.io/not-found')
  })

  it('moves the old app privacy path to the public SaaS policy on the same host', async () => {
    const response = await proxy(appRequest('/privacy'))

    expect(getRedirectUrl(response)).toBe('https://app.outlio.io/privacy-policy')
    expect(response.status).toBe(308)
  })

  it('never exposes the internal rewrite targets as URLs', async () => {
    for (const [internal, canonical] of [
      ['/app-home', 'https://app.outlio.io/'],
      ['/app-terms', 'https://app.outlio.io/terms'],
    ]) {
      const response = await proxy(appRequest(internal))
      expect(getRedirectUrl(response)).toBe(canonical)
      expect(response.status).toBe(308)
    }
  })
})

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  EVERY PRODUCT ROUTE MUST SURVIVE THE EDGE GUARD.                        ║
 * ║                                                                           ║
 * ║  `/email` and `/flows` shipped in M5-M7 and were never added to           ║
 * ║  APP_SUBDOMAIN_PATHS, so the entire Email and Flows product returned 404  ║
 * ║  in production for months. Nothing caught it: unit tests, typecheck and   ║
 * ║  `next build` all pass, because none of them go through the proxy. The    ║
 * ║  route existed, was correct, and was unreachable.                         ║
 * ║                                                                           ║
 * ║  ⚠️ THE LIST IS READ FROM THE FILESYSTEM, NOT HARDCODED. A test with its  ║
 * ║  own copy of the routes fails the same way the allow-list did — someone   ║
 * ║  adds a surface and forgets the second place. Reading `app/(product)/`    ║
 * ║  means a new route is covered the moment it exists.                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
describe('every product surface is reachable on the software domain', () => {
  const productRoutes = readdirSync('app/(product)', { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => `/${entry.name}`)

  it('found the product routes to check', () => {
    // Guards against the glob silently matching nothing, which would make
    // every assertion below vacuous.
    expect(productRoutes.length).toBeGreaterThan(3)
    expect(productRoutes).toContain('/email')
    expect(productRoutes).toContain('/flows')
    expect(productRoutes).toContain('/crm')
  })

  for (const route of readdirSync('app/(product)', { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => `/${entry.name}`)) {
    it(`does not 404 ${route} on app.outlio.io`, async () => {
      const response = await proxy(appRequest(route))

      /*
       * ⚠️ ASSERTED ON THE REWRITE TARGET, NOT THE STATUS CODE. The guard does
       * not return a 404 — it REWRITES to `/not-found`, so the response status
       * is a perfectly healthy 200 and a status assertion passes whether the
       * path is allow-listed or not. The first version of this test did
       * exactly that and passed with `/email` deliberately removed, which is
       * how it was caught.
       *
       * Redirecting to sign-in is correct and expected; being rewritten to
       * not-found means the host refuses to serve the route at all.
       */
      const rewritten = getRewrittenUrl(response)
      if (rewritten) expect(rewritten).not.toContain('/not-found')
    })
  }
})

describe('outlio.io marketing surface', () => {
  const siteRequest = (path: string) =>
    new NextRequest(`https://outlio.io${path}`, { headers: { host: 'outlio.io' } })

  it('still serves the agency homepage and terms', async () => {
    for (const path of ['/', '/terms']) {
      const response = await proxy(siteRequest(path))
      expect(getRedirectUrl(response)).toBeNull()
      expect(isRewrite(response)).toBe(false)
    }
  })
})
