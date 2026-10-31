/**
 * One search per person per contact type.
 *
 * Pinned: the automatic email and phone providers each issue exactly
 * PHRASINGS_PER_CONTACT (1) general query — the phrasing that names the
 * person, the employer and what is wanted — instead of the four they used to.
 * Email adds ONE more when the employer's domain is known: the domain-mailbox
 * search (`"@domain" "Name"`), which finds pages that print addresses there.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const queries: string[] = []
vi.mock('@/lib/search', () => ({
  hasWebSearch: () => true,
  serpSearch: async (query: string) => {
    queries.push(query)
    return []
  },
}))

const PERSON = {
  type: 'person',
  id: '00000000-0000-4000-8000-000000000001',
  fullName: 'Jamie Rivera',
  linkedinUrl: null,
  jobTitle: 'Founder',
  companyName: 'Fabricated Labs',
  companyDomain: 'fabricated.example',
  location: 'London',
  companyId: '00000000-0000-4000-8000-000000000002',
} as const

describe('person contact search', () => {
  it('asks one phrasing per contact, plus the domain-mailbox search for email', async () => {
    const { PHRASINGS_PER_CONTACT, searchContactEmailProvider, searchContactPhoneProvider } = await import('@/lib/intelligence/providers/search-contact')
    expect(PHRASINGS_PER_CONTACT).toBe(1)

    await searchContactEmailProvider.execute({ id: 'e', category: 'contact_email', entity: PERSON, fields: ['work_email'] } as never)
    await searchContactPhoneProvider.execute({ id: 'p', category: 'contact_phone', entity: PERSON, fields: ['mobile_phone'] } as never)

    expect(queries).toEqual([
      'Jamie Rivera Fabricated Labs email',
      '"@fabricated.example" "Jamie Rivera"',
      'Fabricated Labs Jamie Rivera phone number',
    ])
  })
})
