import { getRedirectUrl } from 'next/experimental/testing/server'
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it } from 'vitest'

import { proxy } from '@/proxy'

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

afterEach(() => {
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
  if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey
})

describe('app.outlio.io software surface', () => {
  it('sends the bare app domain to the public Lead Engine product page', async () => {
    const response = await proxy(new NextRequest('https://app.outlio.io/', {
      headers: { host: 'app.outlio.io' },
    }))

    expect(getRedirectUrl(response)).not.toBeNull()
    expect(getRedirectUrl(response)).toBe('https://app.outlio.io/leadengine')
  })

  it('serves Lead Engine pages directly on the app domain', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

    const response = await proxy(new NextRequest('https://app.outlio.io/leadengine/pricing', {
      headers: { host: 'app.outlio.io' },
    }))

    expect(getRedirectUrl(response)).toBeNull()
    expect(response.headers.get('vary')).toBe('Accept, Accept-Encoding')
  })

  it('keeps agency marketing routes off the software domain', async () => {
    const response = await proxy(new NextRequest('https://app.outlio.io/services', {
      headers: { host: 'app.outlio.io' },
    }))

    expect(getRedirectUrl(response)).not.toBeNull()
    expect(getRedirectUrl(response)).toBe('https://outlio.io/services')
  })
})
