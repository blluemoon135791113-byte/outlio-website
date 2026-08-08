import { createHash, randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  adminClient,
  anonClient,
  createTestSignupReservation,
  deleteTestUser,
  hasSupabaseEnv,
} from './helpers'

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('signup IP gate', () => {
  it('atomically blocks a second reservation for the same IP hash', async () => {
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

  it('blocks reuse of a phone number or LinkedIn identity on another network', async () => {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    const phone = `+1555${suffix.slice(-7)}`
    const linkedInUrl = `https://www.linkedin.com/in/outlio-test-${suffix}`
    const firstReservation = await createTestSignupReservation('identity-first')
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
        const { data, error } = await admin.auth.admin.createUser({
          email: `outlio-test-identity-${index}-${suffix}@example.com`,
          password: 'fabricated identity test passphrase',
          email_confirm: true,
          user_metadata: {
            full_name: `Identity Test ${index + 2}`,
            ...identity,
            signup_reservation_token: reservation.token,
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
})
