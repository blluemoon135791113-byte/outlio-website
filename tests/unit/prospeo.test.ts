/**
 * The Prospeo adapter.
 *
 * The first block is the one that matters. Prospeo returns unrevealed contact
 * details MASKED rather than absent — `eoghan.*****@intercom.com`,
 * `+1 415-3**-****` — and storing one of those as a real address or number
 * would be fabricating lead data that looks exactly like a successful
 * enrichment. Nobody would notice until someone tried to send to it.
 */
import { describe, expect, it } from 'vitest'

import { prospeoEvidence, revealedValue, type ProspeoOutput } from '@/lib/intelligence/providers/prospeo'
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

function output(response: ProspeoOutput['response'], requestedMobile = false): ProspeoOutput {
  return { response, requestedMobile }
}

describe('revealedValue — masked is not a value', () => {
  it('accepts a revealed, unmasked email', () => {
    expect(revealedValue({ revealed: true, email: 'sam@acme.com' }, 'email')).toBe('sam@acme.com')
  })

  it('REJECTS a masked email even when revealed says true', () => {
    // Both checks are required: `revealed` is the contract, the mask is the
    // observable proof. A provider change must not slip one past the other.
    expect(revealedValue({ revealed: true, email: 'sam.****@acme.com' }, 'email')).toBeNull()
  })

  it('rejects an unrevealed value', () => {
    expect(revealedValue({ revealed: false, email: 'sam@acme.com' }, 'email')).toBeNull()
    expect(revealedValue({ email: 'sam@acme.com' }, 'email')).toBeNull()
  })

  it('rejects the masked phone shape Prospeo documents', () => {
    expect(
      revealedValue({ revealed: false, mobile_international: '+1 415-3**-****' }, 'mobile'),
    ).toBeNull()
  })

  it('prefers the international phone form', () => {
    expect(
      revealedValue(
        { revealed: true, mobile: '(415) 673-3820', mobile_international: '+14156733820' },
        'mobile',
      ),
    ).toBe('+14156733820')
  })

  it('handles missing and empty values without throwing', () => {
    expect(revealedValue(undefined, 'email')).toBeNull()
    expect(revealedValue({ revealed: true }, 'email')).toBeNull()
    expect(revealedValue({ revealed: true, email: '   ' }, 'email')).toBeNull()
  })
})

describe('prospeoEvidence — contact fields', () => {
  it('stores a revealed email with its verification status', () => {
    const evidence = prospeoEvidence(
      output({
        person: {
          email: {
            revealed: true,
            email: 'sam@acme.com',
            status: 'VERIFIED',
            verification_method: 'BOUNCEBAN',
          },
        },
      }),
      PERSON,
    )

    const email = evidence.find((item) => item.field === 'work_email')
    expect(email?.value).toEqual({ email: 'sam@acme.com' })
    expect(email?.entityType).toBe('person')
    expect(email?.entityId).toBe(PERSON.id)

    expect(evidence.find((item) => item.field === 'email_status')?.value).toMatchObject({
      status: 'VERIFIED',
    })
  })

  it('stores NOTHING when the email is masked', () => {
    const evidence = prospeoEvidence(
      output({
        person: { email: { revealed: false, email: 'sam.****@acme.com', status: 'VERIFIED' } },
      }),
      PERSON,
    )

    // Not even the status: a status without a value is a claim about a contact
    // detail we do not have.
    expect(evidence.filter((item) => item.field.startsWith('email'))).toHaveLength(0)
    expect(evidence.filter((item) => item.field === 'work_email')).toHaveLength(0)
  })

  it('stores nothing at all for a NO_MATCH response', () => {
    expect(prospeoEvidence(output({ error: true, error_code: 'NO_MATCH' }), PERSON)).toEqual([])
  })
})

describe('prospeoEvidence — the company windfall', () => {
  const FULL = output({
    person: { email: { revealed: true, email: 'sam@acme.com', status: 'VERIFIED' } },
    company: {
      name: 'Fabricated Systems',
      website: 'https://acme.com',
      domain: 'acme.com',
      industry: 'Software Development',
      employee_count: 1822,
      description: 'Fabricated description.',
      location: { country: 'United States', state: 'California', city: 'San Francisco' },
      revenue_range: { min: 100_000_000, max: 250_000_000 },
      funding: {
        latest_funding_stage: 'Series unknown',
        funding_events: [
          { amount: null, raised_at: '2021-01-01T00:00:00', stage: 'Series unknown' },
          {
            amount: 125_000_000,
            raised_at: '2018-04-27T00:00:00',
            stage: 'Series D',
            link: 'https://example.com/round',
          },
        ],
      },
      technology: {
        technology_list: [
          { name: 'HubSpot', category: 'Marketing automation' },
          { name: 'Intercom', category: 'Support' },
        ],
      },
      job_postings: {
        active_count: 3,
        active_titles: ['account executive, senior midmarket', 'senior product engineer'],
      },
    },
  })

  it('files company facts against the COMPANY, not the person', () => {
    const evidence = prospeoEvidence(FULL, PERSON)
    const companyFacts = evidence.filter((item) => item.entityType === 'company')

    expect(companyFacts.length).toBeGreaterThan(0)
    expect(companyFacts.every((item) => item.entityId === PERSON.companyId)).toBe(true)
  })

  it('extracts the domain, which the captured data never had', () => {
    const domain = prospeoEvidence(FULL, PERSON).find((item) => item.field === 'company_domain')
    expect(domain?.value).toMatchObject({ domain: 'acme.com' })
  })

  it('picks the latest funding event that actually has an amount', () => {
    const evidence = prospeoEvidence(FULL, PERSON)

    // The 2021 event is more recent but has no amount; "Series unknown" is not
    // a round, so it must not be reported as one.
    expect(evidence.find((item) => item.field === 'funding_amount')?.value).toMatchObject({
      amount: 125_000_000,
    })
    expect(evidence.find((item) => item.field === 'funding_round')?.value).toMatchObject({
      round: 'Series D',
    })
  })

  it('never rates aggregated company facts above MEDIUM', () => {
    for (const item of prospeoEvidence(FULL, PERSON)) {
      if (['funding_amount', 'funding_round', 'tech_stack', 'industry'].includes(item.field)) {
        expect(item.sourceConfidence, item.field).toBe('medium')
      }
    }
  })

  it('returns a technology list a CMS scanner could not see', () => {
    const tech = prospeoEvidence(FULL, PERSON).find((item) => item.field === 'tech_stack')
    const detected = (tech?.value as { detected: Array<{ name: string }> }).detected

    expect(detected.map((item) => item.name)).toEqual(['HubSpot', 'Intercom'])
    expect(tech?.value).toMatchObject({ coverage: 'vendor_detected' })
  })

  it('flags sales hiring from the open roles', () => {
    const hiring = prospeoEvidence(FULL, PERSON).find((item) => item.field === 'hiring_signals')
    expect(hiring?.value).toMatchObject({ hiring: true, openRoles: 3, salesHiring: true })
  })

  it('drops the windfall when the person has no company to file it against', () => {
    const orphan = { ...PERSON, companyId: null }
    const evidence = prospeoEvidence(FULL, orphan)

    // The email still lands; nothing is invented a home for.
    expect(evidence.every((item) => item.entityType === 'person')).toBe(true)
  })

  it('omits fields the response did not contain', () => {
    const sparse = output({
      person: { email: { revealed: true, email: 'sam@acme.com', status: 'VERIFIED' } },
      company: { name: 'Fabricated Systems' },
    })

    const fields = prospeoEvidence(sparse, PERSON).map((item) => item.field)
    expect(fields).not.toContain('employee_count')
    expect(fields).not.toContain('funding_amount')
    expect(fields).not.toContain('tech_stack')
  })

  it('does not report an unknown funding stage as a round', () => {
    const unknownStage = output({
      company: {
        funding: {
          funding_events: [
            { amount: 5_000_000, raised_at: '2026-01-01T00:00:00', stage: 'Series unknown' },
          ],
        },
      },
    })

    const evidence = prospeoEvidence(unknownStage, PERSON)
    expect(evidence.find((item) => item.field === 'funding_round')).toBeUndefined()
    // The amount is still real and worth keeping.
    expect(evidence.find((item) => item.field === 'funding_amount')).toBeDefined()
  })
})
