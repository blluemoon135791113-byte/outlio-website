/**
 * "Add lead" on an account page — the existing contact flow with the account
 * preselected (spec §4.3).
 *
 * Two rules worth a test each: the account id in the form is checked like any
 * other input, and an EXISTING person who already works elsewhere is not moved
 * — matching someone by email is not evidence they changed employer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let created = true
let existingCompany: string | null = null
let accountVisible = true
const links: { contactId: string; companyId: string }[] = []

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

vi.mock('@/lib/workspaces/context', () => ({
  assertWorkspacePermission: async () => ({
    userId: 'u-sam',
    role: 'manager',
    modules: new Set(['crm']),
    workspace: { id: 'w1' },
  }),
}))

vi.mock('@/lib/crm/ingest', () => ({
  createContactManually: async () => ({ contactId: 'c-new', created, ownerUserId: 'u-sam' }),
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

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      Object.assign(chain, {
        select: self,
        eq: self,
        maybeSingle: () => Promise.resolve({ data: { primary_company_id: existingCompany }, error: null }),
      })
      return chain
    },
  }),
}))

const { createContactAction } = await import('@/lib/crm/contact-actions')

function form(companyId?: string): FormData {
  const f = new FormData()
  f.set('fullName', 'Pat Example')
  if (companyId) f.set('companyId', companyId)
  return f
}

beforeEach(() => {
  created = true
  existingCompany = null
  accountVisible = true
  links.length = 0
})

describe('Add lead at an account', () => {
  it('a new person is linked to the account', async () => {
    const result = await createContactAction(null, form('acc-1'))
    expect(result).toMatchObject({ ok: true, created: true })
    expect(links).toEqual([{ contactId: 'c-new', companyId: 'acc-1' }])
  })

  it('an existing person with no account is linked to it', async () => {
    created = false
    await createContactAction(null, form('acc-1'))
    expect(links).toEqual([{ contactId: 'c-new', companyId: 'acc-1' }])
  })

  it('an existing person who works ELSEWHERE is not moved, and the message says so', async () => {
    created = false
    existingCompany = 'acc-other'
    const result = await createContactAction(null, form('acc-1'))
    expect(links).toEqual([])
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining('not moved') })
  })

  it('an account the person cannot see is never linked — and they are told', async () => {
    accountVisible = false
    const result = await createContactAction(null, form('someone-elses-account'))
    expect(links).toEqual([])
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining('not added to it') })
  })

  it('without an account it is the plain contact flow, unchanged', async () => {
    const result = await createContactAction(null, form())
    expect(links).toEqual([])
    expect(result).toMatchObject({ ok: true, message: 'Contact added.' })
  })
})
