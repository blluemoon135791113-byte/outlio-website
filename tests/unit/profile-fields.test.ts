import { describe, expect, it } from 'vitest'

import {
  normalizeFullName,
  normalizeLinkedInUrl,
  normalizePhone,
  normalizePhoneForCountry,
} from '@/lib/auth/profile-fields'

describe('normalizePhone', () => {
  it('accepts a clean E.164 number', () => {
    const r = normalizePhone('+447700900123')
    expect(r).toEqual({ ok: true, value: '+447700900123' })
  })

  it('strips human formatting', () => {
    for (const input of [
      '+44 7700 900123',
      '+44-7700-900123',
      '+44 (7700) 900123',
      '+44.7700.900123',
      '  +447700900123  ',
    ]) {
      const r = normalizePhone(input)
      expect(r.ok, input).toBe(true)
      if (r.ok) expect(r.value).toBe('+447700900123')
    }
  })

  it('converts a 00 international prefix to +', () => {
    const r = normalizePhone('0044 7700 900123')
    expect(r).toEqual({ ok: true, value: '+447700900123' })
  })

  it('accepts other country codes', () => {
    expect(normalizePhone('+1 415 555 0132').ok).toBe(true)
    expect(normalizePhone('+92 300 1234567').ok).toBe(true)
    expect(normalizePhone('+81 90 1234 5678').ok).toBe(true)
  })

  it('rejects a number with no country code', () => {
    const r = normalizePhone('07700900123')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/country code/i)
  })

  it('rejects empty input', () => {
    expect(normalizePhone('').ok).toBe(false)
    expect(normalizePhone('   ').ok).toBe(false)
  })

  it('rejects too short and too long', () => {
    expect(normalizePhone('+1234567').ok).toBe(false)
    expect(normalizePhone(`+1${'2'.repeat(20)}`).ok).toBe(false)
  })

  it('rejects a leading zero country code', () => {
    expect(normalizePhone('+0447700900123').ok).toBe(false)
  })

  it('rejects letters and injection attempts', () => {
    for (const bad of [
      '+44 CALL-ME-NOW',
      "+44'; drop table profiles;--",
      '+44<script>alert(1)</script>',
      '=cmd|\'/c calc\'!A1',
    ]) {
      expect(normalizePhone(bad).ok, bad).toBe(false)
    }
  })
})

describe('normalizePhoneForCountry', () => {
  it('normalizes national numbers using the selected country', () => {
    expect(normalizePhoneForCountry('GB', '07400 123456')).toEqual({
      ok: true,
      value: '+447400123456',
    })
    expect(normalizePhoneForCountry('US', '(415) 555-0132')).toEqual({
      ok: true,
      value: '+14155550132',
    })
    expect(normalizePhoneForCountry('PK', '0300 1234567')).toEqual({
      ok: true,
      value: '+923001234567',
    })
  })

  it('rejects forged country codes and invalid local numbers', () => {
    expect(normalizePhoneForCountry('XX', '123456789').ok).toBe(false)
    expect(normalizePhoneForCountry('GB', '123').ok).toBe(false)
    expect(normalizePhoneForCountry("GB'; drop table profiles;--", '07700900123').ok).toBe(false)
  })
})

describe('normalizeLinkedInUrl', () => {
  it('canonicalises the common forms', () => {
    for (const input of [
      'https://www.linkedin.com/in/husnain-rafiq',
      'http://www.linkedin.com/in/husnain-rafiq',
      'https://linkedin.com/in/husnain-rafiq',
      'linkedin.com/in/husnain-rafiq',
      'www.linkedin.com/in/husnain-rafiq',
      'https://www.linkedin.com/in/husnain-rafiq/',
      'https://www.linkedin.com/in/husnain-rafiq?originalSubdomain=uk',
      'https://uk.linkedin.com/in/husnain-rafiq',
      '  https://www.linkedin.com/in/husnain-rafiq  ',
    ]) {
      const r = normalizeLinkedInUrl(input)
      expect(r.ok, input).toBe(true)
      if (r.ok) expect(r.value).toBe('https://www.linkedin.com/in/husnain-rafiq')
    }
  })

  it('strips a locale path prefix', () => {
    const r = normalizeLinkedInUrl('https://www.linkedin.com/en/in/husnain-rafiq')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('https://www.linkedin.com/in/husnain-rafiq')
  })

  it('rejects a company page with a helpful reason', () => {
    const r = normalizeLinkedInUrl('https://www.linkedin.com/company/outlio')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/company page/i)
  })

  it('rejects a Sales Navigator link with a helpful reason', () => {
    const r = normalizeLinkedInUrl('https://www.linkedin.com/sales/lead/ACwAAA,NAME_SEARCH,abcd')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/sales navigator/i)
  })

  it('rejects a non-LinkedIn host', () => {
    for (const bad of [
      'https://example.com/in/someone',
      'https://linkedin.com.evil.example/in/someone',
      'https://notlinkedin.com/in/someone',
    ]) {
      const r = normalizeLinkedInUrl(bad)
      expect(r.ok, bad).toBe(false)
    }
  })

  it('rejects the bare domain and empty input', () => {
    expect(normalizeLinkedInUrl('https://www.linkedin.com').ok).toBe(false)
    expect(normalizeLinkedInUrl('https://www.linkedin.com/in/').ok).toBe(false)
    expect(normalizeLinkedInUrl('').ok).toBe(false)
  })

  it('rejects javascript: and data: schemes', () => {
    expect(normalizeLinkedInUrl('javascript:alert(1)').ok).toBe(false)
    expect(normalizeLinkedInUrl('data:text/html,<script>alert(1)</script>').ok).toBe(false)
  })

  it('rejects a slug containing path traversal or a script tag', () => {
    expect(normalizeLinkedInUrl('https://www.linkedin.com/in/../../etc/passwd').ok).toBe(false)
    expect(normalizeLinkedInUrl('https://www.linkedin.com/in/<script>').ok).toBe(false)
  })

  it('rejects a slug that only LOOKS safe until percent-decoded', () => {
    // new URL() encodes these; a raw-form check allowing % would let them pass.
    for (const bad of [
      'https://www.linkedin.com/in/%3Cscript%3E',
      'https://www.linkedin.com/in/%2E%2E%2F%2E%2E',
      'https://www.linkedin.com/in/a%20b',
      'https://www.linkedin.com/in/%00',
      'https://www.linkedin.com/in/%zz',
    ]) {
      expect(normalizeLinkedInUrl(bad).ok, bad).toBe(false)
    }
  })

  it('still accepts an international slug once decoded', () => {
    const r = normalizeLinkedInUrl('https://www.linkedin.com/in/m%C3%BCller')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('https://www.linkedin.com/in/m%C3%BCller')
  })
})

describe('normalizeFullName', () => {
  it('collapses internal whitespace', () => {
    const r = normalizeFullName('  Husnain    Rafiq  ')
    expect(r).toEqual({ ok: true, value: 'Husnain Rafiq' })
  })

  it('accepts non-Latin scripts and diacritics', () => {
    expect(normalizeFullName('Zoë Müller').ok).toBe(true)
    expect(normalizeFullName('田中 太郎').ok).toBe(true)
  })

  it('rejects empty and single-character names', () => {
    expect(normalizeFullName('').ok).toBe(false)
    expect(normalizeFullName('   ').ok).toBe(false)
    expect(normalizeFullName('A').ok).toBe(false)
  })

  it('rejects an absurdly long name', () => {
    expect(normalizeFullName('a'.repeat(200)).ok).toBe(false)
  })
})
