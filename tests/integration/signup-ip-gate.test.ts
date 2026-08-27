import { createHash, randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  adminClient,
  anonClient,
  createTestSignupSecurityMetadata,
  createTestSignupReservation,
  deleteTestUser,
  hasSupabaseEnv,
} from './helpers'

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('signup reservation gate', () => {
  it('atomically blocks reuse of the same one-time reservation key', async () => {
    const first = await createTestSignupReservation('duplicate-ip')
    const secondToken = randomBytes(32).toString('base64url')
    const secondTokenHash = createHash('sha256').update(secondToken).digest('hex')

    try {
      const { data, error } = await adminClient().rpc('reserve_signup_ip', {
        p_ip_hash: first.ipHash,
        p_token_hash: secondTokenHash,
        p_reservation_seconds: 600,
      })

      expect(error).toBeNull()
      expect(data).toBe(false)
    } finally {
      await adminClient()
        .from('signup_ip_claims')
        .delete()
        .eq('ip_hash', first.ipHash)
    }
  })

  it('does not expose the reservation RPC to anonymous callers', async () => {
    const digest = createHash('sha256').update(`anon:${Date.now()}`).digest('hex')
    const { error } = await anonClient().rpc('reserve_signup_ip', {
      p_ip_hash: digest,
      p_token_hash: digest,
      p_reservation_seconds: 600,
    })

    expect(error).not.toBeNull()
  })

  it('rejects direct Supabase sign-up without a server reservation', async () => {
    const email = `outlio-test-direct-signup-${Date.now()}@example.com`
    const { data, error } = await anonClient().auth.signUp({
      email,
      password: 'fabricated direct signup passphrase',
    })

    try {
      expect(error).not.toBeNull()
      expect(data.user).toBeNull()
    } finally {
      if (data.user?.id) await deleteTestUser(data.user.id)
    }
  })

  it('blocks reuse of a phone number or LinkedIn identity on another attempt', async () => {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    const phone = `+1555${suffix.slice(-7)}`
    const linkedInUrl = `https://www.linkedin.com/in/outlio-test-${suffix}`
    const firstReservation = await createTestSignupReservation('identity-first')
    const firstSecurity = createTestSignupSecurityMetadata('identity-first')
    const admin = adminClient()
    const { data: first, error: firstError } = await admin.auth.admin.createUser({
      email: `outlio-test-identity-first-${suffix}@example.com`,
      password: 'fabricated identity test passphrase',
      email_confirm: true,
      user_metadata: {
        full_name: 'Identity Test One',
        phone,
        linkedin_url: linkedInUrl,
        signup_reservation_token: firstReservation.token,
        ...firstSecurity,
      },
    })

    expect(firstError).toBeNull()
    expect(first.user).not.toBeNull()

    const attempts = [
      { phone, linkedin_url: `${linkedInUrl}-different` },
      { phone: `+1666${suffix.slice(-7)}`, linkedin_url: linkedInUrl },
    ]

    try {
      for (const [index, identity] of attempts.entries()) {
        const reservation = await createTestSignupReservation(`identity-${index}`)
        const security = createTestSignupSecurityMetadata(`identity-${index}`, {
          ...(index === 0
            ? { signup_phone_hash: firstSecurity.signup_phone_hash }
            : { signup_linkedin_hash: firstSecurity.signup_linkedin_hash }),
        })
        const { data, error } = await admin.auth.admin.createUser({
          email: `outlio-test-identity-${index}-${suffix}@example.com`,
          password: 'fabricated identity test passphrase',
          email_confirm: true,
          user_metadata: {
            full_name: `Identity Test ${index + 2}`,
            ...identity,
            signup_reservation_token: reservation.token,
            ...security,
          },
        })

        expect(error).not.toBeNull()
        expect(data.user).toBeNull()
        await admin
          .from('signup_ip_claims')
          .delete()
          .eq('ip_hash', reservation.ipHash)
      }
    } finally {
      if (first.user?.id) await deleteTestUser(first.user.id)
    }
  })

  it('blocks the same signed device after the reservation and identities change', async () => {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    const firstReservation = await createTestSignupReservation('device-first')
    const firstSecurity = createTestSignupSecurityMetadata('device-first')
    const admin = adminClient()
    const { data: first, error: firstError } = await admin.auth.admin.createUser({
      email: `outlio-test-device-first-${suffix}@example.com`,
      password: 'fabricated device test passphrase',
      email_confirm: true,
      user_metadata: {
        full_name: 'Device Test One',
        phone: `+1555${suffix.slice(-7)}`,
        linkedin_url: `https://www.linkedin.com/in/outlio-device-first-${suffix}`,
        signup_reservation_token: firstReservation.token,
        ...firstSecurity,
      },
    })

    expect(firstError).toBeNull()
    expect(first.user).not.toBeNull()

    const secondReservation = await createTestSignupReservation('device-second')
    const secondSecurity = createTestSignupSecurityMetadata('device-second', {
      signup_device_hash: firstSecurity.signup_device_hash,
    })

    try {
      const { data, error } = await admin.auth.admin.createUser({
        email: `outlio-test-device-second-${suffix}@example.com`,
        password: 'fabricated device test passphrase',
        email_confirm: true,
        user_metadata: {
          full_name: 'Device Test Two',
          phone: `+1666${suffix.slice(-7)}`,
          linkedin_url: `https://www.linkedin.com/in/outlio-device-second-${suffix}`,
          signup_reservation_token: secondReservation.token,
          ...secondSecurity,
        },
      })

      expect(error).not.toBeNull()
      expect(data.user).toBeNull()
    } finally {
      if (first.user?.id) await deleteTestUser(first.user.id)
      await admin
        .from('signup_ip_claims')
        .delete()
        .eq('ip_hash', secondReservation.ipHash)
    }
  })

  it('releases network, device, and identity claims after account deletion', async () => {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    const email = `outlio-test-persistent-${suffix}@example.com`
    const phone = `+1777${suffix.slice(-7)}`
    const linkedInUrl = `https://www.linkedin.com/in/outlio-persistent-${suffix}`
    const firstReservation = await createTestSignupReservation('persistent-first')
    const firstSecurity = createTestSignupSecurityMetadata('persistent-first')
    const admin = adminClient()
    const { data: first, error: firstError } = await admin.auth.admin.createUser({
      email,
      password: 'fabricated persistent identity passphrase',
      email_confirm: true,
      user_metadata: {
        full_name: 'Persistent Identity One',
        phone,
        linkedin_url: linkedInUrl,
        signup_reservation_token: firstReservation.token,
        ...firstSecurity,
      },
    })

    expect(firstError).toBeNull()
    expect(first.user).not.toBeNull()

    const firstUserId = first.user!.id
    await admin.auth.admin.deleteUser(firstUserId)

    const [networkClaim, deviceClaim, identityClaims] = await Promise.all([
      admin.from('signup_ip_claims').select('ip_hash').eq('user_id', firstUserId),
      admin.from('signup_device_claims').select('device_hash').eq('user_id', firstUserId),
      admin.from('signup_identity_claims').select('identity_hash').eq('user_id', firstUserId),
    ])
    expect(networkClaim.error).toBeNull()
    expect(deviceClaim.error).toBeNull()
    expect(identityClaims.error).toBeNull()
    expect(networkClaim.data).toEqual([])
    expect(deviceClaim.data).toEqual([])
    expect(identityClaims.data).toEqual([])

    const secondReservation = await createTestSignupReservation(
      'persistent-second',
      firstReservation.ipHash,
    )
    const secondSecurity = createTestSignupSecurityMetadata('persistent-second', {
      signup_device_hash: firstSecurity.signup_device_hash,
      signup_email_hash: firstSecurity.signup_email_hash,
      signup_phone_hash: firstSecurity.signup_phone_hash,
      signup_linkedin_hash: firstSecurity.signup_linkedin_hash,
    })

    try {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: 'fabricated persistent identity passphrase',
        email_confirm: true,
        user_metadata: {
          full_name: 'Persistent Identity Two',
          phone,
          linkedin_url: linkedInUrl,
          signup_reservation_token: secondReservation.token,
          ...secondSecurity,
        },
      })

      expect(error).toBeNull()
      expect(data.user).not.toBeNull()
      if (data.user?.id) await admin.auth.admin.deleteUser(data.user.id)
    } finally {
      await admin
        .from('signup_ip_claims')
        .delete()
        .eq('ip_hash', secondReservation.ipHash)
    }
  })
})
