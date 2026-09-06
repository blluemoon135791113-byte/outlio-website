/**
 * CRM contact-field normalization — M2 Phase 2 acceptance criterion 2:
 * "Normalization unit tests pass for email/phone/LinkedIn/domain edge cases."
 *
 * The recurring assertion in this file is the separation between the value we
 * STORE AND CONTACT and the value we COMPARE. Getting that wrong does not fail
 * loudly: it mails a mangled address, or merges two strangers.
 */
import { describe, expect, it } from 'vitest'

import { normalizeDomain } from '@/lib/companies/normalize'
import {
  normalizeContactLinkedInUrl,
  normalizeEmail,
  normalizePersonName,
  normalizePhoneNumber,
} from '@/lib/crm/normalize'

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    const result = normalizeEmail('  Sam.Ellis@Example.COM  ')
    expect(result?.address).toBe('sam.ellis@example.com')
    expect(result?.localPart).toBe('sam.ellis')
    expect(result?.domain).toBe('example.com')
  })

  it('extracts the address from a display form', () => {
    // Every CSV export and mail client produces these.
    expect(normalizeEmail('Sam Ellis <sam@acme.com>')?.address).toBe('sam@acme.com')
    expect(normalizeEmail('"Ellis, Sam" <sam@acme.com>')?.address).toBe('sam@acme.com')
  })

  it('punycodes an international domain so one domain has one spelling', () => {
    const result = normalizeEmail('sam@münchen.de')
    expect(result?.domain).toBe('xn--mnchen-3ya.de')
    expect(normalizeEmail('sam@xn--mnchen-3ya.de')?.address).toBe(result?.address)
  })

  it('normalizes unicode width so it cannot produce a second key', () => {
    // Full-width characters, as pasted out of some CRMs and spreadsheets.
    expect(normalizeEmail('ｓａｍ@ｅｘａｍｐｌｅ.ｃｏｍ')?.address).toBe('sam@example.com')
  })

  it('keeps hyphens, plus signs and dots in the stored address', () => {
    expect(normalizeEmail('mary-jane@acme.com')?.address).toBe('mary-jane@acme.com')
    expect(normalizeEmail('a.b+tag@acme.com')?.address).toBe('a.b+tag@acme.com')
  })

  it('derives the company domain, and refuses to for a mailbox provider', () => {
    expect(normalizeEmail('sam@acme.com')?.companyDomain).toBe('acme.com')
    // Delegated to normalizeDomain — a gmail address identifies no company.
    expect(normalizeEmail('sam@gmail.com')?.companyDomain).toBeNull()
    expect(normalizeEmail('sam@acme.com')?.companyDomain).toBe(normalizeDomain('acme.com'))
  })

  const INVALID = [
    '',
    '   ',
    'not-an-email',
    '@acme.com',
    'sam@',
    'sam@@acme.com',
    'sam@acme@com',
    'sam acme@com',
    'sam@acme',
    'sam@localhost',
    'sam@192.168.0.1',
    'sam@-acme.com',
    'sam@acme-.com',
    'sam@acme..com',
    '.sam@acme.com',
    'sam.@acme.com',
    'sa..m@acme.com',
    '"sam ellis"@acme.com',
    'sam<script>@acme.com',
    'sam;drop@acme.com',
    `${'a'.repeat(65)}@acme.com`,
    `${'a'.repeat(250)}@acme.com`,
  ]

  for (const value of INVALID) {
    it(`rejects ${JSON.stringify(value)}`, () => {
      expect(normalizeEmail(value)).toBeNull()
    })
  }

  it('returns null rather than guessing, for null and undefined', () => {
    expect(normalizeEmail(null)).toBeNull()
    expect(normalizeEmail(undefined)).toBeNull()
  })
})

describe('email identity keys fold to the mailbox, addresses do not', () => {
  it('folds Gmail dots and +tags, and treats googlemail as gmail', () => {
    const forms = [
      'j.doe@gmail.com',
      'jdoe@gmail.com',
      'J.D.O.E@Gmail.com',
      'jdoe+newsletter@gmail.com',
      'j.doe+a+b@googlemail.com',
      'jdoe@googlemail.com',
    ]
    const keys = new Set(forms.map((f) => normalizeEmail(f)?.identityKey))
    expect(keys).toEqual(new Set(['jdoe@gmail.com']))
  })

  it('NEVER lets the folded form become the stored address', () => {
    // The bug this guards against mails an address the person never gave us,
    // breaking their filters and any reply threading.
    const result = normalizeEmail('j.doe+outlio@gmail.com')
    expect(result?.address).toBe('j.doe+outlio@gmail.com')
    expect(result?.identityKey).toBe('jdoe@gmail.com')
    expect(result?.address).not.toBe(result?.identityKey)
  })

  it('folds +tags at providers that document sub-addressing', () => {
    expect(normalizeEmail('sam+news@outlook.com')?.identityKey).toBe('sam@outlook.com')
    expect(normalizeEmail('sam+news@proton.me')?.identityKey).toBe('sam@proton.me')
  })

  it('does NOT fold anything at an unknown corporate domain', () => {
    // `+` can be an ordinary character in a real corporate address. Folding
    // there would merge two different people, which M2 Phase 4 forbids.
    expect(normalizeEmail('sam+news@acme.com')?.identityKey).toBe('sam+news@acme.com')
    expect(normalizeEmail('s.am@acme.com')?.identityKey).toBe('s.am@acme.com')
  })

  it('does not fold dots at a plus-addressing provider that keeps them', () => {
    // Outlook honours +tags but dots are significant in the mailbox name.
    expect(normalizeEmail('s.am+x@outlook.com')?.identityKey).toBe('s.am@outlook.com')
  })

  it('keeps the original when a local part is nothing but a tag', () => {
    // Folding would otherwise produce a key of "@gmail.com" shared by everyone.
    expect(normalizeEmail('+news@gmail.com')?.identityKey).toBe('+news@gmail.com')
  })

  it('gives different people different keys', () => {
    const a = normalizeEmail('sam@acme.com')?.identityKey
    const b = normalizeEmail('sam@othercorp.com')?.identityKey
    const c = normalizeEmail('pat@acme.com')?.identityKey
    expect(new Set([a, b, c]).size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

/*
 * ⚠️ DO NOT use Ofcom's 07700 900xxx drama range in these fixtures, tempting as
 * it is. libphonenumber classes it as POSSIBLE but not VALID, so every case
 * here fails for a reason that has nothing to do with the code under test.
 * `07400 123456` is a valid GB mobile format and resolves to GB (07911, the
 * other obvious choice, resolves to GG — Guernsey).
 */
describe('normalizePhoneNumber', () => {
  it('normalizes an international number to E.164', () => {
    const result = normalizePhoneNumber('+44 7400 123456')
    expect(result?.e164).toBe('+447400123456')
    expect(result?.country).toBe('GB')
    expect(result?.reason).toBe('ok')
  })

  it('accepts the formatting humans actually type', () => {
    for (const value of [
      '+1 (415) 555-0132',
      '+1.415.555.0132',
      '+1 415 555 0132',
      '  +14155550132  ',
    ]) {
      expect(normalizePhoneNumber(value)?.e164).toBe('+14155550132')
    }
  })

  it('treats a 00 prefix as +', () => {
    expect(normalizePhoneNumber('0044 7400 123456')?.e164).toBe('+447400123456')
  })

  it('strips a trailing extension, which is not part of an identity', () => {
    for (const value of [
      '+1 415 555 0132 ext. 42',
      '+1 415 555 0132 x42',
      '+1 415 555 0132 #42',
    ]) {
      expect(normalizePhoneNumber(value)?.e164).toBe('+14155550132')
    }
  })

  it('preserves the raw value exactly as supplied', () => {
    const result = normalizePhoneNumber('  +44 7400 123456  ')
    expect(result?.raw).toBe('+44 7400 123456')
  })

  it('NEVER guesses a region for a national-format number', () => {
    // 07400 123456 is a UK mobile and a valid landline elsewhere. Assuming a
    // region silently rewrites the number of everyone outside it.
    const result = normalizePhoneNumber('07400 123456')
    expect(result?.reason).toBe('ambiguous_no_country')
    expect(result?.e164).toBeNull()
    expect(result?.identityKey).toBeNull()
  })

  it('uses a country only when one is explicitly supplied', () => {
    const result = normalizePhoneNumber('07400 123456', { defaultCountry: 'GB' })
    expect(result?.e164).toBe('+447400123456')
    expect(result?.country).toBe('GB')
  })

  it('accepts a lowercase country code', () => {
    expect(normalizePhoneNumber('07400 123456', { defaultCountry: 'gb' })?.e164).toBe(
      '+447400123456',
    )
  })

  it('refuses to parse against a country that does not exist', () => {
    const result = normalizePhoneNumber('07400 123456', { defaultCountry: 'ZZ' })
    expect(result?.reason).toBe('ambiguous_no_country')
    expect(result?.e164).toBeNull()
  })

  it('ignores a supplied country when the number is already international', () => {
    // The + is authoritative; a mismatched default must not corrupt it.
    expect(normalizePhoneNumber('+44 7400 123456', { defaultCountry: 'US' })?.e164).toBe(
      '+447400123456',
    )
  })

  it('rejects numbers no operator has issued', () => {
    for (const value of ['+1 555', '+999999999999999', 'abcdefg', '+', '12']) {
      const result = normalizePhoneNumber(value)
      expect(result?.e164).toBeNull()
    }
  })

  it('separates "not a number" from "cannot tell which country"', () => {
    // The distinction decides whether a CSV importer keeps the value. Prose
    // must not survive into a phone field; a real but unregionalized number
    // must, because a human can still dial it.
    for (const prose of ['call reception', 'n/a', 'see notes', 'ext 42', '-']) {
      expect(normalizePhoneNumber(prose)?.reason).toBe('invalid')
    }
    expect(normalizePhoneNumber('07400 123456')?.reason).toBe('ambiguous_no_country')
  })

  it('gives an identity key only when it is certain', () => {
    expect(normalizePhoneNumber('+447400123456')?.identityKey).toBe('+447400123456')
    expect(normalizePhoneNumber('07400 123456')?.identityKey).toBeNull()
  })

  it('returns null for absent input rather than an empty result', () => {
    expect(normalizePhoneNumber(null)).toBeNull()
    expect(normalizePhoneNumber('   ')).toBeNull()
  })

  it('agrees across every formatting of one number', () => {
    const keys = new Set(
      [
        '+44 7400 123456',
        '+44-7400-123456',
        '+44 (0)7400 123456'.replace('(0)', ''),
        '0044 7400 123456',
        '+447400123456',
      ].map((v) => normalizePhoneNumber(v)?.identityKey),
    )
    expect(keys).toEqual(new Set(['+447400123456']))
  })
})

// ---------------------------------------------------------------------------
// LinkedIn
// ---------------------------------------------------------------------------

describe('normalizeContactLinkedInUrl', () => {
  it('canonicalizes a public profile', () => {
    const result = normalizeContactLinkedInUrl('https://www.linkedin.com/in/sam-ellis')
    expect(result?.canonicalUrl).toBe('https://www.linkedin.com/in/sam-ellis')
    expect(result?.identityKey).toBe('li:in:sam-ellis')
    expect(result?.kind).toBe('public_profile')
  })

  it('agrees across every way one profile can be written', () => {
    const forms = [
      'https://www.linkedin.com/in/sam-ellis',
      'http://linkedin.com/in/sam-ellis',
      'linkedin.com/in/sam-ellis',
      'www.linkedin.com/in/sam-ellis/',
      'https://uk.linkedin.com/in/sam-ellis',
      'https://www.linkedin.com/in/Sam-Ellis',
      'https://www.linkedin.com/in/sam-ellis?trk=nav',
      'https://www.linkedin.com/in/sam-ellis/#about',
      'https://www.linkedin.com/en/in/sam-ellis',
      '/in/sam-ellis',
    ]
    const keys = new Set(forms.map((f) => normalizeContactLinkedInUrl(f)?.identityKey))
    expect(keys).toEqual(new Set(['li:in:sam-ellis']))
  })

  it('canonicalizes a Sales Navigator lead and drops its session state', () => {
    // Everything after the first comma changes between saves; keeping it gives
    // one person a new key on every export.
    const result = normalizeContactLinkedInUrl(
      'https://www.linkedin.com/sales/lead/ACwAAAX_XXkBgA,NAME_SEARCH,yyu9?_ntb=abc',
    )
    expect(result?.identityKey).toBe('li:lead:ACwAAAX_XXkBgA')
    expect(result?.kind).toBe('sales_navigator')
  })

  it('agrees with the Lead Engine on the same Sales Navigator id', () => {
    const a = normalizeContactLinkedInUrl(
      'https://www.linkedin.com/sales/lead/ACwAAAX_XXkBgA,NAME_SEARCH,yyu9',
    )?.identityKey
    const b = normalizeContactLinkedInUrl('/sales/lead/ACwAAAX_XXkBgA')?.identityKey
    expect(a).toBe(b)
  })

  it('offers no canonical URL for Sales Navigator', () => {
    // Its id cannot be turned into a public profile without a request to
    // linkedin.com, which CLAUDE.md rule 1 forbids.
    const result = normalizeContactLinkedInUrl('/sales/lead/ACwAAAX_XXkBgA')
    expect(result?.canonicalUrl).toBeNull()
  })

  it('handles an international slug through its decoded form', () => {
    const result = normalizeContactLinkedInUrl('https://www.linkedin.com/in/m%C3%BCller')
    expect(result?.identityKey).toBe('li:in:müller')
    expect(normalizeContactLinkedInUrl('linkedin.com/in/müller')?.identityKey).toBe(
      result?.identityKey,
    )
  })

  it('CHECKS THE HOST — a lookalike path is not a LinkedIn identity', () => {
    for (const value of [
      'https://example.com/in/sam-ellis',
      'https://notlinkedin.com/in/sam-ellis',
      'https://linkedin.com.evil.test/in/sam-ellis',
      'https://evil.test/sales/lead/ACwAAAX_XXkBgA',
    ]) {
      expect(normalizeContactLinkedInUrl(value)).toBeNull()
    }
  })

  it('rejects company pages — they are not a person', () => {
    for (const value of [
      'https://www.linkedin.com/company/acme',
      'https://www.linkedin.com/sales/company/1234',
      'https://www.linkedin.com/school/some-university',
    ]) {
      expect(normalizeContactLinkedInUrl(value)).toBeNull()
    }
  })

  it('rejects malformed and hostile input', () => {
    for (const value of [
      '',
      '   ',
      'https://www.linkedin.com/',
      'https://www.linkedin.com/in/',
      'https://www.linkedin.com/in/a',
      'https://www.linkedin.com/in/%zz',
      'https://www.linkedin.com/in/<script>',
      'https://www.linkedin.com/in/%3Cscript%3E',
      'https://www.linkedin.com/sales/lead/',
      'not a url at all',
    ]) {
      expect(normalizeContactLinkedInUrl(value)).toBeNull()
    }
  })

  it('returns null for absent input', () => {
    expect(normalizeContactLinkedInUrl(null)).toBeNull()
    expect(normalizeContactLinkedInUrl(undefined)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Person name
// ---------------------------------------------------------------------------

describe('normalizePersonName', () => {
  it('collapses whitespace and preserves casing', () => {
    const result = normalizePersonName('  Sam   Ellis ')
    expect(result?.fullName).toBe('Sam Ellis')
    expect(result?.firstName).toBe('Sam')
    expect(result?.lastName).toBe('Ellis')
  })

  it('preserves the casing people actually write', () => {
    expect(normalizePersonName('Ana McDonald')?.lastName).toBe('McDonald')
    expect(normalizePersonName('Piet van der Berg')?.lastName).toBe('van der Berg')
  })

  it('keeps a multi-word surname together', () => {
    expect(normalizePersonName('Ana Maria de Souza')?.lastName).toBe('Maria de Souza')
  })

  it('handles a single-token name without inventing a surname', () => {
    const result = normalizePersonName('Cher')
    expect(result?.firstName).toBe('Cher')
    expect(result?.lastName).toBeNull()
  })

  it('rejects input that is not a name', () => {
    for (const value of ['', '   ', '-', '...', 'a'.repeat(201)]) {
      expect(normalizePersonName(value)).toBeNull()
    }
  })
})
