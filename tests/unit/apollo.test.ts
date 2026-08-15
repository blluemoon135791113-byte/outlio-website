/**
 * The Apollo adapter.
 *
 * The placeholder guard is the important part. Apollo hands back
 * `email_not_unlocked@domain.com` for an address it knows but will not release
 * on the current plan. Stored naively, that becomes a deliverable-looking
 * address on a lead — and the first anyone hears of it is a bounce.
 */
import { describe, expect, it } from 'vitest'

import { apolloEvidence, usableEmail, type ApolloOutput } from '@/lib/intelligence/providers/apollo'
import { ALL_PROVIDERS, DEFAULT_PROVIDER_ORDER } from '@/lib/intelligence/providers'
import type { PersonEntity } from '@/lib/intelligence/types'

const PERSON: PersonEntity = {
  type: 'person',
  id: '10000000-0000-4000-8000-000000000001',
  fullName: 'Fabricated Person',
  linkedinUrl: null,
  jobTitle: 'Founder',
  companyName: 'Fabricated Systems',
  companyDomain: null,
  companyId: '00000000-0000-4000-8000-000000000001',
}

function output(response: ApolloOutput['response']): ApolloOutput {
  return { response }
}

describe('usableEmail — a locked address is not an address', () => {
  it('accepts a real address', () => {
    expect(usableEmail('sam@acme.com')).toBe('sam@acme.com')
    expect(usableEmail('  Sam@Acme.com ')).toBe('sam@acme.com')
  })

  it('REJECTS every locked placeholder shape', () => {
    for (const placeholder of [
      'email_not_unlocked@domain.com',
      'email_not_unlocked@acme.com',
      'not_unlocked@acme.com',
      'email_hidden@acme.com',
      'locked@acme.com',
    ]) {
      expect(usableEmail(placeholder), placeholder).toBeNull()
    }
  })

  it('rejects a masked address', () => {
    expect(usableEmail('sam.****@acme.com')).toBeNull()
  })

  it('rejects anything that is not an address', () => {
    for (const value of [null, undefined, '', '   ', 'not-an-email']) {
      expect(usableEmail(value as string | null), JSON.stringify(value)).toBeNull()
    }
  })
})

describe('apolloEvidence', () => {
  it('stores a real address with its status', () => {
    const evidence = apolloEvidence(
      output({ person: { name: 'Fabricated Person', email: 'sam@acme.com', email_status: 'verified' } }),
      PERSON,
    )

    expect(evidence.find((item) => item.field === 'work_email')?.value).toEqual({
      email: 'sam@acme.com',
    })
    expect(evidence.find((item) => item.field === 'email_status')?.value).toMatchObject({
      status: 'VERIFIED',
    })
  })

  it('stores NOTHING when the address is locked', () => {
    const evidence = apolloEvidence(
      output({
        person: { name: 'Fabricated Person', email: 'email_not_unlocked@acme.com', email_status: 'verified' },
      }),
      PERSON,
    )

    // Not the status either — a status without a value claims we hold a
    // contact detail we do not.
    expect(evidence.filter((item) => item.field.startsWith('email'))).toHaveLength(0)
    expect(evidence.filter((item) => item.field === 'work_email')).toHaveLength(0)
  })

  it('returns nothing for a miss', () => {
    expect(apolloEvidence(output({}), PERSON)).toEqual([])
  })

  it('files organization facts against the company', () => {
    const evidence = apolloEvidence(
      output({
        person: {
          name: 'Fabricated Person',
          email: 'sam@acme.com',
          organization: {
            primary_domain: 'acme.com',
            industry: 'software',
            estimated_num_employees: 34,
            country: 'United States',
            city: 'San Francisco',
            technology_names: ['HubSpot', 'Salesforce'],
            total_funding: 12_000_000,
            latest_funding_stage: 'Series A',
            latest_funding_round_date: '2026-03-01',
          },
        },
      }),
      PERSON,
    )

    const companyFacts = evidence.filter((item) => item.entityType === 'company')
    expect(companyFacts.length).toBeGreaterThan(0)
    expect(companyFacts.every((item) => item.entityId === PERSON.companyId)).toBe(true)
    expect(evidence.find((item) => item.field === 'company_domain')?.value).toMatchObject({
      domain: 'acme.com',
    })
  })

  it('labels headcount as an ESTIMATE', () => {
    // A range filter applied to an estimate as though it were a filing is how
    // a company gets excluded on a number nobody stands behind.
    const evidence = apolloEvidence(
      output({ person: { organization: { estimated_num_employees: 34 } } }),
      PERSON,
    )

    expect(evidence.find((item) => item.field === 'employee_count')?.value).toMatchObject({
      count: 34,
      isEstimate: true,
    })
  })

  it('labels funding as TOTAL raised, not the latest round', () => {
    // "raised more than $5M" means something different against each, and
    // conflating them would qualify companies that never had a $5M round.
    const evidence = apolloEvidence(
      output({ person: { organization: { total_funding: 12_000_000 } } }),
      PERSON,
    )

    expect(evidence.find((item) => item.field === 'funding_amount')?.value).toMatchObject({
      amount: 12_000_000,
      isTotalFunding: true,
    })
  })

  it('does not report an unknown funding stage as a round', () => {
    const evidence = apolloEvidence(
      output({ person: { organization: { latest_funding_stage: 'Unknown' } } }),
      PERSON,
    )

    expect(evidence.find((item) => item.field === 'funding_round')).toBeUndefined()
  })

  it('drops the windfall when there is no company to file it against', () => {
    const evidence = apolloEvidence(
      output({
        person: { email: 'sam@acme.com', organization: { industry: 'software' } },
      }),
      { ...PERSON, companyId: null },
    )

    expect(evidence.every((item) => item.entityType === 'person')).toBe(true)
  })

  it('never rates aggregated company facts above MEDIUM', () => {
    const evidence = apolloEvidence(
      output({
        person: {
          organization: { industry: 'software', total_funding: 1_000_000, technology_names: ['HubSpot'] },
        },
      }),
      PERSON,
    )

    for (const item of evidence) {
      if (['industry', 'funding_amount', 'tech_stack'].includes(item.field)) {
        expect(item.sourceConfidence, item.field).toBe('medium')
      }
    }
  })
})

describe('the email waterfall', () => {
  it('has two providers, in a configurable order', () => {
    expect(DEFAULT_PROVIDER_ORDER.contact_email).toEqual(['prospeo-email', 'apollo-email'])
  })

  it('offers no Apollo phone provider', () => {
    // Apollo delivers phone numbers to a webhook this product does not have.
    // A provider that appeared to support phone and silently never delivered
    // one would be worse than its absence.
    const apolloProviders = ALL_PROVIDERS.filter((provider) => provider.name.startsWith('apollo'))
    expect(apolloProviders.map((provider) => provider.category)).toEqual(['contact_email'])
  })

  it('keeps phone on the provider that answers synchronously', () => {
    expect(DEFAULT_PROVIDER_ORDER.contact_phone).toEqual(['prospeo-phone'])
  })
})
