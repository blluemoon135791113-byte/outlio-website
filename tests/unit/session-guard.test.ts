import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createSessionGuard,
  readSessionGuard,
  sessionGuardExpired,
  SESSION_ABSOLUTE_SECONDS,
  SESSION_IDLE_SECONDS,
} from '@/lib/auth/session-guard'

describe('session guard', () => {
  beforeEach(() => { process.env.SESSION_GUARD_SECRET = 'test-session-secret-long-enough' })
  afterEach(() => { delete process.env.SESSION_GUARD_SECRET })

  it('signs and verifies issue and activity timestamps', () => {
    const value = createSessionGuard(200, 100)
    expect(readSessionGuard(value)).toEqual({ issuedAt: 100, activeAt: 200 })
  })

  it('rejects tampering', () => {
    const value = createSessionGuard(200, 100)!
    expect(readSessionGuard(value.replace('100.200', '101.200'))).toBeNull()
  })

  it('enforces idle and absolute timeouts', () => {
    expect(sessionGuardExpired({ issuedAt: 100, activeAt: 200 }, 200 + SESSION_IDLE_SECONDS + 1)).toBe(true)
    expect(sessionGuardExpired({ issuedAt: 100, activeAt: 200 }, 100 + SESSION_ABSOLUTE_SECONDS + 1)).toBe(true)
    expect(sessionGuardExpired({ issuedAt: 100, activeAt: 200 }, 300)).toBe(false)
  })
})
