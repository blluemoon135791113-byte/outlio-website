import { describe, expect, it } from 'vitest'

import type { ResearchPlan } from '@/lib/intelligence/plan'
import { shapeRowsForPlan } from '@/lib/intelligence/result-match'

const plan = (filters: Record<string, unknown>): ResearchPlan => ({
  entityScope: 'companies',
  requiredFields: ['funding_round', 'funding_date', 'funding_investors'],
  outputFields: [],
  filters,
  clarificationRequired: false,
  clarificationQuestions: [],
})

function row(
  leadId: string,
  companyId: string,
  fields: Record<string, { state: 'known'; value: unknown } | { state: 'unknown' }>,
) {
  return { leadId, companyId, fields }
}

describe('shapeRowsForPlan', () => {
  it('returns only companies satisfying explicit funding criteria', () => {
    const rows = [
      row('lead-1', 'company-1', {
        funding_round: { state: 'known', value: { round: 'Series A' } },
        funding_date: { state: 'known', value: { announcedAt: '2026-08-20T00:00:00.000Z' } },
        funding_investors: { state: 'known', value: { investors: ['A', 'B'] } },
      }),
      row('lead-2', 'company-2', {
        funding_round: { state: 'known', value: { round: 'Series B' } },
        funding_date: { state: 'known', value: { announcedAt: '2026-08-20T00:00:00.000Z' } },
        funding_investors: { state: 'known', value: { investors: ['A'] } },
      }),
    ]

    expect(
      shapeRowsForPlan(
        rows,
        plan({
          funding_round: 'Series A',
          funded_after: '2026-08-17',
          minimum_investor_count: 2,
        }),
      ).map((item) => item.companyId),
    ).toEqual(['company-1'])
  })

  it('does not treat unknown evidence as a match', () => {
    const rows = [row('lead-1', 'company-1', { funding_round: { state: 'unknown' } })]
    expect(shapeRowsForPlan(rows, plan({ funding_round: 'Series A' }))).toEqual([])
  })

  it('deduplicates several people at the same company', () => {
    const rows = [
      row('lead-1', 'company-1', {}),
      row('lead-2', 'company-1', {}),
      row('lead-3', 'company-2', {}),
    ]
    expect(shapeRowsForPlan(rows, plan({})).map((item) => item.companyId)).toEqual([
      'company-1',
      'company-2',
    ])
  })

  it('keeps only SaaS companies with sourced SDR hiring signals', () => {
    const matching = row('lead-1', 'company-1', {
      business_model: { state: 'known', value: { model: 'B2B + SaaS', models: ['B2B', 'SaaS'] } },
      hiring_signals: { state: 'known', value: { hiring: true, roles: ['sdr'] } },
    })
    const wrongRole = row('lead-2', 'company-2', {
      business_model: { state: 'known', value: { model: 'SaaS', models: ['SaaS'] } },
      hiring_signals: { state: 'known', value: { hiring: true, roles: ['account executive'] } },
    })

    const researchPlan: ResearchPlan = {
      ...plan({ business_model: 'SaaS', hiring_roles: ['sdr'] }),
      requiredFields: ['business_model', 'hiring_signals'],
    }

    expect(shapeRowsForPlan([matching, wrongRole], researchPlan)).toEqual([matching])
  })
})
