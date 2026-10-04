/**
 * The write service refuses on its own, whoever calls it.
 *
 * Server actions are public endpoints (CLAUDE.md rule 8), so these assert the
 * refusal at the SERVICE — the layer every action shares — not at a button.
 * Acceptance criteria covered here:
 *   - an employee without accounts.create is refused (ERR_FORBIDDEN → 403)
 *   - an employee with only accounts.edit_tags can change tags, not fields
 *   - adding an existing company is blocked, with an "open existing" target
 *     only when the person may actually open it
 *   - tag values must belong to the group they are saved under (0153)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AccountAccess } from '@/lib/crm/account-access'
import type { AccountPermission } from '@/lib/crm/account-permissions'
import type { CompanyMatchReport } from '@/lib/crm/repository'
import { AppError } from '@/lib/errors/catalog'

// ---- fixture: two groups, three values -------------------------------------

const INDUSTRY = '11111111-1111-4111-8111-1111111111aa' // has a primary
const REGION = '22222222-2222-4222-8222-2222222222aa' // no primary
const SAAS = '11111111-1111-4111-8111-111111111111'
const FINTECH = '22222222-2222-4222-8222-222222222222'
const EMEA = '33333333-3333-4333-8333-333333333333'
const OTHER_USER = '44444444-4444-4444-8444-444444444444'
const LEGACY = '55555555-5555-4555-8555-5555555555aa' // a disabled group
const OLD = '55555555-5555-4555-8555-555555555555'

const GROUPS = [
  { id: INDUSTRY, name: 'Industry', has_primary: true, is_active: true },
  { id: REGION, name: 'Region', has_primary: false, is_active: true },
  { id: LEGACY, name: 'Legacy', has_primary: false, is_active: false },
]
const TAGS = new Map([
  [SAAS, { id: SAAS, group_id: INDUSTRY }],
  [FINTECH, { id: FINTECH, group_id: INDUSTRY }],
  [EMEA, { id: EMEA, group_id: REGION }],
  [OLD, { id: OLD, group_id: LEGACY }],
])

// ---- doubles ---------------------------------------------------------------

const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
const inserts: { table: string; row: Record<string, unknown> }[] = []
const updates: { table: string; row: Record<string, unknown> }[] = []
let matchReport: CompanyMatchReport = { exact: [], possible: [], conflict: false }
const visible = new Set<string>()
const active = new Set<string>()
const members = new Set<string>()
let failRpc: string | null = null

function table(name: string) {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  let inIds: string[] = []
  const eq: Record<string, unknown> = {}
  Object.assign(chain, {
    select: self,
    is: self,
    eq: (k: string, v: unknown) => {
      eq[k] = v
      return chain
    },
    in: (_k: string, ids: string[]) => {
      inIds = ids
      return chain
    },
    update: (row: Record<string, unknown>) => {
      updates.push({ table: name, row })
      return chain
    },
    insert: (row: Record<string, unknown>) => {
      inserts.push({ table: name, row })
      return chain
    },
    single: () => Promise.resolve({ data: { id: 'new-account' }, error: null }),
    maybeSingle: () => {
      if (name === 'workspace_memberships') {
        return Promise.resolve({ data: members.has(String(eq.user_id)) ? { user_id: eq.user_id } : null, error: null })
      }
      if (name === 'crm_tags') {
        const tag = TAGS.get(String(eq.id))
        return Promise.resolve({ data: tag ? { group_id: tag.group_id } : null, error: null })
      }
      return Promise.resolve({ data: { id: 'status-1' }, error: null })
    },
    then: (resolve: (r: unknown) => unknown) => {
      const data =
        name === 'crm_tag_groups'
          ? GROUPS.filter((g) => inIds.includes(g.id))
          : name === 'crm_tags'
            ? inIds.flatMap((id) => {
                const tag = TAGS.get(id)
                return tag ? [{ ...tag, is_active: active.has(id) }] : []
              })
            : []
      return Promise.resolve({ data, error: null }).then(resolve)
    },
  })
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (name: string) => table(name),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      if (name === failRpc) {
        return Promise.resolve({ data: null, error: { code: '23514', message: 'new row violates check constraint' } })
      }
      return Promise.resolve({ data: { changed: true }, error: null })
    },
  }),
}))

vi.mock('@/lib/crm/account-access', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/crm/account-access')>()
  return {
    requirePermissionFor: real.requirePermissionFor,
    canSeeAccount: async (_a: unknown, id: string) => visible.has(id),
    assertCanSeeAccount: async (_a: unknown, id: string) => {
      if (!visible.has(id)) throw new AppError('ERR_NOT_FOUND')
    },
  }
})

vi.mock('@/lib/crm/activities', () => ({ recordAudit: async () => undefined, addNote: async () => 'note-1' }))

vi.mock('@/lib/crm/repository', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/crm/repository')>()
  return { ...real, findCrmCompanyMatches: async () => matchReport }
})

const writes = await import('@/lib/crm/account-writes')

function access(permissions: AccountPermission[], viewAll = false): AccountAccess {
  const granted = new Set(permissions)
  return {
    ctx: { userId: 'u-sam', workspace: { id: 'w1' } } as AccountAccess['ctx'],
    granted,
    can: (p) => granted.has(p),
    viewAll,
  }
}

beforeEach(() => {
  rpcCalls.length = 0
  inserts.length = 0
  updates.length = 0
  matchReport = { exact: [], possible: [], conflict: false }
  visible.clear()
  visible.add('acc-1')
  active.clear()
  for (const id of [SAAS, FINTECH, EMEA, OLD]) active.add(id)
  members.clear()
  members.add('u-sam')
  members.add(OTHER_USER)
  failRpc = null
})

async function refused(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code })
}

// ---- permissions -------------------------------------------------------------

describe('permissions are enforced by the service', () => {
  it('create without accounts.create is ERR_FORBIDDEN (a 403), and writes nothing', async () => {
    await refused(writes.createAccount(access(['accounts.edit']), { name: 'Acme' }), 'ERR_FORBIDDEN')
    expect(inserts).toEqual([])
    expect(new AppError('ERR_FORBIDDEN').status).toBe(403)
  })

  it('a tags-only employee can change tags', async () => {
    await writes.setAccountTags(access(['accounts.edit_tags']), 'acc-1', { groupId: REGION, tagIds: [EMEA] })
    expect(rpcCalls.map((c) => c.name)).toEqual(['crm_set_company_tags'])
  })

  it('…and cannot edit fields', async () => {
    await refused(writes.updateAccount(access(['accounts.edit_tags']), 'acc-1', { name: 'New name' }), 'ERR_FORBIDDEN')
  })

  it('accounts.edit does not imply tag edits', async () => {
    await refused(
      writes.setAccountTags(access(['accounts.edit']), 'acc-1', { groupId: REGION, tagIds: [EMEA] }),
      'ERR_FORBIDDEN',
    )
  })

  it('assign needs accounts.assign', async () => {
    await refused(writes.assignAccount(access(['accounts.edit']), 'acc-1', OTHER_USER), 'ERR_FORBIDDEN')
  })

  it('delete needs accounts.delete', async () => {
    await refused(writes.deleteAccount(access(['accounts.edit', 'accounts.assign']), 'acc-1'), 'ERR_FORBIDDEN')
  })

  it('creating FOR someone else needs accounts.assign too', async () => {
    await refused(
      writes.createAccount(access(['accounts.create']), { name: 'Acme', assigneeUserId: OTHER_USER }),
      'ERR_FORBIDDEN',
    )
  })
})

describe('visibility is enforced on every write by id', () => {
  it('an account you cannot see is NOT FOUND, not forbidden', async () => {
    await refused(
      writes.setAccountTags(access(['accounts.edit_tags']), 'someone-elses', { groupId: REGION, tagIds: [EMEA] }),
      'ERR_NOT_FOUND',
    )
    expect(rpcCalls).toEqual([])
  })
})

// ---- tag groups ---------------------------------------------------------------

describe('tags must belong to the group they are saved under', () => {
  it("a value from another group is refused before anything is written", async () => {
    await refused(
      writes.setAccountTags(access(['accounts.edit_tags']), 'acc-1', { groupId: REGION, tagIds: [SAAS] }),
      'ERR_VALIDATION',
    )
    expect(rpcCalls).toEqual([])
  })

  it('a group with a primary needs one when it has values', async () => {
    await refused(
      writes.setAccountTags(access(['accounts.edit_tags']), 'acc-1', { groupId: INDUSTRY, tagIds: [SAAS] }),
      'ERR_VALIDATION',
    )
    await writes.setAccountTags(access(['accounts.edit_tags']), 'acc-1', {
      groupId: INDUSTRY,
      primaryId: SAAS,
      tagIds: [FINTECH],
    })
    expect(rpcCalls[0]!.args).toMatchObject({ p_group_id: INDUSTRY, p_primary: SAAS, p_tag_ids: [FINTECH], p_merge: false })
  })

  it('clearing a group is allowed', async () => {
    await writes.setAccountTags(access(['accounts.edit_tags']), 'acc-1', { groupId: INDUSTRY, tagIds: [] })
    expect(rpcCalls).toHaveLength(1)
  })

  it('an edit may keep a value that has since been disabled', async () => {
    active.delete(EMEA)
    await writes.setAccountTags(access(['accounts.edit_tags']), 'acc-1', { groupId: REGION, tagIds: [EMEA] })
    expect(rpcCalls).toHaveLength(1)
  })

  it('bulk "add tag" finds the value\'s group and merges', async () => {
    await writes.addAccountTag(access(['accounts.edit_tags']), 'acc-1', EMEA)
    expect(rpcCalls[0]!.args).toMatchObject({ p_group_id: REGION, p_primary: EMEA, p_merge: true })
  })

  /*
   * A disabled group's chips are hidden, so a value added to it would filter
   * lists for a reason nobody can see. Read-only on the page; refused here.
   */
  it('a disabled group is refused, through the editor and through bulk', async () => {
    await refused(writes.setAccountTags(access(['accounts.edit_tags']), 'acc-1', { groupId: LEGACY, tagIds: [OLD] }), 'ERR_VALIDATION')
    await refused(writes.addAccountTag(access(['accounts.edit_tags']), 'acc-1', OLD), 'ERR_VALIDATION')
    expect(rpcCalls).toEqual([])
  })

  it('bulk "add tag" refuses a disabled value', async () => {
    active.delete(EMEA)
    await refused(writes.addAccountTag(access(['accounts.edit_tags']), 'acc-1', EMEA), 'ERR_VALIDATION')
    expect(rpcCalls).toEqual([])
  })

  it('bulk "add tag" refuses an id that is not an account tag', async () => {
    await refused(
      writes.addAccountTag(access(['accounts.edit_tags']), 'acc-1', '99999999-9999-4999-8999-999999999999'),
      'ERR_VALIDATION',
    )
  })
})

describe('errors', () => {
  /*
   * 23514 is also what any table CHECK raises. Only the refusals our own
   * functions word ("crm_…: …") are the caller's mistake.
   */
  it("a genuine database fault inside a function is not reported as the caller's mistake", async () => {
    failRpc = 'crm_set_company_tags'
    const error = await writes
      .setAccountTags(access(['accounts.edit_tags']), 'acc-1', { groupId: REGION, tagIds: [EMEA] })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toMatchObject({ code: 'ERR_VALIDATION' })
  })
})

// ---- create ----------------------------------------------------------------

describe('create', () => {
  it('blocks an existing company and links to it when you can see it', async () => {
    matchReport = {
      exact: [{ id: 'acc-1', name: 'Acme Health', matchedBy: 'linkedin', hasStrongIdentity: true }],
      possible: [],
      conflict: false,
    }
    const result = await writes.createAccount(access(['accounts.create']), {
      name: 'Acme',
      linkedInUrl: 'https://www.LinkedIn.com/company/Acme/',
    })
    expect(result).toEqual({
      ok: false,
      reason: 'duplicate',
      existing: { id: 'acc-1', name: 'Acme Health' },
      matchedBy: 'linkedin',
    })
    expect(inserts).toEqual([])
  })

  /*
   * ⚠️ An employee who may create but not see everything must learn THAT it
   * exists, never WHICH account it is or whose it is.
   */
  it('says it exists without naming it when you cannot see it', async () => {
    matchReport = {
      exact: [{ id: 'hidden-acc', name: 'Secret Co', matchedBy: 'domain', hasStrongIdentity: true }],
      possible: [],
      conflict: false,
    }
    const result = await writes.createAccount(access(['accounts.create']), {
      name: 'Secret',
      websiteUrl: 'secret.example.com',
    })
    expect(result).toMatchObject({ ok: false, reason: 'duplicate', existing: { hidden: true } })
    expect(JSON.stringify(result)).not.toContain('Secret Co')
  })

  it('reports a conflict instead of choosing between two accounts', async () => {
    matchReport = {
      exact: [
        { id: 'acc-1', name: 'Acme', matchedBy: 'sales_navigator', hasStrongIdentity: true },
        { id: 'acc-2', name: 'Globex', matchedBy: 'domain', hasStrongIdentity: true },
      ],
      possible: [],
      conflict: true,
    }
    const result = await writes.createAccount(access(['accounts.create']), { name: 'Acme' })
    expect(result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(inserts).toEqual([])
  })

  it('a possible (name-only) duplicate needs confirmation', async () => {
    matchReport = {
      exact: [],
      possible: [{ id: 'acc-1', name: 'Acme', matchedBy: 'name', hasStrongIdentity: true }],
      conflict: false,
    }
    const input = { name: 'Acme', websiteUrl: 'acme-two.example.com' }
    expect(await writes.createAccount(access(['accounts.create']), input)).toMatchObject({
      reason: 'possible_duplicate',
      blocking: false,
    })
    expect(
      await writes.createAccount(access(['accounts.create']), { ...input, confirmPossibleDuplicate: true }),
    ).toEqual({ ok: true, id: 'new-account' })
  })

  it('two name-only accounts with one name is BLOCKING — confirming cannot help', async () => {
    matchReport = {
      exact: [],
      possible: [{ id: 'acc-1', name: 'Acme', matchedBy: 'name', hasStrongIdentity: false }],
      conflict: false,
    }
    const result = await writes.createAccount(access(['accounts.create']), {
      name: 'Acme',
      confirmPossibleDuplicate: true,
    })
    expect(result).toMatchObject({ reason: 'possible_duplicate', blocking: true })
    expect(inserts).toEqual([])
  })

  it('refuses a URL it cannot parse rather than storing a half-identity', async () => {
    const result = await writes.createAccount(access(['accounts.create']), {
      name: 'Acme',
      linkedInUrl: 'https://example.com/company/acme',
      salesNavigatorUrl: 'https://www.linkedin.com/company/acme',
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    if (result.ok || result.reason !== 'invalid') return
    expect(Object.keys(result.fieldErrors).sort()).toEqual(['linkedInUrl', 'salesNavigatorUrl'])
  })

  /*
   * ⚠️ THE ORPHAN. A refusal from a later step used to leave the row behind,
   * unassigned — so a creator without view_all could neither see it nor
   * retry. Everything the later steps check is checked before the insert.
   */
  it('a disabled value is refused BEFORE the account is created', async () => {
    active.delete(SAAS)
    const result = await writes.createAccount(access(['accounts.create']), {
      name: 'Acme',
      tags: [{ groupId: INDUSTRY, primaryId: SAAS, tagIds: [] }],
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid', fieldErrors: { tags: expect.any(String) } })
    expect(inserts).toEqual([])
  })

  it('a value under the wrong group is refused before the account is created', async () => {
    const result = await writes.createAccount(access(['accounts.create']), {
      name: 'Acme',
      tags: [{ groupId: REGION, tagIds: [SAAS] }],
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid', fieldErrors: { tags: expect.any(String) } })
    expect(inserts).toEqual([])
  })

  it('an assignee outside the workspace is refused before the account is created', async () => {
    members.delete(OTHER_USER)
    const result = await writes.createAccount(access(['accounts.create', 'accounts.assign']), {
      name: 'Acme',
      assigneeUserId: OTHER_USER,
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid', fieldErrors: { assigneeUserId: expect.any(String) } })
    expect(inserts).toEqual([])
  })

  it('assigns BEFORE tagging, so a later failure cannot hide the account from its creator', async () => {
    await writes.createAccount(access(['accounts.create']), {
      name: 'Acme',
      tags: [{ groupId: REGION, tagIds: [EMEA] }],
    })
    expect(rpcCalls.map((c) => c.name)).toEqual(['crm_assign_company', 'crm_set_company_tags'])
  })

  it('soft-deletes a half-made account when a later step fails, and rethrows', async () => {
    failRpc = 'crm_set_company_tags'
    await expect(
      writes.createAccount(access(['accounts.create'], true), { name: 'Acme', tags: [{ groupId: REGION, tagIds: [EMEA] }] }),
    ).rejects.toThrow()
    expect(updates).toEqual([{ table: 'crm_companies', row: { deleted_at: expect.any(String) } }])
  })

  it('writes one transactional call per touched group and records the source', async () => {
    await writes.createAccount(access(['accounts.create'], true), {
      name: 'Acme',
      tags: [
        { groupId: INDUSTRY, primaryId: SAAS, tagIds: [FINTECH] },
        { groupId: REGION, tagIds: [EMEA] },
        { groupId: REGION.replace('aa', 'bb'), tagIds: [] },
      ],
    })
    expect(rpcCalls.map((c) => c.args.p_group_id)).toEqual([INDUSTRY, REGION])
    expect(inserts.map((i) => i.table)).toEqual(['crm_companies', 'crm_company_sources'])
    expect(inserts[0]!.row).toMatchObject({ workspace_id: 'w1', source: 'manual', created_by: 'u-sam' })
  })

  /*
   * ⚠️ Without this an employee granted `create` (but not view_all) would
   * watch their new account vanish from their own list on save.
   */
  it('assigns the account to its creator when they cannot see unassigned accounts', async () => {
    await writes.createAccount(access(['accounts.create'], false), { name: 'Acme' })
    expect(rpcCalls).toEqual([
      expect.objectContaining({ name: 'crm_assign_company', args: expect.objectContaining({ p_user_id: 'u-sam' }) }),
    ])
  })

  it('leaves it unassigned for someone who sees everything', async () => {
    await writes.createAccount(access(['accounts.create'], true), { name: 'Acme' })
    expect(rpcCalls).toEqual([])
  })
})
