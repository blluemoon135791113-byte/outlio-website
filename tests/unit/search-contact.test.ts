import { describe, expect, it } from 'vitest'

import {
  contactSearchQueries,
  contactSearchQuery,
  extractPublicEmail,
  extractPublicPhone,
  searchContactEmailProvider,
} from '@/lib/intelligence/providers/search-contact'
import type { GoogleSearchHit } from '@/lib/intelligence/providers/google-cse'
import type { PersonEntity, ResearchTask } from '@/lib/intelligence/types'

const PERSON: PersonEntity = {
  type: 'person',
  id: '00000000-0000-4000-8000-000000000001',
  fullName: 'Jamie Rivera',
  linkedinUrl: null,
  location: null,
  jobTitle: 'Founder',
  companyName: 'Fabricated Labs',
  companyDomain: 'fabricated.example',
  companyId: '00000000-0000-4000-8000-000000000002',
}

function hit(overrides: Partial<GoogleSearchHit> = {}): GoogleSearchHit {
  return {
    url: 'https://fabricated.example/team/jamie-rivera',
    title: 'Jamie Rivera — Founder at Fabricated Labs',
    snippet: 'Jamie Rivera leads Fabricated Labs. Email jamie@fabricated.example.',
    publishedDate: null,
    ...overrides,
  }
}

describe('Google public contact search', () => {
  it('generates the same exact person + domain query used in a manual search', () => {
    expect(contactSearchQuery(PERSON, 'email')).toBe('Jamie Rivera fabricated.example email')
    expect(contactSearchQuery(PERSON, 'phone')).toBe('Jamie Rivera fabricated.example phone WhatsApp')
    expect(contactSearchQueries(PERSON, 'email')).toEqual([
      'Jamie Rivera fabricated.example email',
      'site:fabricated.example "Jamie Rivera" email',
      '"Jamie Rivera" "Fabricated Labs" contact email',
      '"Jamie Rivera" "Fabricated Labs" filetype:pdf email',
    ])
  })

  it('extracts a person-shaped public work email with provenance', () => {
    expect(extractPublicEmail(PERSON, [hit()])).toMatchObject({
      value: 'jamie@fabricated.example',
      sourceUrl: 'https://fabricated.example/team/jamie-rivera',
      sourceConfidence: 'high',
      supportingSources: [expect.objectContaining({ url: 'https://fabricated.example/team/jamie-rivera' })],
    })
  })

  it('boosts confidence when independent public sources corroborate a contact', () => {
    const finding = extractPublicEmail(PERSON, [
      hit(),
      hit({
        url: 'https://publication.example/interviews/jamie-rivera',
        snippet: 'Jamie Rivera of Fabricated Labs can be reached at jamie@fabricated.example.',
      }),
    ])
    expect(finding?.supportingSources).toHaveLength(2)
    expect(finding?.confidence).toBeGreaterThan(0.82)
  })

  it('rejects generic mailboxes, different employers, and other people', () => {
    expect(extractPublicEmail(PERSON, [hit({
      snippet: 'Jamie Rivera leads Fabricated Labs. Email support@fabricated.example.',
    })])).toBeNull()
    expect(extractPublicEmail(PERSON, [hit({
      snippet: 'Jamie Rivera leads Fabricated Labs. Email jamie@another.example.',
    })])).toBeNull()
    expect(extractPublicEmail(PERSON, [hit({
      title: 'Pat Lee — Fabricated Labs',
      snippet: 'Pat Lee works at Fabricated Labs. Email pat@fabricated.example.',
    })])).toBeNull()
  })

  it('extracts a public business phone only when the snippet names the identity', () => {
    expect(extractPublicPhone(PERSON, [hit({
      snippet: 'Jamie Rivera leads Fabricated Labs. WhatsApp +44 20 7946 0958.',
    })])).toMatchObject({ value: '+442079460958' })
    expect(extractPublicPhone(PERSON, [hit({
      title: 'Fabricated Labs contact',
      snippet: 'Call Fabricated Labs on +44 20 7946 0958.',
    })])).toBeNull()
  })

  it('rejects malformed international numbers rather than storing phone-shaped text', () => {
    expect(extractPublicPhone(PERSON, [hit({
      snippet: 'Jamie Rivera leads Fabricated Labs. WhatsApp +44 00 0000 0000.',
    })])).toBeNull()
  })

  it('stores search contacts as publicly found, never verified', () => {
    const task: ResearchTask = {
      id: 'contact_email:person:test',
      category: 'contact_email',
      entity: PERSON,
      fields: ['work_email', 'email_status'],
    }
    const evidence = searchContactEmailProvider.normalize(extractPublicEmail(PERSON, [hit()]), task)
    expect(evidence.find((item) => item.field === 'email_status')?.value).toMatchObject({
      status: 'publicly_found',
    })
    expect(evidence.some((item) => item.value.status === 'verified')).toBe(false)
  })
})
