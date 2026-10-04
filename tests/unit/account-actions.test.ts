/**
 * The account server actions — public endpoints, so: gated per operation,
 * bounded, partial-failure tolerant, and silent about internals.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '@/lib/errors/catalog'

const gated: string[] = []
let refuse: string | null = null
const calls: { fn: string; id: string; value?: unknown }[] = []
let failFor: string | null = null
let throwInternal = false

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`)
  },
}))

vi.mock('@/lib/crm/account-access', () => ({
  assertAccountPermission: async (permission: string) => {
    gated.push(permission)
    if (permission === refuse) throw new AppError('ERR_FORBIDDEN', `refused ${permission}`)
    return { ctx: { userId: 'u1', workspace: { id: 'w1' } }, can: () => true, viewAll: true, granted: new Set() }
  },
}))

function service(fn: string) {
  return async (_access: unknown, id: string, value?: unknown) => {
    calls.push({ fn, id, value })
    if (throwInternal) throw new Error('duplicate key value violates unique constraint "crm_companies_pkey"')
    if (id === failFor) throw new AppError('ERR_VALIDATION', 'disabled')
    return { changed: true }
  }
}

vi.mock('@/lib/crm/account-writes', () => ({
  assignAccount: service('assignAccount'),
  unassignAccount: service('unassignAccount'),
  setAccountStatus: service('setAccountStatus'),
  addAccountTag: service('addAccountTag'),
  setAccountTags: service('setAccountTags'),
  addAccountNote: service('addAccountNote'),
  deleteAccount: service('deleteAccount'),
  createAccount: async () => {
    if (throwInternal) throw new Error('relation "crm_companies" violates check constraint "x"')
    return { ok: true, id: 'new' }
  },
  updateAccount: async () => ({ ok: true, id: 'acc-1' }),
}))

const actions = await import('@/lib/crm/account-actions')

function form(entries: [string, string][]): FormData {
  const f = new FormData()
  for (const [k, v] of entries) f.append(k, v)
  return f
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => ['accountId', `acc-${i}`] as [string, string])

beforeEach(() => {
  gated.length = 0
  calls.length = 0
  refuse = null
  failFor = null
  throwInternal = false
})

describe('bulk', () => {
  it('gates each operation on its own permission', async () => {
    for (const [op, permission] of [
      ['assign', 'accounts.assign'],
      ['status', 'accounts.edit'],
      ['add_tag', 'accounts.edit_tags'],
    ] as const) {
      gated.length = 0
      await actions.bulkAccountAction(null, form([['op', op], [`value_${op}`, 'v'], ...ids(1)]))
      expect(gated).toEqual([permission])
    }
  })

  it('a refused permission writes nothing', async () => {
    refuse = 'accounts.edit_tags'
    const result = await actions.bulkAccountAction(null, form([['op', 'add_tag'], ['value_add_tag', 'v'], ...ids(3)]))
    expect(result).toEqual({ ok: false, message: 'You do not have permission to do that.' })
    expect(calls).toEqual([])
  })

  it('an unknown operation is refused before any gate', async () => {
    const result = await actions.bulkAccountAction(null, form([['op', 'delete_everything'], ...ids(1)]))
    expect(result?.ok).toBe(false)
    expect(gated).toEqual([])
  })

  it('caps the batch at 100', async () => {
    const result = await actions.bulkAccountAction(null, form([['op', 'status'], ['value_status', 's'], ...ids(101)]))
    expect(result).toMatchObject({ ok: false })
    expect(calls).toEqual([])
  })

  it('skips an account that fails and still changes the rest', async () => {
    failFor = 'acc-1'
    const result = await actions.bulkAccountAction(null, form([['op', 'status'], ['value_status', 's'], ...ids(3)]))
    expect(calls.map((c) => c.id)).toEqual(['acc-0', 'acc-1', 'acc-2'])
    expect(result).toEqual({ ok: false, message: '2 updated, 1 skipped.' })
  })

  it('de-duplicates ticked ids', async () => {
    await actions.bulkAccountAction(
      null,
      form([['op', 'status'], ['value_status', 's'], ['accountId', 'a'], ['accountId', 'a']]),
    )
    expect(calls).toHaveLength(1)
  })
})

describe('single actions', () => {
  it('an empty assignee choice is NOT "remove everyone"', async () => {
    const result = await actions.assignAccountAction(null, form([['companyId', 'acc-1'], ['userId', '']]))
    expect(result).toEqual({ ok: false, message: 'Choose who to assign it to.' })
    expect(calls).toEqual([])
  })

  it('assign passes the add mode through', async () => {
    await actions.assignAccountAction(null, form([['companyId', 'acc-1'], ['userId', 'u2'], ['mode', 'add']]))
    expect(gated).toEqual(['accounts.assign'])
    expect(calls).toEqual([{ fn: 'assignAccount', id: 'acc-1', value: 'u2' }])
  })

  it('tags are gated by accounts.edit_tags, not accounts.edit', async () => {
    await actions.setAccountTagsAction(null, form([['companyId', 'acc-1'], ['groupId', 'g1'], ['tagIds', 't1']]))
    expect(gated).toEqual(['accounts.edit_tags'])
  })

  it('the primary is never also sent as a plain value', async () => {
    await actions.setAccountTagsAction(
      null,
      form([['companyId', 'acc-1'], ['groupId', 'g1'], ['primaryId', 't1'], ['tagIds', 't1'], ['tagIds', 't2']]),
    )
    expect(calls[0]!.value).toEqual({ groupId: 'g1', primaryId: 't1', tagIds: ['t2'] })
  })

  it('"inherited" operation names are refused, not dispatched', async () => {
    const result = await actions.bulkAccountAction(null, form([['op', 'constructor'], ...ids(1)]))
    expect(result?.ok).toBe(false)
    expect(gated).toEqual([])
  })

  it('delete redirects to the list only after it succeeded', async () => {
    await expect(actions.deleteAccountAction(null, form([['companyId', 'acc-1']]))).rejects.toThrow(
      'REDIRECT:/crm/companies',
    )
    refuse = 'accounts.delete'
    expect(await actions.deleteAccountAction(null, form([['companyId', 'acc-1']]))).toMatchObject({ ok: false })
  })
})

describe('nothing internal reaches the browser', () => {
  it('a database message becomes one fixed sentence', async () => {
    throwInternal = true
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const single = await actions.setAccountStatusAction(null, form([['companyId', 'acc-1'], ['statusId', 's']]))
    const created = await actions.createAccountAction(null, form([['name', 'Acme']]))
    for (const result of [single, created]) {
      const text = JSON.stringify(result)
      expect(text).toContain('Something went wrong')
      expect(text).not.toMatch(/constraint|relation|crm_companies/)
    }
  })
})
