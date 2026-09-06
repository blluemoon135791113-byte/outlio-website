/**
 * Derived intelligence — trends computed from evidence already held.
 *
 * Zero API calls. `research_evidence` is insert-only, which was done so two
 * providers disagreeing stays inspectable — but it also makes the table a time
 * series, and a trend falls out of data already paid for.
 *
 * The refusals matter more than the calculations here. A single observation is
 * a reading, not a trend, and reporting it as 0% growth would invent a fact
 * about a company nobody has watched yet.
 */
import { describe, expect, it } from 'vitest'

import {
  DERIVED_FIELDS,
  deriveAll,
  deriveCompanyAge,
  deriveEmployeeGrowth,
  deriveFundingRecency,
  deriveTechChurn,
  derivedEvidence,
} from '@/lib/intelligence/derive'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import type { EvidenceRecord, ResearchField } from '@/lib/intelligence/types'

const COMPANY_ID = '00000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-08-16T00:00:00.000Z')

let counter = 0

function observation(
  field: ResearchField,
  value: Record<string, unknown>,
  daysAgo: number,
  provider = 'prospeo',
): EvidenceRecord {
  return {
    id: `e${++counter}`,
    entityType: 'company',
    entityId: COMPANY_ID,
    field,
    value,
    sourceProvider: provider,
    sourceUrl: null,
    sourceConfidence: 'medium',
    confidence: 0.8,
    retrievedAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    expiresAt: null,
    researchRunId: null,
  }
}

describe('deriveEmployeeGrowth', () => {
  it('computes growth between two readings from the same provider', () => {
    const fact = deriveEmployeeGrowth([
      observation('employee_count', { count: 40 }, 90),
      observation('employee_count', { count: 50 }, 0),
    ])

    expect(fact?.value).toMatchObject({
      from: 40,
      to: 50,
      change: 10,
      percentChange: 25,
      direction: 'growing',
    })
  })

  it('reports shrinking honestly', () => {
    const fact = deriveEmployeeGrowth([
      observation('employee_count', { count: 100 }, 60),
      observation('employee_count', { count: 80 }, 0),
    ])

    expect(fact?.value).toMatchObject({ change: -20, percentChange: -20, direction: 'shrinking' })
  })

  it('REFUSES a single observation', () => {
    // One reading is a headcount, not a trend. Reporting 0% growth would be a
    // claim about a company nobody has watched over time.
    expect(deriveEmployeeGrowth([observation('employee_count', { count: 40 }, 0)])).toBeNull()
    expect(deriveEmployeeGrowth([])).toBeNull()
  })

  it('REFUSES to compare across providers', () => {
    /*
     * Apollo estimates headcount; Prospeo reports a figure. A change between
     * them measures our choice of vendor, not the company's hiring.
     */
    expect(
      deriveEmployeeGrowth([
        observation('employee_count', { count: 40 }, 90, 'apollo'),
        observation('employee_count', { count: 50 }, 0, 'prospeo'),
      ]),
    ).toBeNull()
  })

  it('rates a short window lower than a long one', () => {
    const short = deriveEmployeeGrowth([
      observation('employee_count', { count: 40 }, 5),
      observation('employee_count', { count: 50 }, 0),
    ])
    const long = deriveEmployeeGrowth([
      observation('employee_count', { count: 40 }, 200),
      observation('employee_count', { count: 50 }, 0),
    ])

    expect(short!.confidence).toBeLessThan(long!.confidence)
  })

  it('records which observations it used, so the arithmetic can be checked', () => {
    const first = observation('employee_count', { count: 40 }, 90)
    const last = observation('employee_count', { count: 50 }, 0)

    expect(deriveEmployeeGrowth([first, last])?.basedOn).toEqual([first.id, last.id])
  })
})

describe('deriveTechChurn', () => {
  it('reports what was added and dropped', () => {
    const fact = deriveTechChurn([
      observation('tech_stack', { detected: [{ id: 'mailchimp' }, { id: 'zendesk' }] }, 60),
      observation('tech_stack', { detected: [{ id: 'hubspot' }, { id: 'zendesk' }] }, 0),
    ])

    expect(fact?.value).toMatchObject({ added: ['hubspot'], removed: ['mailchimp'] })
  })

  it('says nothing when the stack is unchanged', () => {
    // "No change" is not a signal worth storing on every run.
    expect(
      deriveTechChurn([
        observation('tech_stack', { detected: [{ id: 'hubspot' }] }, 60),
        observation('tech_stack', { detected: [{ id: 'hubspot' }] }, 0),
      ]),
    ).toBeNull()
  })

  it('REFUSES to compare two different detectors', () => {
    // DNS sees the sending stack; PageSpeed sees the CMS. A difference between
    // them is a difference in method, not a change at the company.
    expect(
      deriveTechChurn([
        observation('tech_stack', { detected: [{ id: 'wordpress' }] }, 60, 'pagespeed-tech'),
        observation('tech_stack', { detected: [{ id: 'hubspot' }] }, 0, 'dns-tech'),
      ]),
    ).toBeNull()
  })

  it('needs two observations', () => {
    expect(deriveTechChurn([observation('tech_stack', { detected: [{ id: 'hubspot' }] }, 0)])).toBeNull()
  })
})

describe('deriveCompanyAge', () => {
  it('computes years from an incorporation filing', () => {
    const fact = deriveCompanyAge([observation('incorporation_date', { value: '2011-06-01' }, 0)], NOW)
    expect(fact?.value).toMatchObject({ years: 15, foundedAt: '2011-06-01' })
  })

  it('treats a YEAR-precision origin as a year, not 1 January', () => {
    /*
     * Apollo gives `founded_year`. Parsing "2011" yields 1 January 2011, and
     * subtracting from August 2026 would say 15 years — but a company founded
     * that December is 14. Year precision is subtracted as years and flagged.
     */
    const fact = deriveCompanyAge(
      [observation('incorporation_date', { value: '2011', precision: 'year' }, 0)],
      NOW,
    )

    expect(fact?.value).toMatchObject({ years: 15, foundedAt: '2011', isApproximate: true })
    // A self-reported year is weaker evidence than a filing.
    expect(fact!.confidence).toBeLessThan(0.95)
  })

  it('ignores an unparseable or absurd date', () => {
    expect(deriveCompanyAge([observation('incorporation_date', { value: 'garbage' }, 0)], NOW)).toBeNull()
    expect(deriveCompanyAge([observation('incorporation_date', { value: '1400-01-01' }, 0)], NOW)).toBeNull()
  })

  it('returns nothing without a founding date', () => {
    expect(deriveCompanyAge([], NOW)).toBeNull()
  })
})

describe('deriveFundingRecency', () => {
  it('turns a date into the window a seller acts on', () => {
    const fact = deriveFundingRecency(
      [observation('funding_date', { raisedAt: '2026-06-01' }, 0)],
      NOW,
    )

    expect(fact?.value).toMatchObject({ monthsAgo: 2, window: 'last_3_months' })
  })

  it('buckets older rounds correctly', () => {
    const fact = deriveFundingRecency(
      [observation('funding_date', { raisedAt: '2024-01-01' }, 0)],
      NOW,
    )
    expect(fact?.value).toMatchObject({ window: 'older' })
  })

  it('carries through whether the date was an ANNOUNCEMENT', () => {
    // A filter on "raised in the last 3 months" should know it is looking at
    // the date the press wrote about it, not the date the round closed.
    const fact = deriveFundingRecency(
      [observation('funding_date', { announcedAt: '2026-07-01', isAnnouncementDate: true }, 0)],
      NOW,
    )

    expect(fact?.value).toMatchObject({ isAnnouncementDate: true })
  })

  it('never exceeds the confidence of the observation behind it', () => {
    const record = observation('funding_date', { raisedAt: '2026-06-01' }, 0)
    record.confidence = 0.4

    expect(deriveFundingRecency([record], NOW)!.confidence).toBeLessThanOrEqual(0.4)
  })
})

describe('deriveAll and derivedEvidence', () => {
  it('returns only what the history supports', () => {
    // A company seen once yields no trends. That is correct, not disappointing.
    expect(deriveAll([observation('employee_count', { count: 40 }, 0)], NOW)).toEqual([])
  })

  it('attributes derived facts to Outlio, not to a provider', () => {
    const facts = deriveAll(
      [
        observation('employee_count', { count: 40 }, 90),
        observation('employee_count', { count: 50 }, 0),
      ],
      NOW,
    )

    const evidence = derivedEvidence(facts, COMPANY_ID, expiresAtFor, NOW)

    expect(evidence[0]!.sourceProvider).toBe('outlio-derived')
    // No URL is invented for a computation.
    expect(evidence[0]!.sourceUrl).toBeNull()
    // Arithmetic is exact; its inputs are observations, so never HIGH.
    expect(evidence[0]!.sourceConfidence).toBe('medium')
    expect(evidence[0]!.value.basedOn).toHaveLength(2)
  })

  it('every derived field is a real research field with a TTL', () => {
    for (const field of DERIVED_FIELDS) {
      expect(expiresAtFor(field as ResearchField, NOW), field).not.toBeUndefined()
    }
  })
})
