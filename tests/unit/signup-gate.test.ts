import { describe, expect, it } from 'vitest'

import {
  hashReservationToken,
  hashSignupIp,
  normalizeClientIp,
  signupNetworkIdentity,
} from '@/lib/auth/signup-gate'
import {
  createTrialDeviceCookie,
  hashSignupIdentity,
  hashTrialDeviceCookie,
  trialDeviceId,
} from '@/lib/auth/trial-device'

const TEST_SECRET = 'test-only-secret-that-is-longer-than-thirty-two-characters'

describe('normalizeClientIp', () => {
  it('uses the first address in a forwarding chain', () => {
    expect(normalizeClientIp('203.0.113.8, 10.0.0.1')).toBe('203.0.113.8')
  })

  it('removes an IPv4 port', () => {
    expect(normalizeClientIp('203.0.113.8:443')).toBe('203.0.113.8')
  })

  it('normalizes IPv4-mapped IPv6', () => {
    expect(normalizeClientIp('::ffff:203.0.113.8')).toBe('203.0.113.8')
  })

  it('canonicalizes equivalent IPv6 spellings', () => {
    expect(normalizeClientIp('2001:0DB8:0:0:0:0:0:1')).toBe('2001:db8::1')
    expect(normalizeClientIp('[2001:db8::1]:443')).toBe('2001:db8::1')
  })

  it('rejects malformed input and scoped addresses', () => {
    expect(normalizeClientIp('not-an-ip')).toBeNull()
    expect(normalizeClientIp('fe80::1%lo0')).toBeNull()
  })
})

describe('signup hashing', () => {
  it('groups rotating IPv6 addresses by their /64 network', () => {
    expect(signupNetworkIdentity('2001:db8:abcd:12::1')).toBe(
      signupNetworkIdentity('2001:db8:abcd:12:ffff::99'),
    )
  })

  it('is stable for the same IP and secret', () => {
    expect(hashSignupIp('203.0.113.8', TEST_SECRET)).toBe(
      hashSignupIp('203.0.113.8', TEST_SECRET),
    )
  })

  it('changes when the secret changes', () => {
    expect(hashSignupIp('203.0.113.8', TEST_SECRET)).not.toBe(
      hashSignupIp('203.0.113.8', `${TEST_SECRET}-rotated`),
    )
  })

  it('refuses a weak hashing secret', () => {
    expect(() => hashSignupIp('203.0.113.8', 'too-short')).toThrow(
      /at least 32 characters/,
    )
  })

  it('hashes reservation tokens as lowercase SHA-256 hex', () => {
    expect(hashReservationToken('one-time-token')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('trial device and identity claims', () => {
  it('accepts a server-signed device cookie and derives a stable claim', () => {
    const cookie = createTrialDeviceCookie(TEST_SECRET)
    expect(trialDeviceId(cookie, TEST_SECRET)).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(hashTrialDeviceCookie(cookie, TEST_SECRET)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashTrialDeviceCookie(cookie, TEST_SECRET)).toBe(
      hashTrialDeviceCookie(cookie, TEST_SECRET),
    )
  })

  it('rejects forged or modified device cookies', () => {
    const cookie = createTrialDeviceCookie(TEST_SECRET)
    expect(hashTrialDeviceCookie(`${cookie}x`, TEST_SECRET)).toBeNull()
    expect(hashTrialDeviceCookie('invented-device.invalid-signature', TEST_SECRET)).toBeNull()
  })

  it('separates identity kinds even when their values match', () => {
    expect(hashSignupIdentity('email', 'same-value', TEST_SECRET)).not.toBe(
      hashSignupIdentity('phone', 'same-value', TEST_SECRET),
    )
  })
})
