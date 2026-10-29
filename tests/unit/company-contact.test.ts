import { describe, expect, it } from 'vitest'

import { selectCompanyContacts } from '@/lib/intelligence/providers/company-contact'

describe('selectCompanyContacts', () => {
  it('selects an official-domain generic inbox and published phone', () => {
    const selected = selectCompanyContacts('example.com', [
      {
        url: 'https://example.com/contact',
        emails: ['person@example.com', 'sales@example.com', 'outside@directory.test'],
        phones: ['+44 20 7946 0000'],
      },
    ])

    expect(selected.email).toEqual({
      value: 'sales@example.com',
      sourceUrl: 'https://example.com/contact',
    })
    expect(selected.phone?.value).toBe('+44 20 7946 0000')
  })

  it('never accepts an external-domain email as a company contact', () => {
    const selected = selectCompanyContacts('example.com', [{
      url: 'https://example.com',
      emails: ['listing@directory.test'],
      phones: [],
    }])

    expect(selected.email).toBeNull()
  })

  it('files a free-mail address from the company\'s own page when its domain publishes none', () => {
    const selected = selectCompanyContacts('fabricated.example', [{
      url: 'https://fabricated.example/contact',
      emails: ['FabricatedLabs@Gmail.com', 'credit@webagency.test'],
      phones: [],
    }])
    expect(selected.email).toEqual({
      value: 'fabricatedlabs@gmail.com',
      sourceUrl: 'https://fabricated.example/contact',
      freemail: true,
    })
  })

  it('prefers any on-domain address over a free-mail one', () => {
    const selected = selectCompanyContacts('fabricated.example', [{
      url: 'https://fabricated.example/contact',
      emails: ['owner@gmail.com', 'hello@fabricated.example'],
      phones: [],
    }])
    expect(selected.email?.value).toBe('hello@fabricated.example')
    expect(selected.email?.freemail).toBeUndefined()
  })

  it('still never files another company\'s domain (a web agency credit)', () => {
    const selected = selectCompanyContacts('fabricated.example', [{
      url: 'https://fabricated.example/',
      emails: ['studio@webagency.test'],
      phones: [],
    }])
    expect(selected.email).toBeNull()
  })

  it('files a free-mail address at MEDIUM confidence, below an on-domain one', async () => {
    const { companyContactProvider } = await import('@/lib/intelligence/providers/company-contact')
    const task = { id: 't', category: 'company_profile', entity: { type: 'company', id: '00000000-0000-4000-8000-000000000001', name: 'Fabricated', domain: 'fabricated.example', linkedinUrl: null }, fields: ['company_contact_email'] } as never
    const [evidence] = companyContactProvider.normalize({ email: { value: 'a@gmail.com', sourceUrl: 'https://fabricated.example/contact', freemail: true }, phone: null }, task)
    expect(evidence).toMatchObject({ sourceConfidence: 'medium', confidence: 0.72 })
  })
})
