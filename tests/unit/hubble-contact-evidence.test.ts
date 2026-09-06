import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { citedContactEvidence } from '@/lib/hubble/contact-evidence'

const SUBJECT = {
  leadId: '10000000-0000-4000-8000-000000000001',
  companyId: '20000000-0000-4000-8000-000000000001',
  personName: 'Jamie Rivera',
  personLocation: null,
    personTitle: 'Founder',
  companyName: 'Fabricated Labs',
  domain: 'fabricated.example',
}

describe('Hubble cited contact persistence', () => {
  it('saves literal person contacts from cited passages with public status', () => {
    const evidence = citedContactEvidence(SUBJECT, 'verified', [{
      url: 'https://fabricated.example/team/jamie-rivera',
      title: 'Jamie Rivera — Fabricated Labs',
      quote: 'Jamie Rivera founded Fabricated Labs. Email jamie@fabricated.example or call +44 20 7946 0958.',
    }], new Date('2026-08-27T00:00:00.000Z'))

    expect(evidence.find((item) => item.field === 'work_email')?.value).toMatchObject({
      email: 'jamie@fabricated.example',
    })
    expect(evidence.find((item) => item.field === 'mobile_phone')?.value).toMatchObject({
      phone: '+442079460958',
    })
    expect(evidence.filter((item) => item.field.endsWith('_status')).every(
      (item) => item.value.status === 'publicly_found',
    )).toBe(true)
  })

  it('does not persist generic mailboxes, model prose, or unknown answers', () => {
    const source = [{
      url: 'https://fabricated.example/contact',
      title: 'Jamie Rivera — Fabricated Labs',
      quote: 'Jamie Rivera leads Fabricated Labs. Contact sales@fabricated.example.',
    }]
    expect(citedContactEvidence(SUBJECT, 'verified', source)).toEqual([])
    expect(citedContactEvidence(SUBJECT, 'unknown', source)).toEqual([])
  })
})
