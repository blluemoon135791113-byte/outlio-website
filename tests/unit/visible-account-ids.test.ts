/**
 * `visibleAccountIds` is `canSeeAccount` for many ids at once. It decides which
 * accounts bulk "Move to pipeline" may touch and which account names a
 * pipeline card may show, so it must be the same rule exactly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AccountAccess } from '@/lib/crm/account-access'

const A = '0a000000-0000-4000-8000-000000000001'
const B = '0a000000-0000-4000-8000-000000000002'
const C = '0a000000-0000-4000-8000-000000000003'

let live: string[] = []
let assigned: string[] = []
const filters: { table: string; eq: Record<string, unknown> }[] = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const eq: Record<string, unknown> = {}
      let inIds: string[] = []
      const chain: Record<string, unknown> = {}
      Object.assign(chain, {
        select: () => chain,
        eq: (k: string, v: unknown) => {
          eq[k] = v
          return chain
        },
        is: () => chain,
        in: (_k: string, ids: string[]) => {
          inIds = ids
          return chain
        },
        then: (resolve: (r: unknown) => unknown) => {
          filters.push({ table, eq: { ...eq } })
          const data =
            table === 'crm_companies'
              ? live.filter((id) => inIds.includes(id)).map((id) => ({ id }))
              : assigned.filter((id) => inIds.includes(id)).map((id) => ({ company_id: id }))
          return Promise.resolve({ data, error: null }).then(resolve)
        },
      })
      return chain
    },
  }),
}))

const { visibleAccountIds } = await import('@/lib/crm/account-access')

const access = (viewAll: boolean) =>
  ({ ctx: { userId: 'u-sam', workspace: { id: 'w1' } }, viewAll, can: () => true, granted: new Set() }) as unknown as AccountAccess

beforeEach(() => {
  live = [A, B]
  assigned = [A]
  filters.length = 0
})

describe('visibleAccountIds', () => {
  it('with view_all: every live account of the workspace', async () => {
    expect(await visibleAccountIds(access(true), [A, B, C])).toEqual(new Set([A, B]))
  })

  it('without: only live accounts with an open assignment to THIS member', async () => {
    expect(await visibleAccountIds(access(false), [A, B, C])).toEqual(new Set([A]))
    expect(filters.find((f) => f.table === 'crm_company_assignments')?.eq).toMatchObject({
      workspace_id: 'w1',
      user_id: 'u-sam',
    })
  })

  it('an assignment to a deleted or foreign account does not make it visible', async () => {
    assigned = [A, C]
    expect(await visibleAccountIds(access(false), [C])).toEqual(new Set())
  })

  it('malformed ids are not visible, and nothing is queried for none', async () => {
    expect(await visibleAccountIds(access(true), ['not-a-uuid', ''])).toEqual(new Set())
    expect(filters).toEqual([])
  })

  it('every query is scoped to the workspace', async () => {
    await visibleAccountIds(access(false), [A, B])
    expect(filters.every((f) => f.eq.workspace_id === 'w1')).toBe(true)
  })
})
