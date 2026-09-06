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
import type { PersonEntity, ResearchField, ResearchTask } from '@/lib/intelligence/types'

const PERSON: PersonEntity = {
  type: 'person',
  id: '10000000-0000-4000-8000-000000000001',
  fullName: 'Fabricated Person',
  linkedinUrl: null,
  location: null,
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

describe('apolloEvidence — the fields that used to be thrown away', () => {
  it('keeps seniority and department', () => {
    const evidence = apolloEvidence(
      output({ person: { email: 'sam@acme.com', seniority: 'founder', departments: ['engineering'] } }),
      PERSON,
    )

    expect(evidence.find((item) => item.field === 'person_seniority')?.value).toEqual({
      value: 'founder',
    })
    expect(evidence.find((item) => item.field === 'person_department')?.value).toEqual({
      value: ['engineering'],
    })
  })

  it('ignores blank seniority and empty departments', () => {
    const evidence = apolloEvidence(
      output({ person: { email: 'sam@acme.com', seniority: '   ', departments: [] } }),
      PERSON,
    )

    expect(evidence.find((item) => item.field === 'person_seniority')).toBeUndefined()
    expect(evidence.find((item) => item.field === 'person_department')).toBeUndefined()
  })

  it("keeps the INDIVIDUAL's own profiles, against the person", () => {
    const evidence = apolloEvidence(
      output({
        person: {
          twitter_url: 'https://x.com/fabricated',
          github_url: 'https://github.com/fabricated',
          linkedin_url: 'https://linkedin.com/in/fabricated',
          organization: { twitter_url: 'https://x.com/acme' },
        },
      }),
      PERSON,
    )

    const personal = evidence.find((item) => item.field === 'person_social_profiles')
    expect(personal?.entityType).toBe('person')
    expect(personal?.entityId).toBe(PERSON.id)
    expect(personal?.value).toEqual({
      twitter: 'https://x.com/fabricated',
      github: 'https://github.com/fabricated',
      linkedin: 'https://linkedin.com/in/fabricated',
    })
  })

  it('NEVER mixes the company account into the personal one', () => {
    /*
     * Handing back Acme's corporate X account in a column labelled as someone's
     * personal profile is a wrong answer that looks right — worse than no
     * answer. The two fields stay on two different entities.
     */
    const evidence = apolloEvidence(
      output({
        person: {
          twitter_url: 'https://x.com/fabricated',
          organization: { twitter_url: 'https://x.com/acme' },
        },
      }),
      PERSON,
    )

    expect(evidence.find((item) => item.field === 'person_social_profiles')?.value).toEqual({
      twitter: 'https://x.com/fabricated',
    })
    expect(evidence.find((item) => item.field === 'social_profiles')).toMatchObject({
      entityType: 'company',
      entityId: PERSON.companyId,
      value: { twitter: 'https://x.com/acme' },
    })
  })

  it('reports no personal socials rather than an empty object', () => {
    // `{}` stored as evidence would read as "we looked and they have none",
    // which is a stronger claim than "the response did not carry any".
    const evidence = apolloEvidence(output({ person: { twitter_url: '   ' } }), PERSON)
    expect(evidence.find((item) => item.field === 'person_social_profiles')).toBeUndefined()
  })

  it('keeps social profiles, which arrive free on a paid response', () => {
    const evidence = apolloEvidence(
      output({
        person: {
          organization: {
            twitter_url: 'https://x.com/acme',
            linkedin_url: 'https://linkedin.com/company/acme',
            facebook_url: '   ',
          },
        },
      }),
      PERSON,
    )

    expect(evidence.find((item) => item.field === 'social_profiles')?.value).toEqual({
      twitter: 'https://x.com/acme',
      linkedin: 'https://linkedin.com/company/acme',
    })
  })

  it('records annual revenue as an estimate, at LOW confidence', () => {
    const revenue = apolloEvidence(
      output({ person: { organization: { annual_revenue: 4_000_000 } } }),
      PERSON,
    ).find((item) => item.field === 'revenue_estimate')

    expect(revenue?.value).toMatchObject({ min: 4_000_000, max: 4_000_000, isEstimate: true })
    // A modelled figure is not a filing.
    expect(revenue?.sourceConfidence).toBe('low')
  })

  it('marks a founding YEAR as year-precision, not a date', () => {
    // Apollo reports a year; a registry reports a day. Storing "2011" as
    // 1 January 2011 would age a December company by an extra year.
    const founded = apolloEvidence(
      output({ person: { organization: { founded_year: 2011 } } }),
      PERSON,
    ).find((item) => item.field === 'incorporation_date')

    expect(founded?.value).toMatchObject({ year: 2011, precision: 'year', isFoundingYear: true })
    expect(founded?.sourceConfidence).toBe('low')
  })

  it('refuses an impossible founding year', () => {
    for (const year of [1600, 3000]) {
      const evidence = apolloEvidence(output({ person: { organization: { founded_year: year } } }), PERSON)
      expect(evidence.find((item) => item.field === 'incorporation_date'), String(year)).toBeUndefined()
    }
  })

  it('keeps the company keyword list as specialties', () => {
    const evidence = apolloEvidence(
      output({ person: { organization: { keywords: ['lead generation', ' ', 'sales enablement'] } } }),
      PERSON,
    )

    expect(evidence.find((item) => item.field === 'specialties')?.value).toEqual({
      value: ['lead generation', 'sales enablement'],
    })
    // Aggregated third-party tags, not the registry speaking.
    expect(evidence.find((item) => item.field === 'specialties')?.sourceConfidence).toBe('medium')
  })

  it('reports no specialties when the response carries no keywords', () => {
    const evidence = apolloEvidence(
      output({ person: { organization: { keywords: [] } } }),
      PERSON,
    )
    expect(evidence.find((item) => item.field === 'specialties')).toBeUndefined()
  })

  it('names the investors of the NEWEST dated round', () => {
    /*
     * The event array's order is not documented as sorted, so the newest
     * `date` must win regardless of position in the list.
     */
    const evidence = apolloEvidence(
      output({
        person: {
          organization: {
            funding_events: [
              { date: '2022-03-01', investors: 'Sequoia Capital, Tribe Capital' },
              { date: '2023-08-01', investors: 'Bain Capital Ventures, Sequoia Capital' },
              { date: null, investors: 'Undated, ignored' },
            ],
          },
        },
      }),
      PERSON,
    )

    expect(evidence.find((item) => item.field === 'funding_investors')?.value).toEqual({
      investors: ['Bain Capital Ventures', 'Sequoia Capital'],
    })
  })

  it('ignores malformed and unknown investor events', () => {
    const evidence = apolloEvidence(
      output({
        person: {
          organization: {
            funding_events: [
              { date: '2023-08-01', investors: 'Unknown' },
              { date: 'not-a-date', investors: 'Malformed, ignored' },
            ],
          },
        },
      }),
      PERSON,
    )

    expect(evidence.find((item) => item.field === 'funding_investors')).toBeUndefined()
  })

  it('keeps the company blog alongside the social accounts', () => {
    const evidence = apolloEvidence(
      output({
        person: {
          organization: {
            blog_url: 'https://acme.com/blog',
            twitter_url: 'https://x.com/acme',
          },
        },
      }),
      PERSON,
    )

    expect(evidence.find((item) => item.field === 'social_profiles')?.value).toMatchObject({
      blog: 'https://acme.com/blog',
      twitter: 'https://x.com/acme',
    })
  })
})

describe('the contact waterfall pays only providers that could answer', () => {
  /*
   * ⚠️ THE WATERFALL IS PER-FIELD, AND EVERY ATTEMPT IS BILLED.
   *
   * `executeTasks` calls each provider in turn with the fields still
   * outstanding. Apollo is the ONLY source of `person_social_profiles`, so
   * without a field-aware `canHandle`, a socials-only task would buy a Prospeo
   * enrichment that cannot possibly answer it before falling through.
   */
  const PROSPEO = ALL_PROVIDERS.find((provider) => provider.name === 'prospeo-email')!
  const APOLLO = ALL_PROVIDERS.find((provider) => provider.name === 'apollo-email')!

  function task(fields: ResearchField[]): ResearchTask {
    return { id: 'contact:1', category: 'contact_email', entity: PERSON, fields }
  }

  it('does not send a socials-only task to Prospeo', () => {
    // Prospeo's person block carries email, mobile and job history — no socials.
    expect(PROSPEO.canHandle(task(['person_social_profiles']))).toBe(false)
  })

  it('does send a socials-only task to Apollo', () => {
    process.env.APOLLO_API_KEY ??= 'test-key'
    expect(APOLLO.canHandle(task(['person_social_profiles']))).toBe(true)
  })

  it('still sends an email task to Prospeo', () => {
    process.env.PROSPEO_API_KEY ??= 'test-key'
    expect(PROSPEO.canHandle(task(['work_email']))).toBe(true)
  })

  it('sends a mixed task to Prospeo, which answers the part it can', () => {
    process.env.PROSPEO_API_KEY ??= 'test-key'
    expect(PROSPEO.canHandle(task(['work_email', 'person_social_profiles']))).toBe(true)
  })
})

describe('the email waterfall', () => {
  it('has four providers, free sources first', () => {
    // The Scout pair is free and answers before anything metered is even
    // considered.
    expect(DEFAULT_PROVIDER_ORDER.contact_email).toEqual([
      'scout',
      'social-scout',
      'search-contact-email',
      'prospeo-email',
      'apollo-email',
    ])
  })

  it('offers no Apollo phone provider', () => {
    // Apollo delivers phone numbers to a webhook this product does not have.
    // A provider that appeared to support phone and silently never delivered
    // one would be worse than its absence.
    const apolloProviders = ALL_PROVIDERS.filter((provider) => provider.name.startsWith('apollo'))
    expect(apolloProviders.map((provider) => provider.category)).toEqual(['contact_email'])
  })

  it('keeps phone on the provider that answers synchronously', () => {
    expect(DEFAULT_PROVIDER_ORDER.contact_phone).toEqual(['search-contact-phone', 'prospeo-phone'])
  })
})
