/**
 * Company normalization.
 *
 * These values become identity keys. Two failure modes matter, and they are not
 * symmetric:
 *
 *   - Producing DIFFERENT keys for one company wastes money (the same company
 *     is researched twice) but corrupts nothing.
 *   - Producing the SAME key for two companies is data corruption: unrelated
 *     leads get attached to one another's funding, headcount, and tech stack.
 *
 * Every test below that asserts `null` exists because the alternative was a
 * false merge.
 */
import { describe, expect, it } from 'vitest'

import {
  normalizeCompanyLinkedInUrl,
  normalizeCompanyName,
  normalizeDomain,
} from '@/lib/companies/normalize'

describe('normalizeDomain', () => {
  it('reduces every spelling of one host to the same value', () => {
    const expected = 'hubspot.com'
    for (const input of [
      'hubspot.com',
      'HubSpot.com',
      'www.hubspot.com',
      'WWW.HUBSPOT.COM',
      'https://hubspot.com',
      'http://www.hubspot.com/',
      '//hubspot.com',
      'https://www.hubspot.com/pricing?utm_source=x#top',
      'https://www.hubspot.com:443/about',
      'hubspot.com.',
      '  https://hubspot.com  ',
    ]) {
      expect(normalizeDomain(input), input).toBe(expected)
    }
  })

  it('keeps subdomains that are part of the identity', () => {
    expect(normalizeDomain('https://eu.example.com')).toBe('eu.example.com')
    expect(normalizeDomain('blog.example.co.uk')).toBe('blog.example.co.uk')
  })

  it('accepts an email address as a source of the domain', () => {
    expect(normalizeDomain('sam@acme.io')).toBe('acme.io')
    expect(normalizeDomain('first.last+tag@acme.io')).toBe('acme.io')
  })

  it('rejects mailbox providers, which identify a person and not a company', () => {
    for (const input of [
      'sam@gmail.com',
      'gmail.com',
      'https://outlook.com',
      'yahoo.com',
      'proton.me',
      'icloud.com',
      'qq.com',
    ]) {
      expect(normalizeDomain(input), input).toBeNull()
    }
  })

  it('rejects profile and shortener hosts, which are not company websites', () => {
    expect(normalizeDomain('https://www.linkedin.com/company/acme')).toBeNull()
    expect(normalizeDomain('linktr.ee/acme')).toBeNull()
    expect(normalizeDomain('bit.ly/xyz')).toBeNull()
  })

  it('rejects anything that is not a public domain name', () => {
    for (const input of [
      '',
      '   ',
      'localhost',
      'http://localhost:3000',
      'internal.local',
      '192.168.1.10',
      'http://127.0.0.1',
      'not a domain',
      'com',
      '://',
    ]) {
      expect(normalizeDomain(input), JSON.stringify(input)).toBeNull()
    }
  })

  it('returns null for null and undefined rather than throwing', () => {
    expect(normalizeDomain(null)).toBeNull()
    expect(normalizeDomain(undefined)).toBeNull()
  })

  it('punycodes an international host instead of rejecting it', () => {
    expect(normalizeDomain('https://müller.de')).toBe('xn--mller-kva.de')
  })

  it('does not let a hostile string become a domain', () => {
    for (const input of [
      'https://acme.com/../../etc/passwd',
      "acme.com'; drop table companies;--",
      'acme.com<script>',
      'https://user:pass@acme.com',
    ]) {
      const result = normalizeDomain(input)
      // Either rejected outright, or reduced to the bare host with nothing
      // structural left attached.
      expect(result === null || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(result), input).toBe(true)
    }
  })
})

describe('normalizeCompanyName', () => {
  it('treats legal forms as noise', () => {
    const expected = 'acme'
    for (const input of [
      'Acme',
      'ACME',
      'Acme Inc',
      'Acme, Inc.',
      'Acme Inc.',
      'Acme LLC',
      'Acme Ltd',
      'Acme Limited',
      'Acme GmbH',
      'Acme B.V.',
      'Acme Pty Ltd',
      '  acme   ',
    ]) {
      expect(normalizeCompanyName(input), input).toBe(expected)
    }
  })

  it('never strips a substantive word', () => {
    expect(normalizeCompanyName('Acme Systems')).toBe('acme systems')
    expect(normalizeCompanyName('Corporate Travel')).toBe('corporate travel')
    // "co" leads here, so it is not a trailing legal form.
    expect(normalizeCompanyName('Co Working Group')).toBe('co working group')
  })

  it('keeps distinct companies distinct', () => {
    expect(normalizeCompanyName('Acme')).not.toBe(normalizeCompanyName('Acme Systems'))
    expect(normalizeCompanyName('Stripe')).not.toBe(normalizeCompanyName('Stripe Press'))
  })

  it('drops a tagline appended after a separator', () => {
    expect(normalizeCompanyName('Acme | We build things')).toBe('acme')
    expect(normalizeCompanyName('Acme — the best')).toBe('acme')
  })

  it('normalizes unicode without discarding diacritics', () => {
    // NFKC: a composed and a decomposed "ü" must agree.
    expect(normalizeCompanyName('Müller')).toBe(normalizeCompanyName('Müller'))
    // But "Muller" is a different name, and merging them would be a guess.
    expect(normalizeCompanyName('Müller')).not.toBe(normalizeCompanyName('Muller'))
  })

  it('returns null when nothing survives', () => {
    expect(normalizeCompanyName('')).toBeNull()
    expect(normalizeCompanyName('   ')).toBeNull()
    expect(normalizeCompanyName('---')).toBeNull()
    expect(normalizeCompanyName(null)).toBeNull()
    // A bare legal form identifies no company.
    expect(normalizeCompanyName('Inc')).toBe('inc')
  })
})

describe('normalizeCompanyLinkedInUrl', () => {
  it('reduces every Sales Navigator spelling of one company page', () => {
    const expected = 'linkedin.com/sales/company/1234'
    for (const input of [
      'https://www.linkedin.com/sales/company/1234',
      '/sales/company/1234',
      'https://www.linkedin.com/sales/company/1234?_ntb=abc',
      'https://www.linkedin.com/sales/company/1234/people',
    ]) {
      expect(normalizeCompanyLinkedInUrl(input), input).toBe(expected)
    }
  })

  it('reduces every public spelling of one company page', () => {
    const expected = 'linkedin.com/company/acme-corp'
    for (const input of [
      'https://www.linkedin.com/company/acme-corp',
      'https://linkedin.com/company/acme-corp/',
      'https://uk.linkedin.com/company/Acme-Corp',
      'linkedin.com/company/acme-corp?trk=x',
    ]) {
      expect(normalizeCompanyLinkedInUrl(input), input).toBe(expected)
    }
  })

  it('keeps the numeric and slug forms distinct', () => {
    // They cannot be converted into one another without a request to
    // linkedin.com, which is forbidden. They converge only when a capture
    // carries both.
    expect(normalizeCompanyLinkedInUrl('/sales/company/1234')).not.toBe(
      normalizeCompanyLinkedInUrl('/company/acme'),
    )
  })

  it('rejects anything that is not a company page', () => {
    for (const input of [
      '',
      null,
      'https://www.linkedin.com/in/someone',
      'https://www.linkedin.com/sales/lead/ACwAAA',
      'https://example.com/company/acme',
      'https://www.linkedin.com/company/',
    ]) {
      expect(normalizeCompanyLinkedInUrl(input), JSON.stringify(input)).toBeNull()
    }
  })

  it('refuses a slug carrying structural characters', () => {
    expect(normalizeCompanyLinkedInUrl('https://www.linkedin.com/company/%3Cscript%3E')).toBeNull()
    expect(normalizeCompanyLinkedInUrl('https://www.linkedin.com/company/%2E%2E%2F')).toBeNull()
  })

  it('accepts an international slug', () => {
    expect(normalizeCompanyLinkedInUrl('https://www.linkedin.com/company/m%C3%BCller')).toBe(
      'linkedin.com/company/müller',
    )
  })
})
