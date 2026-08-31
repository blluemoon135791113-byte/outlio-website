/**
 * The cron endpoint's guard — R10.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS ROUTE SENDS EMAIL. AN OPEN ONE IS AN ABUSE VECTOR.              ║
 * ║                                                                           ║
 * ║  Anyone able to call it can drain a customer's daily send allowance and   ║
 * ║  burn their sending-domain reputation, as fast as they can issue          ║
 * ║  requests. So the guard is tested on its own, not merely assumed from     ║
 * ║  the fact that the platform sets the header.                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import { isAuthorizedCronRequest } from '@/app/api/cron/route'

const SECRET = 'a-real-cron-secret-value'

describe('the cron guard', () => {
  it('accepts the correct bearer token', () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET)).toBe(true)
  })

  it('REFUSES when no secret is configured, rather than waving it through', () => {
    /*
     * ⚠️ THE FAILURE THAT MATTERS. A missing environment variable must not
     * turn authentication off — that is how an endpoint silently becomes open
     * in the one environment where the variable was forgotten. Same rule the
     * Calendly signature check follows.
     */
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, undefined)).toBe(false)
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, '')).toBe(false)
  })

  it('refuses a missing, empty or malformed header', () => {
    for (const header of [null, '', 'Bearer', 'Basic abc', SECRET, `bearer ${SECRET}`]) {
      expect(isAuthorizedCronRequest(header, SECRET)).toBe(false)
    }
  })

  it('refuses a wrong secret of the same length', () => {
    // Same length, so this is not passing merely on the length check.
    const wrong = 'b-fake-cron-secret-value'
    expect(wrong.length).toBe(SECRET.length)
    expect(isAuthorizedCronRequest(`Bearer ${wrong}`, SECRET)).toBe(false)
  })

  it('refuses a correct PREFIX, which a naive startsWith would accept', () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET.slice(0, 10)}`, SECRET)).toBe(false)
    // ...and the right value with trailing junk.
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}extra`, SECRET)).toBe(false)
  })

  it('does not throw on hostile input', () => {
    // A guard that throws is a denial of service, not a rejection.
    for (const header of [' ', 'Bearer  ', 'x'.repeat(10_000)]) {
      expect(() => isAuthorizedCronRequest(header, SECRET)).not.toThrow()
      expect(isAuthorizedCronRequest(header, SECRET)).toBe(false)
    }
  })
})
