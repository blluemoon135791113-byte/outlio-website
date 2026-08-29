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

  it('keeps agency marketing off the software domain without leaving it', async () => {
    const response = await proxy(appRequest('/explainers'))

    // A cross-domain bounce is exactly what a payment reviewer must not see.
    expect(getRedirectUrl(response)).toBeNull()
    expect(getRewrittenUrl(response)).toBe('https://app.outlio.io/not-found')
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
