/**
 * Lead roles — the service around the classifier.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceContext } from '@/lib/workspaces/context'

const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
let contactOwner: string | null = 'u-sam'
let contactExists = true
let rpcFails = false
const titles = new Map<string, string | null>()

function table(name: string) {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  let ids: string[] = []
  Object.assign(chain, {
    select: self,
    eq: self,
    is: self,
    order: self,
    in: (_k: string, v: string[]) => {
      ids = v
      return chain
    },
    maybeSingle: () =>
      Promise.resolve({ data: contactExists ? { owner_user_id: contactOwner } : null, error: null }),
    then: (resolve: (r: unknown) => unknown) => {
      const data =
        name === 'crm_lead_roles'
          ? [
              { id: 'dm', system_key: 'decision_maker', is_active: true },
              { id: 'other', system_key: 'other', is_active: true },
            ]
          : name === 'crm_lead_role_rules'
            ? [{ role_id: 'dm', match_kind: 'title', keyword: 'CFO' }]
            : ids.map((id) => ({ id, job_title: titles.get(id) ?? null }))
      return Promise.resolve({ data, error: null }).then(resolve)
    },
  })
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (n: string) => table(n),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      if (rpcFails) return Promise.resolve({ data: null, error: { code: 'XX000', message: 'down' } })
      return Promise.resolve({ data: { applied: 1, skipped_manual: 0, missing: 0 }, error: null })
    },
  }),
}))

const service = await import('@/lib/crm/lead-role-service')

const C1 = '11111111-1111-4111-8111-111111111111'
const C2 = '22222222-2222-4222-8222-222222222222'

function ctx(role: 'setter' | 'manager' | 'viewer'): WorkspaceContext {
  return {
    userId: 'u-sam',
    role,
    modules: new Set(['crm']),
    workspace: { id: 'w1' },
  } as unknown as WorkspaceContext
}

beforeEach(() => {
  rpcCalls.length = 0
  contactOwner = 'u-sam'
  contactExists = true
  rpcFails = false
  titles.clear()
})

describe('applyAutoRoles', () => {
  it('classifies each lead from its CURRENT title and writes one batch', async () => {
    titles.set(C1, 'CFO')
    titles.set(C2, 'Office Assistant')
    await service.applyAutoRoles('w1', [C1, C2, C1, 'not-a-uuid'])
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]!.name).toBe('crm_apply_auto_roles')
    expect(rpcCalls[0]!.args.p_rows).toEqual([
      { contact_id: C1, title: 'CFO', role_ids: ['dm'] },
      { contact_id: C2, title: 'Office Assistant', role_ids: ['other'] },
    ])
  })

  it('the quiet variant never throws — a suggestion must not fail an import', async () => {
    rpcFails = true
    titles.set(C1, 'CFO')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(service.applyAutoRolesQuietly('w1', [C1])).resolves.toBeUndefined()
  })
})

describe('setContactRoles — the contact rule', () => {
  it('a viewer cannot edit roles', async () => {
    await expect(service.setContactRoles(ctx('viewer'), C1, ['dm'])).rejects.toMatchObject({ code: 'ERR_FORBIDDEN' })
    expect(rpcCalls).toEqual([])
  })

  it("a setter cannot edit a colleague's lead — and is told it does not exist", async () => {
    contactOwner = 'someone-else'
    await expect(service.setContactRoles(ctx('setter'), C1, ['dm'])).rejects.toMatchObject({ code: 'ERR_NOT_FOUND' })
    expect(rpcCalls).toEqual([])
  })

  it('a manager can edit any lead in the workspace', async () => {
    contactOwner = 'someone-else'
    await service.setContactRoles(ctx('manager'), C1, ['11111111-1111-4111-8111-1111111111aa'])
    expect(rpcCalls.map((c) => c.name)).toEqual(['crm_set_contact_roles'])
  })

  it('"back to suggestions" unpins, then suggests again at once', async () => {
    titles.set(C1, 'CFO')
    await service.setContactRoles(ctx('setter'), C1, null)
    expect(rpcCalls.map((c) => c.name)).toEqual(['crm_set_contact_roles', 'crm_apply_auto_roles'])
    expect(rpcCalls[0]!.args.p_role_ids).toBeNull()
  })

  it('a malformed id is refused before any write', async () => {
    await expect(service.setContactRoles(ctx('manager'), 'x', ['dm'])).rejects.toMatchObject({ code: 'ERR_NOT_FOUND' })
    await expect(service.setContactRoles(ctx('manager'), C1, ['not-a-uuid'])).rejects.toMatchObject({
      code: 'ERR_VALIDATION',
    })
    expect(rpcCalls).toEqual([])
  })
})
