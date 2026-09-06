/**
 * Company identity resolution and grouping.
 *
 * This is the cost control (spec §9) and the correctness boundary (spec §10) in
 * one place: group aggressively enough that one company is researched once, but
 * never so aggressively that two companies become one.
 */
import { describe, expect, it } from 'vitest'

import {
  groupLeadsByCompany,
  resolveCompanyIdentity,
  type CompanyIdentityInput,
} from '@/lib/companies/normalize'

function lead(over: Partial<CompanyIdentityInput> = {}): CompanyIdentityInput {
  return {
    companyName: null,
    companyWebsiteUrl: null,
    companyLinkedInUrl: null,
    ...over,
  }
}

describe('resolveCompanyIdentity — precedence', () => {
  it('prefers the domain when the row has one', () => {
    const identity = resolveCompanyIdentity(
      lead({
        companyName: 'Acme Inc',
        companyWebsiteUrl: 'https://acme.com',
        companyLinkedInUrl: 'https://www.linkedin.com/company/acme',
      }),
    )

    expect(identity?.strategy).toBe('domain')
    expect(identity?.key).toBe('domain:acme.com')
    // The weaker identifiers are still carried, so the company row converges.
    expect(identity?.normalizedLinkedInUrl).toBe('linkedin.com/company/acme')
    expect(identity?.normalizedName).toBe('acme')
  })

  it('falls back to the LinkedIn page when there is no website', () => {
    const identity = resolveCompanyIdentity(
      lead({
        companyName: 'Acme Inc',
        companyLinkedInUrl: 'https://www.linkedin.com/sales/company/1234',
      }),
    )

    expect(identity?.strategy).toBe('linkedin')
    expect(identity?.key).toBe('linkedin:linkedin.com/sales/company/1234')
  })

  it('falls back to the name only when nothing else identifies the company', () => {
    const identity = resolveCompanyIdentity(lead({ companyName: 'Acme Inc' }))
    expect(identity?.strategy).toBe('name')
    expect(identity?.key).toBe('name:acme')
  })

  it('returns null when the row identifies no company at all', () => {
    expect(resolveCompanyIdentity(lead())).toBeNull()
    expect(resolveCompanyIdentity(lead({ companyName: '   ' }))).toBeNull()
  })

  it('ignores an unusable website rather than treating it as identity', () => {
    // A personal mailbox host is not a company. The row falls back to its name.
    const identity = resolveCompanyIdentity(
      lead({ companyName: 'Acme', companyWebsiteUrl: 'sam@gmail.com' }),
    )
    expect(identity?.strategy).toBe('name')
    expect(identity?.normalizedDomain).toBeNull()
  })
})

describe('groupLeadsByCompany — one company, one research call', () => {
  it('collapses 500 employees of one company into a single group', () => {
    const leads = Array.from({ length: 500 }, (_, i) =>
      lead({ companyName: `Person ${i} employer`, companyWebsiteUrl: 'https://hubspot.com' }),
    )

    const { groups, unidentified } = groupLeadsByCompany(leads)

    expect(groups).toHaveLength(1)
    expect(groups[0]!.leads).toHaveLength(500)
    expect(groups[0]!.identity.normalizedDomain).toBe('hubspot.com')
    expect(unidentified).toHaveLength(0)
  })

  it('collapses spelling variants of the same website', () => {
    const { groups } = groupLeadsByCompany([
      lead({ companyWebsiteUrl: 'hubspot.com' }),
      lead({ companyWebsiteUrl: 'https://www.HubSpot.com/' }),
      lead({ companyWebsiteUrl: 'http://hubspot.com/pricing?ref=x' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]!.leads).toHaveLength(3)
  })

  it('collapses legal-form variants when the name is all there is', () => {
    const { groups } = groupLeadsByCompany([
      lead({ companyName: 'Acme Inc' }),
      lead({ companyName: 'ACME, Inc.' }),
      lead({ companyName: 'acme' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]!.leads).toHaveLength(3)
  })

  it('NEVER merges two companies that only share a name', () => {
    const { groups } = groupLeadsByCompany([
      lead({ companyName: 'Acme', companyWebsiteUrl: 'https://acme.com' }),
      lead({ companyName: 'Acme', companyWebsiteUrl: 'https://acme.co.uk' }),
    ])

    expect(groups).toHaveLength(2)
    expect(new Set(groups.map((g) => g.identity.normalizedDomain))).toEqual(
      new Set(['acme.com', 'acme.co.uk']),
    )
  })

  it('does not merge a domain-identified company with a name-only one', () => {
    // Convergence is the database function's job, not the grouper's: the
    // grouper must not assume two rows are the same company without evidence.
    const { groups } = groupLeadsByCompany([
      lead({ companyName: 'Acme', companyWebsiteUrl: 'https://acme.com' }),
      lead({ companyName: 'Acme' }),
    ])

    expect(groups).toHaveLength(2)
  })

  it('keeps leads that identify no company instead of dropping them', () => {
    const { groups, unidentified } = groupLeadsByCompany([
      lead({ companyWebsiteUrl: 'https://acme.com' }),
      lead(),
      lead({ companyName: '' }),
    ])

    expect(groups).toHaveLength(1)
    expect(unidentified).toHaveLength(2)
  })

  it('enriches a group with identifiers seen on later leads', () => {
    const { groups } = groupLeadsByCompany([
      lead({ companyWebsiteUrl: 'https://acme.com' }),
      lead({
        companyName: 'Acme Inc',
        companyWebsiteUrl: 'https://acme.com',
        companyLinkedInUrl: 'https://www.linkedin.com/company/acme',
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]!.identity.normalizedName).toBe('acme')
    expect(groups[0]!.identity.normalizedLinkedInUrl).toBe('linkedin.com/company/acme')
  })

  it('scales the way the pricing model assumes', () => {
    // 5,000 leads across 1,850 companies — the shape of a real import.
    const leads = Array.from({ length: 5000 }, (_, i) =>
      lead({ companyWebsiteUrl: `https://company-${i % 1850}.com` }),
    )

    expect(groupLeadsByCompany(leads).groups).toHaveLength(1850)
  })
})
