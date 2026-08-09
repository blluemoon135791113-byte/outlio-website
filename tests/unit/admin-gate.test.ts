import { describe, expect, it } from 'vitest'

import { adminGateRedirect, hasAdminAssurance } from '@/lib/auth/admin-gate'

const securedAdmin = {
  userId: 'user-id',
  isAdmin: true,
  mfaCurrentLevel: 'aal2',
  mfaNextLevel: 'aal2',
}

describe('admin access gate', () => {
  it('sends signed-out callers to sign in', () => {
    expect(adminGateRedirect({ ...securedAdmin, userId: null })).toBe('/sign-in')
  })

  it('does not allow an authenticated non-admin', () => {
    expect(adminGateRedirect({ ...securedAdmin, isAdmin: false })).toBe('/dashboard')
  })

  it('sends an admin without TOTP to the existing security section', () => {
    expect(adminGateRedirect({
      ...securedAdmin,
      mfaCurrentLevel: 'aal1',
      mfaNextLevel: 'aal1',
    })).toBe('/dashboard/settings?required_mfa=1#security')
  })

  it('challenges an enrolled admin whose session is only AAL1', () => {
    expect(adminGateRedirect({ ...securedAdmin, mfaCurrentLevel: 'aal1' }))
      .toBe('/mfa?next=%2Fadmin')
  })

  it('allows only a database admin with an AAL2 session', () => {
    expect(adminGateRedirect(securedAdmin)).toBeNull()
    expect(hasAdminAssurance(securedAdmin)).toBe(true)
    expect(hasAdminAssurance({ ...securedAdmin, mfaCurrentLevel: 'aal1' })).toBe(false)
  })
})
