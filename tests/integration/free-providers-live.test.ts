/**
 * LIVE smoke for the keyless free providers — opt-in, never part of `npm test`.
 *
 *   RUN_LIVE_PROVIDERS=1 npx vitest run tests/integration/free-providers-live.test.ts
 *
 * Makes real network calls but spends NOTHING: GLEIF is open published data
 * and the domain probe fetches public homepages through the shared HTTP
 * discipline. Same philosophy as providers-live.test.ts: assert the SHAPE,
 * not the data — a registry that never heard of a company is a finding, not a
 * broken build.
 */
import { describe, expect, it } from 'vitest'

import { gleifProvider } from '@/lib/intelligence/providers/gleif'
import { domainProbeProvider } from '@/lib/intelligence/providers/domain-probe'
import type { CompanyEntity } from '@/lib/intelligence/types'

const live = process.env.RUN_LIVE_PROVIDERS === '1'
const describeIf = live ? describe : describe.skip

if (!live) {
  console.warn('[free-providers-live] SKIPPED. Set RUN_LIVE_PROVIDERS=1.')
}

function company(name: string): CompanyEntity {
  return {
    type: 'company',
    id: '00000000-0000-4000-8000-000000000001',
    name,
    domain: null,
    linkedinUrl: null,
  }
}

function leiTask(name: string) {
  return {
    id: 'company_profile:smoke',
    category: 'company_profile' as const,
    entity: company(name),
    fields: ['lei_number' as const],
  }
}

describeIf('live GLEIF', () => {
  // Regulated UK financial entities carry LEIs as a matter of course, so at
  // least one of these must register — but each legal name must match exactly
  // or the provider correctly refuses.
  const SUBJECTS = ['Barclays Bank UK PLC', 'Monzo Bank Limited', 'Wise Payments Limited']

  it('binds an LEI record for at least one exactly-named entity', async () => {
    let found = 0

    for (const name of SUBJECTS) {
      const result = await gleifProvider.execute(leiTask(name))
      console.log(`GLEIF ${name}:`, JSON.stringify(result))
      if (!result) continue

      found += 1
      expect(result.lei).toMatch(/^[A-Z0-9]{20}$/)
      expect(result.entityStatus).toBeTruthy()
      expect(result.jurisdiction).toBeTruthy()
    }

    expect(
      found,
      `none of [${SUBJECTS.join(', ')}] resolved in GLEIF — either the registry is down or identity gating broke`,
    ).toBeGreaterThan(0)
  }, 120_000)

  it('refuses a name no registry entry shares', async () => {
    const result = await gleifProvider.execute(
      leiTask('Zqxv Fabricated Holdings 999 Nonexistent'),
    )
    expect(result).toBeNull()
  }, 60_000)
})

describeIf('live domain probe', () => {
  function domainTask(name: string) {
    return {
      id: 'company_profile:smoke',
      category: 'company_profile' as const,
      entity: company(name),
      fields: ['company_domain' as const],
    }
  }

  it('verifies a real homepage against the company name', async () => {
    // Both companies run their primary site at <flatname>.com, and their
    // remaining candidates (.io / .co.uk twins) do not independently verify.
    const SUBJECTS = ['Vercel', 'Figma']
    let found = 0

    for (const name of SUBJECTS) {
      const result = await domainProbeProvider.execute(domainTask(name))
      console.log(`probe ${name}:`, JSON.stringify(result))
      if (!result) continue

      found += 1
      expect(result.domain.endsWith('.com')).toBe(true)
      expect(result.sourceUrl.startsWith('https://')).toBe(true)

      const evidence = domainProbeProvider.normalize(result, domainTask(name))
      expect(evidence[0]!.sourceConfidence).toBe('medium')
      expect(evidence[0]!.value).toMatchObject({ domain: result.domain })
    }

    expect(
      found,
      'neither Vercel nor Figma probed successfully — either both sites are unreachable or verification broke',
    ).toBeGreaterThan(0)
  }, 180_000)

  it('finds nothing for a name whose hosts do not exist', async () => {
    const result = await domainProbeProvider.execute(
      domainTask('Zqxv Fabricated Holdings 999'),
    )
    expect(result).toBeNull()
  }, 120_000)
})
