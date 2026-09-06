/**
 * Duplicate detection scoring — M2 Phase 4.
 *
 * The failure this file guards against is not "misses a duplicate". It is
 * "flags every pair of colleagues", which fills the Duplicate Center with
 * noise and buries the one real duplicate. A Center nobody trusts is worse
 * than no Center, so most of these tests assert that a pair is NOT flagged.
 *
 * M2 acceptance criterion 4 — "shows reasons + confidence for every flagged
 * pair" — is asserted structurally: nothing may be flagged without both.
 */
import { describe, expect, it } from 'vitest'

import {
  nameSimilarity,
  orderPair,
  scoreCompanyPair,
  scoreContactPair,
  trigramSimilarity,
  type CompanyFacts,
  type ContactFacts,
} from '@/lib/crm/dedupe'

function contact(over: Partial<ContactFacts> = {}): ContactFacts {
  return {
    fullName: null,
    linkedInIdentityKey: null,
    emailIdentityKeys: [],
    phoneE164s: [],
    companyIds: [],
    emailDomains: [],
    ...over,
  }
}

function company(over: Partial<CompanyFacts> = {}): CompanyFacts {
  return {
    normalizedName: null,
    normalizedDomain: null,
    normalizedLinkedInUrl: null,
    ...over,
  }
}

const ACME = 'acme-company-id'
const GLOBEX = 'globex-company-id'

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

describe('trigramSimilarity', () => {
  it('is 1 for identical strings and 0 for nothing in common', () => {
    expect(trigramSimilarity('acme', 'acme')).toBe(1)
    expect(trigramSimilarity('acme', 'zzz')).toBe(0)
  })

  it('ignores case, punctuation and diacritics', () => {
    expect(trigramSimilarity('José Ruiz', 'jose ruiz')).toBe(1)
    expect(trigramSimilarity('Acme, Inc.', 'acme inc')).toBe(1)
  })

  it('rates a typo high and a different word low', () => {
    // One mistyped character. Dice puts this at ~0.57; Jaccard would say 0.4,
    // which is why this file does not use Jaccard.
    expect(trigramSimilarity('samuel', 'samual')).toBeGreaterThan(0.5)
    expect(trigramSimilarity('samuel', 'gertrude')).toBeLessThan(0.15)
  })

  it('is symmetric', () => {
    expect(trigramSimilarity('sam ellis', 'samuel ellis')).toBe(
      trigramSimilarity('samuel ellis', 'sam ellis'),
    )
  })

  it('is 0 when either side has nothing comparable', () => {
    expect(trigramSimilarity('', 'acme')).toBe(0)
    expect(trigramSimilarity('...', 'acme')).toBe(0)
  })
})

describe('nameSimilarity', () => {
  it('treats a reordered name as the same name', () => {
    // "Ellis, Sam" and "Sam Ellis" are one name written two ways.
    expect(nameSimilarity('Ellis, Sam', 'Sam Ellis')).toBe(1)
  })

  it('treats an initial with a matching surname as near-certain, not certain', () => {
    const score = nameSimilarity('S. Ellis', 'Sam Ellis')
    // S. Ellis really might be Sam or Sarah, so it needs corroboration.
    expect(score).toBeGreaterThan(0.8)
    expect(score).toBeLessThan(1)
  })

  it('does not match an initial when the surname differs', () => {
    expect(nameSimilarity('S. Ellis', 'Sam Chen')).toBeLessThan(0.62)
  })

  it('rates two genuinely different people low', () => {
    expect(nameSimilarity('Sam Ellis', 'Gertrude Okonkwo')).toBeLessThan(0.3)
  })

  it('is 0 when a name is missing', () => {
    expect(nameSimilarity(null, 'Sam Ellis')).toBe(0)
    expect(nameSimilarity('Sam Ellis', '')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Certainties
// ---------------------------------------------------------------------------

describe('certainties score 100 and are labelled exact', () => {
  it('recognises the same LinkedIn identity', () => {
    const result = scoreContactPair(
      contact({ fullName: 'Sam Ellis', linkedInIdentityKey: 'li:in:sam-ellis' }),
      contact({ fullName: 'Totally Different', linkedInIdentityKey: 'li:in:sam-ellis' }),
    )

    expect(result.confidence).toBe('exact')
    expect(result.score).toBe(100)
    expect(result.summary).toBe('Same LinkedIn profile — 100%')
  })

  it('recognises the same mailbox', () => {
    const result = scoreContactPair(
      contact({ fullName: 'Sam Ellis', emailIdentityKeys: ['sam@acme.com'] }),
      contact({ fullName: 'Different Name', emailIdentityKeys: ['sam@acme.com'] }),
    )

    expect(result.confidence).toBe('exact')
    expect(result.score).toBe(100)
  })

  it('does not need the names to agree', () => {
    // A certainty is a certainty. "Sam Ellis" and "S.E." with one mailbox is
    // one person however the names read.
    const result = scoreContactPair(
      contact({ emailIdentityKeys: ['sam@acme.com'] }),
      contact({ emailIdentityKeys: ['sam@acme.com'] }),
    )
    expect(result.confidence).toBe('exact')
  })

  it('reserves 100 for certainties — a judgement never reaches it', () => {
    const judged = scoreContactPair(
      contact({
        fullName: 'Sam Ellis',
        companyIds: [ACME],
        phoneE164s: ['+14155550100'],
        emailDomains: ['acme.com'],
      }),
      contact({
        fullName: 'Sam Ellis',
        companyIds: [ACME],
        phoneE164s: ['+14155550100'],
        emailDomains: ['acme.com'],
      }),
    )

    // Every corroborating signal at once still stops short of certainty, so
    // "100%" in the UI always means the same mailbox or LinkedIn profile.
    expect(judged.confidence).toBe('possible')
    expect(judged.score).toBeLessThan(100)
  })
})

// ---------------------------------------------------------------------------
// The colleague trap
// ---------------------------------------------------------------------------

describe('colleagues are not duplicates', () => {
  it('does NOT flag two different people who share a switchboard', () => {
    // The whole reason name similarity is a gate rather than a weight.
    const result = scoreContactPair(
      contact({ fullName: 'Sam Ellis', phoneE164s: ['+14155550100'], companyIds: [ACME] }),
      contact({ fullName: 'Pat Chen', phoneE164s: ['+14155550100'], companyIds: [ACME] }),
    )

    expect(result.confidence).toBe('none')
    expect(result.score).toBe(0)
  })

  it('does NOT flag two people at one company with one email domain', () => {
    const result = scoreContactPair(
      contact({ fullName: 'Sam Ellis', companyIds: [ACME], emailDomains: ['acme.com'] }),
      contact({ fullName: 'Gertrude Okonkwo', companyIds: [ACME], emailDomains: ['acme.com'] }),
    )
    expect(result.confidence).toBe('none')
  })

  it('does not flag a shared company on its own', () => {
    const result = scoreContactPair(
      contact({ fullName: 'Sam Ellis', companyIds: [ACME] }),
      contact({ fullName: 'Pat Chen', companyIds: [ACME] }),
    )
    expect(result.confidence).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// Real candidates
// ---------------------------------------------------------------------------

describe('pairs a person should look at', () => {
  it('flags the same name at the same company', () => {
    const result = scoreContactPair(
      contact({ fullName: 'Sam Ellis', companyIds: [ACME] }),
      contact({ fullName: 'Sam Ellis', companyIds: [ACME] }),
    )

    expect(result.confidence).toBe('possible')
    expect(result.score).toBe(80)
    expect(result.summary).toBe('Same name and Same company — 80%')
  })

  it('flags an initial plus a corroborating signal', () => {
    const result = scoreContactPair(
      contact({ fullName: 'S. Ellis', companyIds: [ACME] }),
      contact({ fullName: 'Sam Ellis', companyIds: [ACME] }),
    )
    expect(result.confidence).toBe('possible')
  })

  it('flags a typo plus the same phone', () => {
    const result = scoreContactPair(
      contact({ fullName: 'Samuel Ellis', phoneE164s: ['+14155550100'] }),
      contact({ fullName: 'Samual Ellis', phoneE164s: ['+14155550100'] }),
    )
    expect(result.confidence).toBe('possible')
    expect(result.signals.map((s) => s.kind)).toContain('phone_identical')
  })

  it('does NOT flag an identical name with nothing to corroborate it', () => {
    // Two people in one workspace can genuinely be called John Smith. Asking
    // about every such pair is how the Center becomes noise.
    const result = scoreContactPair(
      contact({ fullName: 'John Smith' }),
      contact({ fullName: 'John Smith' }),
    )
    expect(result.confidence).toBe('none')
  })

  it('weights company above phone, because a switchboard is shared', () => {
    const withCompany = scoreContactPair(
      contact({ fullName: 'Sam Ellis', companyIds: [ACME] }),
      contact({ fullName: 'Sam Ellis', companyIds: [ACME] }),
    )
    const withPhone = scoreContactPair(
      contact({ fullName: 'Sam Ellis', phoneE164s: ['+14155550100'] }),
      contact({ fullName: 'Sam Ellis', phoneE164s: ['+14155550100'] }),
    )
    expect(withCompany.score).toBeGreaterThan(withPhone.score)
  })

  it('does not treat different companies as corroboration', () => {
    const result = scoreContactPair(
      contact({ fullName: 'Sam Ellis', companyIds: [ACME] }),
      contact({ fullName: 'Sam Ellis', companyIds: [GLOBEX] }),
    )
    expect(result.confidence).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// Acceptance criterion 4
// ---------------------------------------------------------------------------

describe('every flagged pair carries reasons and a confidence', () => {
  const PAIRS: [ContactFacts, ContactFacts][] = [
    [
      contact({ fullName: 'Sam Ellis', linkedInIdentityKey: 'li:in:x' }),
      contact({ fullName: 'Sam Ellis', linkedInIdentityKey: 'li:in:x' }),
    ],
    [
      contact({ fullName: 'Sam Ellis', emailIdentityKeys: ['s@acme.com'] }),
      contact({ fullName: 'Sam Ellis', emailIdentityKeys: ['s@acme.com'] }),
    ],
    [
      contact({ fullName: 'Sam Ellis', companyIds: [ACME] }),
      contact({ fullName: 'Sam Ellis', companyIds: [ACME] }),
    ],
    [
      contact({ fullName: 'Samuel Ellis', phoneE164s: ['+14155550100'] }),
      contact({ fullName: 'Samual Ellis', phoneE164s: ['+14155550100'] }),
    ],
  ]

  for (const [a, b] of PAIRS) {
    it(`${a.fullName} / ${b.fullName} is explainable`, () => {
      const result = scoreContactPair(a, b)
      expect(result.confidence).not.toBe('none')
      expect(result.signals.length).toBeGreaterThan(0)
      // A reason a person can read without knowing the schema.
      for (const signal of result.signals) {
        expect(signal.reason.length).toBeGreaterThan(3)
        expect(signal.reason).not.toMatch(/_id|identity_key|null/)
      }
      expect(result.summary).toContain(`${result.score}%`)
    })
  }

  it('says nothing at all about a pair it is not flagging', () => {
    const result = scoreContactPair(
      contact({ fullName: 'Sam Ellis' }),
      contact({ fullName: 'Gertrude Okonkwo' }),
    )
    expect(result.signals).toEqual([])
    expect(result.summary).toBe('')
  })

  it('reads as a sentence with three or more reasons', () => {
    const result = scoreContactPair(
      contact({
        fullName: 'Sam Ellis',
        companyIds: [ACME],
        phoneE164s: ['+14155550100'],
      }),
      contact({
        fullName: 'Sam Ellis',
        companyIds: [ACME],
        phoneE164s: ['+14155550100'],
      }),
    )
    expect(result.summary).toBe('Same name, Same company and Same phone number — 99%')
  })
})

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

describe('scoreCompanyPair', () => {
  it('treats a shared domain as certain', () => {
    const result = scoreCompanyPair(
      company({ normalizedName: 'acme', normalizedDomain: 'acme.com' }),
      company({ normalizedName: 'acme holdings', normalizedDomain: 'acme.com' }),
    )
    expect(result.confidence).toBe('exact')
    expect(result.score).toBe(100)
  })

  it('treats a shared LinkedIn page as certain', () => {
    const result = scoreCompanyPair(
      company({ normalizedLinkedInUrl: 'linkedin.com/company/acme' }),
      company({ normalizedLinkedInUrl: 'linkedin.com/company/acme' }),
    )
    expect(result.confidence).toBe('exact')
  })

  it('flags an identical name as possible, never certain', () => {
    // "Apex Systems" and "Apex Ltd" are usually two firms, and merging them
    // silently takes two customers' records with them.
    const result = scoreCompanyPair(
      company({ normalizedName: 'apex' }),
      company({ normalizedName: 'apex' }),
    )
    expect(result.confidence).toBe('possible')
    expect(result.score).toBeLessThan(100)
  })

  it('does not flag two unrelated names', () => {
    expect(
      scoreCompanyPair(
        company({ normalizedName: 'acme' }),
        company({ normalizedName: 'globex' }),
      ).confidence,
    ).toBe('none')
  })

  it('does not flag when either side has no identity', () => {
    expect(scoreCompanyPair(company(), company()).confidence).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// Pair ordering
// ---------------------------------------------------------------------------

describe('orderPair', () => {
  it('gives one canonical order whichever way round it is called', () => {
    // Matches the record_a_id < record_b_id check in 0074. Without it the
    // Duplicate Center shows each pair twice and resolving one leaves the
    // other open forever.
    expect(orderPair('b', 'a')).toEqual(['a', 'b'])
    expect(orderPair('a', 'b')).toEqual(['a', 'b'])
  })
})
