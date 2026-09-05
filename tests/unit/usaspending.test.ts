/**
 * USAspending.gov — US federal award spending.
 *
 * The matching tests carry the weight. `autocomplete/recipient` is a substring
 * search that returns "LONELY MOUNTAIN PALANTIR ENTERPRISES" beside "PALANTIR
 * TECHNOLOGIES INC.", and its `uei` is frequently null, so there is no id to
 * disambiguate with. Attributing another company's federal contracts to a lead
 * would be a confident, serious, and very visible error.
 */
import { describe, expect, it } from 'vitest'

import {
  pickRecipients,
  searchKeyword,
  summariseAwardTypes,
  usaSpendingEvidence,
  USASPENDING_FIELDS,
  type UsaSpendingFacts,
} from '@/lib/intelligence/providers/usaspending'
import { FIELD_TTL_SECONDS } from '@/lib/intelligence/ttl'
import { RESEARCH_FIELD_SPEC } from '@/lib/intelligence/types'

const COMPANY_ID = '00000000-0000-4000-8000-000000000001'

/** The real shape returned for "Palantir", verbatim. */
const PALANTIR_RESULTS = [
  { recipient_name: 'LONELY MOUNTAIN PALANTIR ENTERPRISES', uei: null },
  { recipient_name: 'PALANTIR TECHNOLOGIES INC.', uei: null },
  { recipient_name: 'PALANTIR USA INC.', uei: null },
  { recipient_name: 'PALANTIR USG INC', uei: null },
  { recipient_name: 'PALANTIR.NET INC', uei: null },
]

describe('pickRecipients — the substring trap', () => {
  it('matches the exact company, ignoring the substring noise', () => {
    expect(pickRecipients('Palantir Technologies', PALANTIR_RESULTS)).toEqual([
      'PALANTIR TECHNOLOGIES INC.',
    ])
  })

  it('REFUSES a bare "Palantir" — none of the five IS "Palantir"', () => {
    // Every candidate merely contains the word. None normalizes to it, so
    // nothing is attributed.
    expect(pickRecipients('Palantir', PALANTIR_RESULTS)).toEqual([])
  })

  it('never matches a company that merely contains the name', () => {
    expect(
      pickRecipients('Palantir', [{ recipient_name: 'LONELY MOUNTAIN PALANTIR ENTERPRISES' }]),
    ).toEqual([])
  })

  it('ignores legal-form and case differences', () => {
    expect(pickRecipients('Acme Systems Inc', [{ recipient_name: 'ACME SYSTEMS, INC.' }])).toEqual([
      'ACME SYSTEMS, INC.',
    ])
  })

  it('KEEPS every duplicate registration of one company', () => {
    /*
     * Booz Allen Hamilton files under four variants. Treating them as rival
     * candidates and refusing made a company with billions in federal
     * contracts report none — a false negative found by live testing.
     */
    expect(
      pickRecipients('Booz Allen Hamilton', [
        { recipient_name: 'BOOZ ALLEN HAMILTON INC.' },
        { recipient_name: 'BOOZ ALLEN HAMILTON INC' },
        { recipient_name: 'BOOZ ALLEN HAMILTON HOLDING CORPORATION' },
      ]),
    ).toEqual(['BOOZ ALLEN HAMILTON INC.', 'BOOZ ALLEN HAMILTON INC'])
  })

  it('de-duplicates identical names', () => {
    expect(
      pickRecipients('Acme', [{ recipient_name: 'ACME INC' }, { recipient_name: 'ACME INC' }]),
    ).toEqual(['ACME INC'])
  })

  it('returns nothing for no candidates or no name', () => {
    expect(pickRecipients('Acme', [])).toEqual([])
    expect(pickRecipients(null, PALANTIR_RESULTS)).toEqual([])
    expect(pickRecipients('   ', PALANTIR_RESULTS)).toEqual([])
  })
})

describe('searchKeyword — the keywords filter ANDs', () => {
  it('picks the SHORTEST verified registration', () => {
    /*
     * Measured against the live API: sending all five Booz Allen registrations
     * returned 52 awards and a negative total, while any one alone returned
     * 128,168 awards and $91.6bn. The filter is AND, and the search is a
     * substring match, so the shortest verified name is the most inclusive.
     */
    expect(
      searchKeyword([
        'BOOZ ALLEN HAMILTON INC.',
        'BOOZ ALLEN HAMILTON INC',
        'BOOZ ALLEN HAMILTON, INC',
      ]),
    ).toBe('BOOZ ALLEN HAMILTON INC')
  })

  it('returns null when nothing was verified', () => {
    expect(searchKeyword([])).toBeNull()
  })

  it('passes a single registration through unchanged', () => {
    expect(searchKeyword(['PALANTIR TECHNOLOGIES INC.'])).toBe('PALANTIR TECHNOLOGIES INC.')
  })
})

describe('summariseAwardTypes', () => {
  it('keeps only the buckets that were actually awarded', () => {
    expect(
      summariseAwardTypes({ contracts: 171, direct_payments: 0, grants: 0, idvs: 18, loans: 0 }),
    ).toEqual({ contracts: 171, idvs: 18 })
  })

  it('survives an empty or missing result', () => {
    expect(summariseAwardTypes(undefined)).toEqual({})
    expect(summariseAwardTypes({})).toEqual({})
  })
})

describe('usaSpendingEvidence', () => {
  const FACTS: UsaSpendingFacts = {
    recipientName: 'PALANTIR TECHNOLOGIES INC.',
    awardCount: 1919,
    obligatedAmount: 5_147_910_679.07,
    awardTypes: { contracts: 171, idvs: 18 },
  }

  const ALL = [...USASPENDING_FIELDS]

  it('records the obligated total with its currency', () => {
    const evidence = usaSpendingEvidence(FACTS, COMPANY_ID, ALL)
    expect(evidence.find((item) => item.field === 'federal_awards_total')?.value).toMatchObject({
      amount: 5_147_910_679.07,
      currency: 'USD',
    })
  })

  it('rates a government filing HIGH', () => {
    // Spec §17 defines a public filing as the top confidence tier.
    for (const item of usaSpendingEvidence(FACTS, COMPANY_ID, ALL)) {
      expect(item.sourceConfidence).toBe('high')
    }
  })

  it('carries a checkable source URL on every claim', () => {
    for (const item of usaSpendingEvidence(FACTS, COMPANY_ID, ALL)) {
      expect(item.sourceUrl).toContain('usaspending.gov')
    }
  })

  it('records NOTHING for a company with no federal awards', () => {
    // An absence of contracts is not a fact worth asserting about a company.
    expect(usaSpendingEvidence(null, COMPANY_ID, ALL)).toEqual([])
    expect(usaSpendingEvidence({ ...FACTS, awardCount: 0 }, COMPANY_ID, ALL)).toEqual([])
  })

  it('emits only the fields the task asked for', () => {
    const evidence = usaSpendingEvidence(FACTS, COMPANY_ID, ['federal_awards_total'])
    expect(evidence.map((item) => item.field)).toEqual(['federal_awards_total'])
  })

  it('omits the award-type breakdown when there is none', () => {
    const evidence = usaSpendingEvidence({ ...FACTS, awardTypes: {} }, COMPANY_ID, ALL)
    expect(evidence.find((item) => item.field === 'federal_award_types')).toBeUndefined()
  })

  it('files everything against the company', () => {
    for (const item of usaSpendingEvidence(FACTS, COMPANY_ID, ALL)) {
      expect(item.entityType).toBe('company')
      expect(item.entityId).toBe(COMPANY_ID)
    }
  })
})

describe('field registration', () => {
  it('registers every field as a company profile fact', () => {
    for (const field of USASPENDING_FIELDS) {
      expect(RESEARCH_FIELD_SPEC[field], field).toEqual({
        category: 'company_profile',
        entity: 'company',
      })
    }
  })

  it('gives each field a TTL, and never expires the matched name', () => {
    for (const field of USASPENDING_FIELDS) {
      expect(FIELD_TTL_SECONDS, field).toHaveProperty(field)
    }
    // The recipient's registered name does not change.
    expect(FIELD_TTL_SECONDS.federal_recipient_name).toBeNull()
    // The totals do move, so they must not be cached forever.
    expect(FIELD_TTL_SECONDS.federal_awards_total).toBeGreaterThan(0)
  })
})
