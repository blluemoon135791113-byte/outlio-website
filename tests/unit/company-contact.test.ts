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
})
