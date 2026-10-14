/**
 * Company contacts after a domain is discovered mid-run.
 *
 * Pinned: only companies that STARTED without a domain and gained one from
 * this run's evidence are re-asked; a company that already had a domain was
 * asked in the first pass; evidence about people or other fields never counts.
 */
import { describe, expect, it, vi } from 'vitest'

import type { CompanyEntity, NormalizedEvidence } from '@/lib/intelligence/types'

vi.mock('server-only', () => ({}))

const company = (id: string, domain: string | null): CompanyEntity => ({
  type: 'company',
  id: `00000000-0000-4000-8000-00000000000${id}`,
  name: `Fabricated ${id}`,
  domain,
  linkedinUrl: null,
})

const evidence = (entityId: string, field: NormalizedEvidence['field'], entityType: 'company' | 'person' = 'company') =>
  ({ entityId, entityType, field, value: {}, sourceProvider: 't', sourceUrl: 'https://x.example', sourceConfidence: 'medium', confidence: 0.7, retrievedAt: '', expiresAt: null }) as NormalizedEvidence

describe('companiesThatGainedADomain', () => {
  it('re-asks only companies that started domain-less and gained one', async () => {
    const { companiesThatGainedADomain } = await import('@/lib/intelligence/run')
    const a = company('1', null)
    const b = company('2', 'had.example')
    const c = company('3', null)
    const d = company('4', null)

    const result = companiesThatGainedADomain([a, b, c, d], [
      evidence(a.id, 'company_domain'),
      evidence(b.id, 'company_domain'), // already had one: asked in pass one
      evidence(c.id, 'industry'), // not a domain
      evidence(d.id, 'company_domain', 'person'), // not about a company
    ])

    expect(result.map((entity) => entity.id)).toEqual([a.id])
  })

  it('is empty when nothing was discovered', async () => {
    const { companiesThatGainedADomain } = await import('@/lib/intelligence/run')
    expect(companiesThatGainedADomain([company('1', null)], [])).toEqual([])
  })
})
