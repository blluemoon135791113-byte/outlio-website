/**
 * The integration-route origin allow-list.
 *
 * ⚠️ CARRIED OVER FROM `hubspot-integration.test.ts` WHEN HUBSPOT AND
 * SALESFORCE WERE DELETED. The check protects the GoHighLevel routes — which
 * remain — and deleting a provider must not quietly delete a security test with
 * it. The suffix case below is the one that matters.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { isApprovedOutlioAppOrigin } from '@/lib/integrations/origin'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isApprovedOutlioAppOrigin', () => {
  it('allows the production app hosts', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(isApprovedOutlioAppOrigin('https://outlio.io')).toBe(true)
    expect(isApprovedOutlioAppOrigin('https://app.outlio.io')).toBe(true)
  })

  it('REFUSES a host that merely starts with ours', () => {
    /*
     * `https://outlio.io.attacker.test` is a domain someone else can register.
     * A `startsWith` check here would let it drive routes that mutate stored
     * credentials using a signed-in user's cookies.
     */
    vi.stubEnv('NODE_ENV', 'production')
    expect(isApprovedOutlioAppOrigin('https://outlio.io.attacker.test')).toBe(false)
    expect(isApprovedOutlioAppOrigin('https://notoutlio.io')).toBe(false)
    expect(isApprovedOutlioAppOrigin('https://outlio.io.evil.example')).toBe(false)
  })

  it('refuses a matching host on the wrong scheme or port', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(isApprovedOutlioAppOrigin('http://outlio.io')).toBe(false)
    expect(isApprovedOutlioAppOrigin('https://outlio.io:8443')).toBe(false)
  })

  it('allows localhost ONLY outside production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(isApprovedOutlioAppOrigin('http://localhost:3000')).toBe(false)

    vi.stubEnv('NODE_ENV', 'development')
    expect(isApprovedOutlioAppOrigin('http://localhost:3000')).toBe(true)
  })

  it('refuses anything that is not a URL', () => {
    vi.stubEnv('NODE_ENV', 'production')
    for (const value of ['', '   ', 'outlio.io', 'null', 'javascript:alert(1)']) {
      expect(isApprovedOutlioAppOrigin(value), JSON.stringify(value)).toBe(false)
    }
  })
})
