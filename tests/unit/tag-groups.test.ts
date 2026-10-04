/**
 * Settings → Tags (0153): workspace-defined groups and values.
 *
 * The rules that protect data, each pinned:
 *   - only `config.manage` changes anything;
 *   - a value LEADS carry cannot be deleted (crm_contact_tags would cascade);
 *   - a value accounts carry, and a group with values, cannot be deleted;
 *   - names are unique within their scope, and a rename keeps the slug.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AccountAccess } from '@/lib/crm/account-access'
import type { AccountPermission } from '@/lib/crm/account-permissions'

const GROUP = '11111111-1111-4111-8111-111111111111'
const LEAD_GROUP = '33333333-3333-4333-8333-333333333333'
const VALUE = '22222222-2222-4222-8222-222222222222'

const writes: { table: string; op: string; row?: Record<string, unknown> }[] = []
const audits: string[] = []
let existingGroups: { slug: string; name: string; sort_order: number }[] = []
let siblings: { slug: string; normalized_name: string; sort_order: number }[] = []
let accountUses = 0
let leadUses = 0
let groupValueCount = 0

function table(name: string) {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  let head = false
  const eq: Record<string, unknown> = {}
  Object.assign(chain, {
    select: (_c: string, opts?: { head?: boolean }) => {
      head = Boolean(opts?.head)
      return chain
    },
    eq: (k: string, v: unknown) => {
      eq[k] = v
      return chain
    },
    is: self,
    not: self,
    order: self,
    insert: (row: Record<string, unknown>) => {
      writes.push({ table: name, op: 'insert', row })
      return chain
    },
    update: (row: Record<string, unknown>) => {
      writes.push({ table: name, op: 'update', row })
      return chain
    },
    delete: () => {
      writes.push({ table: name, op: 'delete' })
      return chain
    },
    single: () => Promise.resolve({ data: { id: 'new-id' }, error: null }),
    maybeSingle: () => {
      if (name === 'crm_tag_groups') {
        const id = String(eq.id)
        if (id === GROUP) return Promise.resolve({ data: { id, entity: 'company', name: 'Industry', slug: 'industry', has_primary: false, is_active: true, sort_order: 10 }, error: null })
        if (id === LEAD_GROUP) return Promise.resolve({ data: { id, entity: 'contact', name: 'Seniority', slug: 'seniority', has_primary: false, is_active: true, sort_order: 10 }, error: null })
        return Promise.resolve({ data: null, error: null })
      }
      if (name === 'crm_tags') {
        return Promise.resolve({
          data: eq.id === VALUE ? { id: VALUE, group_id: GROUP, entity: 'company', name: 'SaaS', slug: 'saas', description: null, aliases: [], is_active: true } : null,
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    },
    then: (resolve: (r: unknown) => unknown) => {
      if (head) {
        const count =
          name === 'crm_company_tags' ? accountUses : name === 'crm_contact_tags' ? leadUses : name === 'crm_tags' ? groupValueCount : 0
        return Promise.resolve({ data: null, count, error: null }).then(resolve)
      }
      const data = name === 'crm_tag_groups' ? existingGroups : name === 'crm_tags' ? siblings : []
      return Promise.resolve({ data, error: null }).then(resolve)
    },
  })
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (n: string) => table(n),
    // 0154 crm_delete_tag_value: the use check and the delete are ONE call.
    rpc: (name: string) => {
      if (name !== 'crm_delete_tag_value') throw new Error(`unexpected rpc ${name}`)
      if (accountUses + leadUses > 0) return Promise.resolve({ data: 'in_use', error: null })
      writes.push({ table: 'crm_tags', op: 'delete' })
      return Promise.resolve({ data: 'deleted', error: null })
    },
  }),
}))
vi.mock('@/lib/crm/activities', () => ({
  recordAudit: async (_w: string, entry: { action: string }) => {
    audits.push(entry.action)
  },
}))
vi.mock('@/lib/crm/account-access', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/crm/account-access')>()
  return { requirePermissionFor: real.requirePermissionFor }
})

const tags = await import('@/lib/crm/tag-groups')

function access(permissions: AccountPermission[]): AccountAccess {
  const granted = new Set(permissions)
  return {
    ctx: { userId: 'u1', workspace: { id: 'w1' } } as AccountAccess['ctx'],
    granted,
    can: (p) => granted.has(p),
    viewAll: true,
  }
}
const ADMIN = access(['config.manage'])

beforeEach(() => {
  writes.length = 0
  audits.length = 0
  existingGroups = []
  siblings = []
  accountUses = 0
  leadUses = 0
  groupValueCount = 0
})

describe('slugs and names', () => {
  it('slugify keeps letters and digits, joins the rest with single dashes', () => {
    expect(tags.slugify('Hospital / Health System')).toBe('hospital-health-system')
    expect(tags.slugify('  R&D  ')).toBe('r-and-d')
    expect(tags.slugify('Ünïcödé Café')).toBe('unicode-cafe')
    expect(tags.slugify('!!!')).toBe('')
  })

  it('names compare lowercased and space-collapsed', () => {
    expect(tags.normalizeName('  SaaS   Platform ')).toBe('saas platform')
  })
})

describe('only config.manage changes anything', () => {
  it.each([
    ['createTagGroup', () => tags.createTagGroup(access(['accounts.edit_tags']), { entity: 'company', name: 'X' })],
    ['updateTagGroup', () => tags.updateTagGroup(access([]), GROUP, { name: 'X' })],
    ['deleteTagGroup', () => tags.deleteTagGroup(access(['accounts.delete']), GROUP)],
    ['createTagValue', () => tags.createTagValue(access(['accounts.edit']), GROUP, { name: 'X' })],
    ['deleteTagValue', () => tags.deleteTagValue(access(['accounts.edit_tags']), VALUE)],
  ])('%s is refused without it', async (_name, call) => {
    await expect(call()).rejects.toMatchObject({ code: 'ERR_FORBIDDEN' })
    expect(writes).toEqual([])
  })
})

describe('groups', () => {
  it('creates with a slug from the name, after the last group', async () => {
    existingGroups = [{ slug: 'region', name: 'Region', sort_order: 30 }]
    await tags.createTagGroup(ADMIN, { entity: 'company', name: 'Industry', hasPrimary: true })
    expect(writes[0]).toMatchObject({
      table: 'crm_tag_groups',
      op: 'insert',
      row: { entity: 'company', name: 'Industry', slug: 'industry', has_primary: true, sort_order: 40 },
    })
    expect(audits).toEqual(['crm.tag_group.created'])
  })

  it('a taken slug gets a suffix; a taken NAME is refused', async () => {
    existingGroups = [{ slug: 'industry', name: 'Industries!', sort_order: 10 }]
    await tags.createTagGroup(ADMIN, { entity: 'company', name: 'Industry' })
    expect(writes[0]!.row).toMatchObject({ slug: 'industry-2' })

    writes.length = 0
    existingGroups = [{ slug: 'industry', name: 'industry', sort_order: 10 }]
    await expect(tags.createTagGroup(ADMIN, { entity: 'company', name: 'INDUSTRY' })).rejects.toMatchObject({
      code: 'ERR_VALIDATION',
    })
    expect(writes).toEqual([])
  })

  it('a lead group cannot have a primary', async () => {
    await tags.createTagGroup(ADMIN, { entity: 'contact', name: 'Seniority', hasPrimary: true })
    expect(writes[0]!.row).toMatchObject({ has_primary: false })
    await expect(tags.updateTagGroup(ADMIN, LEAD_GROUP, { hasPrimary: true })).rejects.toMatchObject({
      code: 'ERR_VALIDATION',
    })
  })

  it('a primary can be required only before accounts use the group', async () => {
    accountUses = 2
    await expect(tags.updateTagGroup(ADMIN, GROUP, { hasPrimary: true })).rejects.toMatchObject({
      code: 'ERR_VALIDATION',
    })
    expect(writes).toEqual([])

    accountUses = 0
    await tags.updateTagGroup(ADMIN, GROUP, { hasPrimary: true })
    expect(writes[0]).toEqual({ table: 'crm_tag_groups', op: 'update', row: { has_primary: true } })
  })

  it('a rename changes the name, never the slug', async () => {
    await tags.updateTagGroup(ADMIN, GROUP, { name: 'Vertical' })
    expect(writes[0]).toEqual({ table: 'crm_tag_groups', op: 'update', row: { name: 'Vertical' } })
  })

  it('a group with values cannot be deleted', async () => {
    groupValueCount = 3
    await expect(tags.deleteTagGroup(ADMIN, GROUP)).rejects.toMatchObject({ code: 'ERR_VALIDATION' })
    expect(writes).toEqual([])
  })

  it('an empty group can', async () => {
    await tags.deleteTagGroup(ADMIN, GROUP)
    expect(writes).toEqual([{ table: 'crm_tag_groups', op: 'delete' }])
  })

  it('a name of only punctuation is refused', async () => {
    await expect(tags.createTagGroup(ADMIN, { entity: 'company', name: '---' })).rejects.toMatchObject({
      code: 'ERR_VALIDATION',
    })
  })
})

describe('values', () => {
  it('creates in the group with its entity, aliases de-duplicated', async () => {
    siblings = [{ slug: 'fintech', normalized_name: 'fintech', sort_order: 10 }]
    await tags.createTagValue(ADMIN, GROUP, { name: 'SaaS', description: 'Software as a service', aliases: 'Software, software; SaaS platform' })
    expect(writes[0]).toMatchObject({
      table: 'crm_tags',
      op: 'insert',
      row: {
        entity: 'company',
        group_id: GROUP,
        name: 'SaaS',
        normalized_name: 'saas',
        slug: 'saas',
        description: 'Software as a service',
        aliases: ['Software', 'SaaS platform'],
        sort_order: 20,
      },
    })
  })

  it('a duplicate name in the same group is refused', async () => {
    siblings = [{ slug: 'saas', normalized_name: 'saas', sort_order: 10 }]
    await expect(tags.createTagValue(ADMIN, GROUP, { name: 'SAAS' })).rejects.toMatchObject({ code: 'ERR_VALIDATION' })
    expect(writes).toEqual([])
  })

  /*
   * ⚠️ THE ONE A FOREIGN KEY DOES NOT CATCH. crm_contact_tags cascades on a
   * tag delete (0071), so deleting a value leads carry would silently strip
   * it from every one of them. crm_delete_tag_value (0154) refuses it in the
   * same statement as the delete — its smoke test covers the race.
   */
  it('a value LEADS carry cannot be deleted', async () => {
    leadUses = 4
    await expect(tags.deleteTagValue(ADMIN, VALUE)).rejects.toMatchObject({ code: 'ERR_VALIDATION' })
    expect(writes).toEqual([])
  })

  it('a value ACCOUNTS carry cannot be deleted', async () => {
    accountUses = 1
    await expect(tags.deleteTagValue(ADMIN, VALUE)).rejects.toMatchObject({ code: 'ERR_VALIDATION' })
    expect(writes).toEqual([])
  })

  it('an unused value can be deleted, and it is audited', async () => {
    await tags.deleteTagValue(ADMIN, VALUE)
    expect(writes).toEqual([{ table: 'crm_tags', op: 'delete' }])
    expect(audits).toEqual(['crm.tag_value.deleted'])
  })

  it('a rename keeps the slug and updates the comparison name', async () => {
    await tags.updateTagValue(ADMIN, VALUE, { name: 'Software' })
    expect(writes[0]).toEqual({ table: 'crm_tags', op: 'update', row: { name: 'Software', normalized_name: 'software' } })
  })

  it('an unknown or malformed id is not found', async () => {
    await expect(tags.updateTagValue(ADMIN, 'not-a-uuid', { name: 'X' })).rejects.toMatchObject({ code: 'ERR_NOT_FOUND' })
    await expect(
      tags.updateTagValue(ADMIN, '99999999-9999-4999-8999-999999999999', { name: 'X' }),
    ).rejects.toMatchObject({ code: 'ERR_NOT_FOUND' })
  })
})
