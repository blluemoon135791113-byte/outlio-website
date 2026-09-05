import { describe, expect, it } from 'vitest'

import {
  CONTACT_FIELDS,
  isContactField,
  macroFields,
} from '@/lib/intelligence/analysis-scope'
import {
  analyseRun,
  analysisCsvRows,
  compareAnalyses,
  coverageOf,
} from '@/lib/intelligence/aggregate'
import type { ResultRow } from '@/lib/intelligence/results'
import { RESEARCH_FIELD_SPEC, type ResearchField } from '@/lib/intelligence/types'

describe('set-wide field scope', () => {
  it('identifies contact fields that need row-level presentation', () => {
    for (const field of ['work_email', 'mobile_phone', 'person_social_profiles'] as ResearchField[]) {
      expect(isContactField(field)).toBe(true)
    }
  })

  it('does not classify role attributes as contact fields', () => {
    expect(isContactField('person_seniority')).toBe(false)
    expect(isContactField('person_department')).toBe(false)
  })

  it('makes every sourced field available to set-wide research', () => {
    const all = Object.keys(RESEARCH_FIELD_SPEC).length
    expect(macroFields()).toHaveLength(all)
    expect(macroFields()).toEqual(expect.arrayContaining([...CONTACT_FIELDS]))
  })
})

function row(id: string, fields: Record<string, unknown>, companyName?: string): ResultRow {
  return {
    leadId: id,
    personName: `Person ${id}`,
    jobTitle: null,
    linkedinUrl: null,
    companyId: null,
    companyName: companyName ?? `Company ${id}`,
    companyDomain: null,
    qualification: null,
    fields: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        value === undefined
          ? { state: 'unknown' as const, reason: 'not_found' as const }
          : {
              state: 'known' as const,
              value,
              sourceUrl: null,
              sourceProvider: 'test',
              confidence: 0.8,
              corroboratingProviders: [],
              conflictingProviders: [],
            },
      ]),
    ),
  }
}

describe('the macro answer is the analysis', () => {
  it('reports a distribution with the base it was computed from', () => {
    const rows = [
      row('1', { industry: 'Software' }),
      row('2', { industry: 'Software' }),
      row('3', { industry: 'Retail' }),
      row('4', { industry: undefined }),
    ]

    const analysis = analyseRun(['industry'], rows)
    const industry = analysis.distributions[0]!

    expect(analysis.leads).toBe(4)
    expect(industry.known).toBe(3)
    expect(industry.unknown).toBe(1)
    // Share is of what was KNOWN, not of the whole set.
    expect(industry.buckets[0]).toMatchObject({ label: 'Software', count: 2 })
    expect(industry.buckets[0]!.share).toBeCloseTo(2 / 3, 5)
    expect(analysis.headlines[0]).toContain('companies with known industry')
    expect(analysis.headlines[0]).not.toContain('of the set')
  })

  it('⚠️ names a thin field out loud', () => {
    /*
     * A breakdown over 1 of 5 leads renders identically to one over 5 of 5
     * unless something says so, and a reader who does not notice acts on a
     * number that is not there.
     */
    const rows = [
      row('1', { industry: 'Software' }),
      ...['2', '3', '4', '5'].map((id) => row(id, { industry: undefined })),
    ]

    const analysis = analyseRun(['industry'], rows)

    expect(analysis.headlines.some((line) => line.startsWith('Thin evidence'))).toBe(true)
  })

  it('counts each value of a multi-value field once per lead', () => {
    // A tech stack is many values on one lead.
    const rows = [
      row('1', { tech_stack: ['HubSpot', 'Segment'] }),
      row('2', { tech_stack: ['HubSpot'] }),
    ]

    const analysis = analyseRun(['tech_stack'], rows)
    const stack = analysis.distributions[0]!

    expect(stack.known).toBe(2)
    expect(stack.buckets[0]).toMatchObject({ label: 'HubSpot', count: 2 })
    expect(stack.distinct).toBe(2)
  })

  it('summarises numbers rather than bucketing them', () => {
    const rows = [
      row('1', { employee_count: 10 }),
      row('2', { employee_count: 20 }),
      row('3', { employee_count: 300 }),
    ]

    const analysis = analyseRun(['employee_count'], rows)

    expect(analysis.distributions).toHaveLength(0)
    expect(analysis.numerics[0]).toMatchObject({
      field: 'employee_count',
      known: 3,
      min: 10,
      median: 20,
      max: 300,
      total: 330,
    })
  })

  it('normalizes abbreviated numeric values without treating ranges as exact', () => {
    const rows = [
      row('1', { revenue_estimate: '$1.2M USD' }),
      row('2', { revenue_estimate: '750k' }),
      row('3', { revenue_estimate: '10-50M' }),
    ]

    const revenue = analyseRun(['revenue_estimate'], rows).numerics[0]!
    expect(revenue).toMatchObject({
      known: 2,
      unknown: 1,
      min: 750_000,
      median: 975_000,
      max: 1_200_000,
      total: 1_950_000,
    })
  })

  it('never renders an object as a category', () => {
    // "[object Object]" in a distribution looks like a real category.
    const rows = [row('1', { funding_investors: { name: 'Acme Ventures' } })]
    const analysis = analyseRun(['funding_investors'], rows)

    expect(analysis.distributions[0]!.buckets[0]!.label).toBe('Acme Ventures')
    expect(JSON.stringify(analysis)).not.toContain('[object Object]')
  })

  it('counts distinct companies, not rows', () => {
    // Six contacts at one company are one company.
    const rows = [
      row('1', { industry: 'Software' }, 'Acme'),
      row('2', { industry: 'Software' }, 'Acme'),
      row('3', { industry: 'Retail' }, 'Globex'),
    ]

    const analysis = analyseRun(['industry'], rows)

    expect(analysis.leads).toBe(3)
    expect(analysis.companies).toBe(2)
    expect(analysis.distributions[0]).toMatchObject({
      entity: 'company',
      known: 2,
      unknown: 0,
      base: 2,
    })
    expect(analysis.distributions[0]!.buckets).toEqual([
      expect.objectContaining({ label: 'Retail', count: 1 }),
      expect.objectContaining({ label: 'Software', count: 1 }),
    ])
  })

  it('drops a field nothing is known about rather than showing an empty chart', () => {
    const rows = [row('1', { industry: undefined })]
    expect(analyseRun(['industry'], rows).distributions).toHaveLength(0)
  })

  it('ranks the most concentrated field first', () => {
    const rows = [
      row('1', { industry: 'Software', business_model: 'B2B' }),
      row('2', { industry: 'Retail', business_model: 'B2B' }),
      row('3', { industry: 'Finance', business_model: 'B2B' }),
    ]

    const analysis = analyseRun(['industry', 'business_model'], rows)

    // business_model is unanimous; industry is a three-way split.
    expect(analysis.distributions[0]!.field).toBe('business_model')
    expect(analysis.distributions[0]!.concentration).toBe(1)
  })

  it('handles an empty run without inventing an answer', () => {
    const analysis = analyseRun(['industry'], [])
    expect(analysis).toMatchObject({ leads: 0, companies: 0, distributions: [], headlines: [] })
  })
})

/**
 * A company that arrived on a saved ACCOUNT LIST: no person, so no lead id.
 * `companyId` is set because the company is real and must dedupe against
 * itself; the person fields are `no_person`, which is not a lookup failure.
 */
function accountRow(id: string, fields: Record<string, unknown>): ResultRow {
  const base = row(id, fields, `Account ${id}`)
  return {
    ...base,
    leadId: null,
    personName: null,
    companyId: `company-${id}`,
    fields: Object.fromEntries(
      Object.entries(base.fields).map(([key, cell]) => [
        key,
        cell.state === 'unknown' ? { state: 'unknown' as const, reason: 'no_person' as const } : cell,
      ]),
    ),
  }
}

describe('account-list companies in a macro analysis', () => {
  it('counts a company that no lead points at', () => {
    /*
     * ⚠️ THE WHOLE POINT OF THE WORKSPACE SCOPE. An account list holds
     * companies and no people, so before these rows existed its companies were
     * researched and then dropped before the analysis — spend with nothing to
     * show for it.
     */
    const analysis = analyseRun(
      ['industry'],
      [row('1', { industry: 'Software' }), accountRow('2', { industry: 'Retail' })],
    )

    const industry = analysis.distributions[0]!
    expect(industry.base).toBe(2)
    expect(industry.known).toBe(2)
    expect(industry.buckets.map((bucket) => bucket.label).sort()).toEqual(['Retail', 'Software'])
  })

  it('⚠️ does not put a person-less row in a person field’s denominator', () => {
    /*
     * "Job title known for 1 of 2 leads" would be a coverage failure invented
     * by the analysis: the second row is a company, has no person, and was
     * never looked up. It must not dilute the figure.
     */
    const analysis = analyseRun(
      ['job_title'],
      [row('1', { job_title: 'Founder' }), accountRow('2', { job_title: undefined })],
    )

    const jobTitle = analysis.distributions[0]!
    expect(jobTitle.entity).toBe('person')
    expect(jobTitle.base).toBe(1)
    expect(jobTitle.known).toBe(1)
    expect(jobTitle.unknown).toBe(0)
  })

  it('still counts ordinary leads in a person field', () => {
    // The exclusion must key on an explicit null, not on anything else that
    // happens to be missing, or it would quietly shrink normal analyses.
    const analysis = analyseRun(
      ['job_title'],
      [row('1', { job_title: 'Founder' }), row('2', { job_title: undefined })],
    )

    expect(analysis.distributions[0]!.base).toBe(2)
    expect(analysis.distributions[0]!.unknown).toBe(1)
  })
})

describe('coverage', () => {
  it('⚠️ ranks the THINNEST column first', () => {
    /*
     * Sorted best-first this is a reassurance exercise. The useful question is
     * what the analysis is weakest on, because that is the column a reader is
     * most likely to over-trust.
     */
    const rows = [
      row('1', { industry: 'Software', business_model: 'B2B' }),
      row('2', { industry: 'Retail', business_model: undefined }),
      row('3', { industry: 'Finance', business_model: undefined }),
    ]

    const coverage = coverageOf(analyseRun(['industry', 'business_model'], rows))

    expect(coverage[0]).toMatchObject({ field: 'business_model', known: 1, total: 3, thin: true })
    expect(coverage[1]).toMatchObject({ field: 'industry', known: 3, thin: false })
  })

  it('marks a field known for exactly half as not thin', () => {
    const rows = [row('1', { industry: 'Software' }), row('2', { industry: undefined })]
    expect(coverageOf(analyseRun(['industry'], rows))[0]!.thin).toBe(false)
  })
})

describe('comparing two sets', () => {
  const listA = analyseRun(
    ['industry'],
    [
      row('1', { industry: 'Software' }),
      row('2', { industry: 'Software' }),
      row('3', { industry: 'Retail' }),
      row('4', { industry: 'Retail' }),
    ],
  )

  it('reports the share difference per bucket', () => {
    const listB = analyseRun(
      ['industry'],
      [
        row('5', { industry: 'Software' }),
        row('6', { industry: 'Software' }),
        row('7', { industry: 'Software' }),
        row('8', { industry: 'Retail' }),
      ],
    )

    const [industry] = compareAnalyses(listA, listB)
    if (!industry) throw new Error('expected a comparison')

    expect(industry.unreliable).toBe(false)
    const software = industry.buckets.find((bucket) => bucket.label === 'Software')!
    expect(software.shareA).toBeCloseTo(0.5, 5)
    expect(software.shareB).toBeCloseTo(0.75, 5)
    expect(software.delta).toBeCloseTo(0.25, 5)
  })

  it('⚠️ SUPPRESSES the delta when one side is thinly covered', () => {
    /*
     * If industry is known for all of A and a quarter of B, "B is more
     * software" is a statement about what we FAILED TO FIND. On screen that is
     * indistinguishable from a real difference, so the subtraction is withheld
     * rather than annotated — a caveat under a big number does not stop anyone
     * believing the number.
     */
    const thinB = analyseRun(
      ['industry'],
      [
        row('5', { industry: 'Software' }),
        row('6', { industry: undefined }),
        row('7', { industry: undefined }),
        row('8', { industry: undefined }),
      ],
    )

    const [industry] = compareAnalyses(listA, thinB)
    if (!industry) throw new Error('expected a comparison')

    expect(industry.unreliable).toBe(true)
    expect(industry.buckets.every((bucket) => bucket.delta === null)).toBe(true)
    // The shares themselves are real and still shown; only the delta is withheld.
    expect(industry.buckets.some((bucket) => bucket.shareB > 0)).toBe(true)
    expect(industry).toMatchObject({ knownA: 4, knownB: 1, totalA: 4, totalB: 4 })
  })

  it('only compares fields present on both sides', () => {
    const other = analyseRun(['business_model'], [row('9', { business_model: 'B2B' })])
    expect(compareAnalyses(listA, other)).toEqual([])
  })
})

describe('analysis CSV', () => {
  it('emits one row per bucket, carrying the base', () => {
    const analysis = analyseRun(
      ['industry'],
      [row('1', { industry: 'Software' }), row('2', { industry: undefined })],
    )

    expect(analysisCsvRows(analysis)).toEqual([
      {
        field: 'industry',
        value: 'Software',
        count: 1,
        share_percent: 100,
        known: 1,
        entity: 'company',
        total_entities: 2,
      },
    ])
  })
})
