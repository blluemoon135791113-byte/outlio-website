/**
 * "Add decision maker" on an account page (Phase B): the deduplicating add,
 * at that account, then the Decision Maker role and the other profile links.
 *
 * The rules worth a test each:
 *   - everything is validated BEFORE anything is written, so a typo never
 *     leaves half a decision maker behind;
 *   - both LinkedIn addresses are kept, in their own places, and the identity
 *     is the Navigator one (how an extracted lead is keyed);
 *   - a person who works elsewhere is not moved, nor marked a decision maker
 *     here; a held match gets nothing at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '@/lib/errors/catalog'

let created = true
let ownerUserId = 'u-sam'
let role = 'manager'
let existingCompany: string | null = null
let accountVisible = true
let roleError: Error | null = null
let publicKeyTaken = false
const ingested: { input: Record<string, unknown> }[] = []
const profileWrites: { contactId: string; profiles: Record<string, unknown> }[] = []
const links: { contactId: string; companyId: string }[] = []
const roles: { contactId: string; key: string }[] = []
const added: { contactId: string; urls: string[] }[] = []
const reassignments: string[] = []

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

vi.mock('@/lib/workspaces/context', () => ({
  assertWorkspacePermission: async () => ({
    userId: 'u-sam',
    role,
    modules: new Set(['crm']),
    workspace: { id: 'w1' },
  }),
}))

vi.mock('@/lib/crm/ingest', () => ({
  createContactManually: async (_w: string, input: Record<string, unknown>) => {
    ingested.push({ input })
    return { contactId: 'c-1', created, ownerUserId }
  },
  recordContactProfileUrls: async (_w: string, contactId: string, profiles: Record<string, unknown>) => {
    profileWrites.push({ contactId, profiles })
  },
}))

vi.mock('@/lib/crm/account-access', () => ({
  assertAccountPermission: async () => ({ ctx: { userId: 'u-sam', workspace: { id: 'w1' } }, viewAll: true }),
  canSeeAccount: async () => accountVisible,
}))

vi.mock('@/lib/crm/repository', () => ({
  linkContactToCompany: async (_w: string, contactId: string, companyId: string) => {
    links.push({ contactId, companyId })
  },
}))

vi.mock('@/lib/crm/lead-role-service', () => ({
  addContactRole: async (_ctx: unknown, contactId: string, key: string) => {
    if (roleError) throw roleError
    roles.push({ contactId, key })
  },
}))

vi.mock('@/lib/crm/contact-links', () => ({
  addContactLinks: async (_ctx: unknown, contactId: string, list: { url: string }[]) => {
    added.push({ contactId, urls: list.map((l) => l.url) })
    return list.length
  },
  removeContactLink: async () => ({ contactId: 'c-1' }),
}))

vi.mock('@/lib/crm/collision', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/crm/collision')>()
  return {
    ...real,
    requestReassignment: async (_w: string, contactId: string) => {
      reassignments.push(contactId)
    },
  }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      Object.assign(chain, {
        select: self,
        eq: self,
        is: self,
        // identityKeyInUse: is someone already keyed by the public profile?
        limit: () => Promise.resolve({ data: publicKeyTaken ? [{ id: 'c-old' }] : [], error: null }),
        maybeSingle: () => Promise.resolve({ data: { primary_company_id: existingCompany }, error: null }),
      })
      return chain
    },
  }),
}))

const { addDecisionMakerAction } = await import('@/lib/crm/contact-actions')

const ACCOUNT = '0f000000-0000-4000-8000-000000000001'

function form(fields: Record<string, string> = {}, linkRows: [string, string, string][] = []): FormData {
  const f = new FormData()
  f.set('companyId', ACCOUNT)
  f.set('fullName', 'Pat Example')
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  for (const [kind, label, url] of linkRows) {
    f.append('link_kind', kind)
    f.append('link_label', label)
    f.append('link_url', url)
  }
  return f
}

const nothingWritten = () => {
  expect(ingested).toEqual([])
  expect(profileWrites).toEqual([])
  expect(links).toEqual([])
  expect(roles).toEqual([])
  expect(added).toEqual([])
}

beforeEach(() => {
  created = true
  ownerUserId = 'u-sam'
  role = 'manager'
  existingCompany = null
  accountVisible = true
  roleError = null
  publicKeyTaken = false
  for (const list of [ingested, profileWrites, links, roles, added, reassignments]) list.length = 0
})

describe('the happy path', () => {
  it('adds the person at the account, as a decision maker, with their links', async () => {
    const result = await addDecisionMakerAction(
      null,
      form(
        {
          jobTitle: 'Chief Financial Officer',
          email: 'pat@example.com',
          phone: '+1 415 555 0100',
          linkedInUrl: 'https://www.linkedin.com/in/pat-example/',
          salesNavigatorUrl: 'linkedin.com/sales/lead/ACwAAfabricated1,NAME_SEARCH,abc',
        },
        [['github', '', 'github.com/pat'], ['other', 'Blog', 'https://blog.example.com']],
      ),
    )

    expect(result).toMatchObject({ ok: true, created: true, message: 'Decision maker added.' })
    expect(ingested[0]!.input).toMatchObject({
      fullName: 'Pat Example',
      jobTitle: 'Chief Financial Officer',
      emails: ['pat@example.com'],
      phones: ['+1 415 555 0100'],
      // The identity is the Navigator address — how extracted leads are keyed.
      linkedInUrl: 'https://linkedin.com/sales/lead/ACwAAfabricated1,NAME_SEARCH,abc',
      source: 'manual',
    })
    expect(profileWrites).toEqual([
      {
        contactId: 'c-1',
        profiles: {
          salesNavigatorUrl: 'https://linkedin.com/sales/lead/ACwAAfabricated1,NAME_SEARCH,abc',
          publicProfileUrl: 'https://www.linkedin.com/in/pat-example',
        },
      },
    ])
    expect(links).toEqual([{ contactId: 'c-1', companyId: ACCOUNT }])
    expect(roles).toEqual([{ contactId: 'c-1', key: 'decision_maker' }])
    expect(added).toEqual([{ contactId: 'c-1', urls: ['https://github.com/pat', 'https://blog.example.com/'] }])
  })

  it('with only a public profile, that is the identity and nothing else is recorded', async () => {
    await addDecisionMakerAction(null, form({ linkedInUrl: 'linkedin.com/in/pat-example' }))
    expect(ingested[0]!.input.linkedInUrl).toBe('https://www.linkedin.com/in/pat-example')
    expect(profileWrites).toEqual([])
  })

  it('both typed, and someone is already keyed by the public profile: match on THAT, keep the Navigator address', async () => {
    publicKeyTaken = true
    await addDecisionMakerAction(
      null,
      form({
        linkedInUrl: 'https://www.linkedin.com/in/pat-example',
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/ACwAAfabricated1',
      }),
    )
    expect(ingested[0]!.input.linkedInUrl).toBe('https://www.linkedin.com/in/pat-example')
    expect(profileWrites[0]!.profiles).toEqual({
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/ACwAAfabricated1',
      publicProfileUrl: null,
    })
  })
})

describe('validated before anything is written', () => {
  it.each([
    ['no name', { fullName: '' }, /name/],
    ['a bad email', { email: 'pat@' }, /email/],
    ['a bad phone', { phone: '12' }, /phone/],
    ['a Navigator address in the LinkedIn field', { linkedInUrl: 'https://www.linkedin.com/sales/lead/ACwAAfabricated1' }, /profile address/],
    ['a profile in the Navigator field', { salesNavigatorUrl: 'https://www.linkedin.com/in/pat' }, /lead address/],
    ['a non-LinkedIn LinkedIn', { linkedInUrl: 'https://example.com/in/pat' }, /profile address/],
  ])('%s', async (_name, fields, message) => {
    const result = await addDecisionMakerAction(null, form(fields))
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(message) })
    nothingWritten()
  })

  it('a bad link', async () => {
    const result = await addDecisionMakerAction(null, form({}, [['x', '', '@pat']]))
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/full address/) })
    nothingWritten()
  })

  it('an account the person cannot see — nobody is created', async () => {
    accountVisible = false
    const result = await addDecisionMakerAction(null, form())
    expect(result).toEqual({ ok: false, error: 'That account could not be found.' })
    nothingWritten()
  })
})

describe('an existing person', () => {
  it('who works ELSEWHERE is not moved and not marked a decision maker here', async () => {
    created = false
    existingCompany = 'acc-other'
    const result = await addDecisionMakerAction(null, form({}, [['github', '', 'github.com/pat']]))
    expect(links).toEqual([])
    expect(roles).toEqual([])
    expect(added).toHaveLength(1)
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining('not moved or marked as a decision maker') })
  })

  it('held for review (someone else\'s, for a setter) gets nothing — no role, no links', async () => {
    role = 'setter'
    created = false
    ownerUserId = 'u-someone-else'
    const result = await addDecisionMakerAction(
      null,
      form({ salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/ACwAAfabricated1' }, [['github', '', 'github.com/pat']]),
    )
    expect(result).toMatchObject({ ok: true, held: true })
    expect(reassignments).toEqual(['c-1'])
    // The typed addresses never touch the record the setter may not see.
    expect(profileWrites).toEqual([])
    expect(roles).toEqual([])
    expect(added).toEqual([])
    expect(links).toEqual([])
  })
})

it('a disabled Decision Maker role still adds the person, and says so', async () => {
  roleError = new AppError('ERR_VALIDATION', 'crm_add_contact_role: that role is disabled in this workspace')
  const result = await addDecisionMakerAction(null, form())
  expect(result).toMatchObject({ ok: true, message: expect.stringContaining('disabled in this workspace') })
  expect(links).toHaveLength(1)
})
