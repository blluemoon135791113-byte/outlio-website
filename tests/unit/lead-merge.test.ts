/**
 * Merging research results back onto leads.
 *
 * Two things have to hold, and both are about not manufacturing facts:
 * an `unknown` cell must never become an empty column, and an evidence object
 * must never reach a CRM as `[object Object]`.
 */
import { describe, expect, it } from 'vitest'

import {
  buildMergePlan,
  enrichmentCells,
  enrichmentColumnHeader,
  enrichmentColumns,
  flattenEnrichmentValue,
} from '@/lib/intelligence/merge'
import type { ResultRow } from '@/lib/intelligence/results'
import type { ResearchField } from '@/lib/intelligence/types'

const RUN_ID = '00000000-0000-4000-8000-0000000000aa'
const NOW = new Date('2026-08-16T12:00:00.000Z')

function row(leadId: string, fields: ResultRow['fields']): ResultRow {
  return {
    leadId,
    personName: 'Fabricated Person',
    jobTitle: 'Founder',
    linkedinUrl: null,
    companyId: 'c1',
    companyName: 'Fabricated Systems',
    companyDomain: 'example.com',
    fields,
    qualification: null,
  }
}

const known = (value: unknown, provider = 'prospeo') =>
  ({ state: 'known', value, sourceProvider: provider, sourceUrl: null }) as const

const unknown = { state: 'unknown', reason: 'not_found' } as const

describe('social profiles split into per-platform columns', () => {
  const RUN = {
    runId: RUN_ID,
    columns: ['social_profiles'] as ResearchField[],
    rows: [
      row('lead-1', {
        social_profiles: known(
          { x: 'https://x.com/acme', instagram: 'https://instagram.com/acme' },
          'social-scout-company',
        ),
      }),
    ],
  }

  it('splits the blob into one provenance-carrying cell per platform', () => {
    const plan = buildMergePlan(RUN, { now: NOW })
    const patch = plan.byLead['lead-1']!

    expect(patch['social_x']?.value).toBe('https://x.com/acme')
    expect(patch['social_x']?.provider).toBe('social-scout-company')
    expect(patch['social_instagram']?.value).toBe('https://instagram.com/acme')
    // The bunched field itself is never written.
    expect(patch['social_profiles']).toBeUndefined()
    expect(plan.mergedCells).toBe(2)
  })

  it('headers read as the platform, with X disambiguated', () => {
    expect(enrichmentColumnHeader('social_x')).toBe('X (Twitter)')
    expect(enrichmentColumnHeader('social_instagram')).toBe('Instagram')
    expect(enrichmentColumnHeader('personal_social_linkedin')).toBe('Personal LinkedIn')
    expect(enrichmentColumnHeader('social_crunchbase')).toBe('Crunchbase')
  })

  it('writes nothing when the socials map is empty', () => {
    const plan = buildMergePlan({
      runId: RUN_ID,
      columns: ['social_profiles'] as ResearchField[],
      rows: [row('lead-1', { social_profiles: known({}) })],
    }, { now: NOW })
    expect(plan.byLead['lead-1']).toBeUndefined()
    expect(plan.unknownCells).toBe(1)
  })

})

describe('buildMergePlan', () => {
  const results = {
    runId: RUN_ID,
    columns: ['work_email', 'industry'] as ResearchField[],
    rows: [
      row('lead-1', { work_email: known({ email: 'sam@acme.com' }), industry: known({ industry: 'Software' }, 'apollo') }),
      row('lead-2', { work_email: unknown, industry: known({ industry: 'Software' }, 'apollo') }),
      row('lead-3', { work_email: unknown, industry: unknown }),
    ],
  }

  it('merges known cells with their provenance', () => {
    const plan = buildMergePlan(results, { now: NOW })

    expect(plan.byLead['lead-1']!.work_email).toEqual({
      value: { email: 'sam@acme.com' },
      provider: 'prospeo',
      sourceUrl: null,
      runId: RUN_ID,
      mergedAt: NOW.toISOString(),
    })
  })

  it('NEVER writes an unknown cell', () => {
    /*
     * An unknown means we looked and could not find out. Written as an empty
     * column it becomes "they do not have one" the moment it reaches a CRM,
     * and nothing downstream can tell the two apart.
     */
    const plan = buildMergePlan(results, { now: NOW })

    expect(plan.byLead['lead-2']).not.toHaveProperty('work_email')
    expect(plan.byLead['lead-2']).toHaveProperty('industry')
  })

  it('leaves a lead untouched when every cell is unknown', () => {
    // Not an empty object, which would read as "enriched".
    const plan = buildMergePlan(results, { now: NOW })
    expect(plan.byLead).not.toHaveProperty('lead-3')
    expect(plan.leadIds).toEqual(['lead-1', 'lead-2'])
  })

  it('counts what it merged and what it could not', () => {
    const plan = buildMergePlan(results, { now: NOW })
    expect(plan.mergedCells).toBe(3)
    expect(plan.unknownCells).toBe(3)
  })

  it('merges only the fields asked for', () => {
    // Merging the email column should not drag in firmographics the user was
    // only browsing.
    const plan = buildMergePlan(results, { fields: ['work_email'], now: NOW })

    expect(plan.byLead['lead-1']).toEqual({ work_email: expect.anything() })
    expect(plan.fields).toEqual(['work_email'])
  })

  it('merges only the leads asked for', () => {
    const plan = buildMergePlan(results, { leadIds: ['lead-1'], now: NOW })
    expect(plan.leadIds).toEqual(['lead-1'])
  })

  it('reports no fields when nothing was known', () => {
    const empty = buildMergePlan(
      { runId: RUN_ID, columns: ['work_email'] as ResearchField[], rows: [row('lead-3', { work_email: unknown })] },
      { now: NOW },
    )

    expect(empty).toMatchObject({ leadIds: [], mergedCells: 0, fields: [] })
  })
})

describe('flattenEnrichmentValue — never [object Object]', () => {
  it('unwraps a single meaningful key', () => {
    // `{ email: "…" }` under a column headed "Work Email" is the address.
    expect(flattenEnrichmentValue({ email: 'sam@acme.com' })).toBe('sam@acme.com')
    expect(flattenEnrichmentValue({ count: 34 })).toBe('34')
  })

  it('passes scalars through', () => {
    expect(flattenEnrichmentValue('Software')).toBe('Software')
    expect(flattenEnrichmentValue(42)).toBe('42')
    expect(flattenEnrichmentValue(true)).toBe('true')
  })

  it('ignores metadata keys that qualify a value rather than being one', () => {
    expect(flattenEnrichmentValue({ count: 34, isEstimate: true })).toBe('34')
    expect(flattenEnrichmentValue({ amount: 12_000_000, currency: 'USD', isTotalFunding: true })).toBe(
      '12000000',
    )
  })

  it('labels the parts when several remain', () => {
    expect(flattenEnrichmentValue({ min: 100, max: 250 })).toBe('min: 100 | max: 250')
  })

  it('joins a list', () => {
    expect(flattenEnrichmentValue(['a', 'b'])).toBe('a; b')
    expect(flattenEnrichmentValue({ detected: [{ id: 'hubspot' }, { id: 'zendesk' }] })).toBe(
      'hubspot; zendesk',
    )
  })

  it('returns null rather than an empty or meaningless cell', () => {
    for (const value of [null, undefined, '', '   ', {}, [], { basedOn: ['x'] }]) {
      expect(flattenEnrichmentValue(value), JSON.stringify(value)).toBeNull()
    }
  })
})

describe('enrichmentColumnHeader', () => {
  it('turns a field key into a column name', () => {
    expect(enrichmentColumnHeader('work_email')).toBe('Work Email')
    expect(enrichmentColumnHeader('employee_count')).toBe('Employee Count')
  })

  it('keeps short words as acronyms', () => {
    expect(enrichmentColumnHeader('sec_cik')).toBe('SEC CIK')
  })
})

describe('enrichmentCells and enrichmentColumns', () => {
  const lead = {
    enrichment: {
      work_email: { value: { email: 'sam@acme.com' }, provider: 'prospeo' },
      industry: { value: { industry: 'Software' }, provider: 'apollo' },
    },
  }

  it('flattens stored enrichment into export cells', () => {
    expect(enrichmentCells(lead.enrichment)).toEqual({
      'Work Email': 'sam@acme.com',
      Industry: 'Software',
    })
  })

  it('tolerates anything already in the column', () => {
    // Written by an older build, or hand-edited. Skipped, never thrown on.
    for (const value of [null, undefined, 'nonsense', 42, [], { field: 'no value key' }]) {
      expect(() => enrichmentCells(value)).not.toThrow()
    }
    expect(enrichmentCells({ x: { value: null } })).toEqual({})
  })

  it('returns columns in a STABLE order across leads', () => {
    /*
     * First-seen order would reorder the CSV between two exports of the same
     * data, breaking whatever the customer built on top of it.
     */
    const a = enrichmentColumns([lead, { enrichment: { company_age: { value: { years: 5 } } } }])
    const b = enrichmentColumns([{ enrichment: { company_age: { value: { years: 5 } } } }, lead])

    expect(a).toEqual(b)
    expect(a).toEqual(['Company Age', 'Industry', 'Work Email'])
  })

  it('is empty for leads nobody enriched', () => {
    expect(enrichmentColumns([{ enrichment: {} }, {}])).toEqual([])
  })
})
