import 'server-only'

/**
 * Workspace tag groups and their values (0153) — the Settings → Tags service.
 *
 * Every workspace defines its own groups ("Industry", "Product", "Region", …)
 * for accounts or for leads. Each group is a chip row; its values are rows of
 * `crm_tags`, the same table the CRM's lead tags have always used.
 *
 * ⚠️ EVERY WRITE NEEDS `config.manage`, CHECKED HERE. These are workspace
 * configuration: renaming a value relabels it on every account at once.
 *
 * ⚠️ DELETE ONLY WHAT NOTHING USES. A value on an account is protected by the
 * database (RESTRICT). A value on a LEAD is not — `crm_contact_tags` cascades
 * (0071) — so that check is made here, or deleting a lead tag value would
 * silently strip it from every lead. Disable is always available instead.
 */
import { requirePermissionFor, type AccountAccess } from '@/lib/crm/account-access'
import { recordAudit } from '@/lib/crm/activities'
import { AppError } from '@/lib/errors/catalog'
import { createAdminClient } from '@/lib/supabase/admin'

export type TagEntity = 'company' | 'contact'

export type TagValue = {
  id: string
  groupId: string
  name: string
  slug: string
  description: string | null
  aliases: string[]
  isActive: boolean
  sortOrder: number
}

export type TagGroup = {
  id: string
  entity: TagEntity
  name: string
  slug: string
  hasPrimary: boolean
  isActive: boolean
  sortOrder: number
  values: TagValue[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'

/** "Hospital / Health System" → "hospital-health-system". Empty when nothing usable is left. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '')
}

/** How names are compared: lowercased and space-collapsed, as `crm_tags.normalized_name` has always been. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

function cleanName(raw: unknown, max: number): string {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
  if (name.length < 1 || name.length > max) {
    throw new AppError('ERR_VALIDATION', `name length must be 1..${max}`)
  }
  if (!slugify(name)) throw new AppError('ERR_VALIDATION', 'name has no letters or digits')
  return name
}

/** A slug free in its scope: `name`, then `name-2`, `name-3`… */
function freeSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base.slice(0, 60)}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  throw new AppError('ERR_VALIDATION', 'too many similar names')
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Every group of one entity with its values, active and disabled, in display order. */
export async function listTagGroups(workspaceId: string, entity: TagEntity): Promise<TagGroup[]> {
  const db = createAdminClient()
  const [groups, values] = await Promise.all([
    db
      .from('crm_tag_groups')
      .select('id, entity, name, slug, has_primary, is_active, sort_order')
      .eq('workspace_id', workspaceId)
      .eq('entity', entity)
      .order('sort_order')
      .order('name'),
    db
      .from('crm_tags')
      .select('id, group_id, name, slug, description, aliases, is_active, sort_order')
      .eq('workspace_id', workspaceId)
      .eq('entity', entity)
      .not('group_id', 'is', null)
      .is('deleted_at', null)
      .order('sort_order')
      .order('name'),
  ])
  if (groups.error) throw new Error(`listTagGroups failed: ${groups.error.message}`)
  if (values.error) throw new Error(`listTagGroups failed: ${values.error.message}`)

  const byGroup = new Map<string, TagValue[]>()
  for (const v of values.data ?? []) {
    if (!v.group_id || !v.slug) continue
    const list = byGroup.get(v.group_id) ?? []
    list.push({
      id: v.id,
      groupId: v.group_id,
      name: v.name,
      slug: v.slug,
      description: v.description,
      aliases: v.aliases ?? [],
      isActive: v.is_active,
      sortOrder: v.sort_order,
    })
    byGroup.set(v.group_id, list)
  }

  return (groups.data ?? []).map((g) => ({
    id: g.id,
    entity: g.entity === 'contact' ? 'contact' : 'company',
    name: g.name,
    slug: g.slug,
    hasPrimary: g.has_primary,
    isActive: g.is_active,
    sortOrder: g.sort_order,
    values: byGroup.get(g.id) ?? [],
  }))
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

async function groupOf(workspaceId: string, groupId: string) {
  if (!UUID.test(groupId)) throw new AppError('ERR_NOT_FOUND', 'group id')
  const { data, error } = await createAdminClient()
    .from('crm_tag_groups')
    .select('id, entity, name, slug, has_primary, is_active, sort_order')
    .eq('workspace_id', workspaceId)
    .eq('id', groupId)
    .maybeSingle()
  if (error) throw new Error(`groupOf failed: ${error.message}`)
  if (!data) throw new AppError('ERR_NOT_FOUND', `group ${groupId}`)
  return data
}

export async function createTagGroup(
  access: AccountAccess,
  input: { entity: unknown; name: unknown; hasPrimary?: unknown },
): Promise<{ id: string }> {
  requirePermissionFor(access, 'config.manage')
  const entity: TagEntity = input.entity === 'contact' ? 'contact' : input.entity === 'company' ? 'company' : (() => {
    throw new AppError('ERR_VALIDATION', 'entity')
  })()
  const name = cleanName(input.name, 60)
  const hasPrimary = entity === 'company' && input.hasPrimary === true
  const workspaceId = access.ctx.workspace.id
  const db = createAdminClient()

  const { data: existing, error: readError } = await db
    .from('crm_tag_groups')
    .select('slug, name, sort_order')
    .eq('workspace_id', workspaceId)
    .eq('entity', entity)
  if (readError) throw new Error(`createTagGroup failed: ${readError.message}`)
  if ((existing ?? []).some((g) => normalizeName(g.name) === normalizeName(name))) {
    throw new AppError('ERR_VALIDATION', 'a group with that name exists')
  }

  const slug = freeSlug(slugify(name), new Set((existing ?? []).map((g) => g.slug)))
  const sortOrder = Math.max(0, ...(existing ?? []).map((g) => g.sort_order)) + 10

  const { data, error } = await db
    .from('crm_tag_groups')
    .insert({
      workspace_id: workspaceId,
      entity,
      name,
      slug,
      has_primary: hasPrimary,
      sort_order: sortOrder,
      created_by: access.ctx.userId,
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new AppError('ERR_VALIDATION', 'a group with that name exists')
    throw new Error(`createTagGroup failed: ${error.message}`)
  }

  await recordAudit(workspaceId, {
    action: 'crm.tag_group.created',
    targetType: 'crm_tag_group',
    targetId: data.id,
    actorUserId: access.ctx.userId,
    after: { entity, name, hasPrimary },
  })
  return { id: data.id }
}

/**
 * Rename, toggle, or switch "primary" on a group. ⚠️ THE SLUG DOES NOT CHANGE
 * ON RENAME — bookmarked and shared filter links keep working.
 */
export async function updateTagGroup(
  access: AccountAccess,
  groupId: string,
  patch: { name?: unknown; isActive?: unknown; hasPrimary?: unknown },
): Promise<void> {
  requirePermissionFor(access, 'config.manage')
  const workspaceId = access.ctx.workspace.id
  const group = await groupOf(workspaceId, groupId)

  const update: { name?: string; is_active?: boolean; has_primary?: boolean } = {}
  if (patch.name !== undefined) update.name = cleanName(patch.name, 60)
  if (typeof patch.isActive === 'boolean') update.is_active = patch.isActive
  if (typeof patch.hasPrimary === 'boolean') {
    if (patch.hasPrimary && group.entity !== 'company') throw new AppError('ERR_VALIDATION', 'primary is for account groups')
    // Switching it ON for a group accounts already use would leave every one of
    // them without a primary — nothing chooses one for them, by design.
    if (patch.hasPrimary && !group.has_primary) {
      const { count, error } = await createAdminClient()
        .from('crm_company_tags')
        .select('company_id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('group_id', groupId)
      if (error) throw new Error(`updateTagGroup failed: ${error.message}`)
      if ((count ?? 0) > 0) throw new AppError('ERR_VALIDATION', 'already tagged accounts')
    }
    update.has_primary = patch.hasPrimary
  }
  if (Object.keys(update).length === 0) return

  const { error } = await createAdminClient()
    .from('crm_tag_groups')
    .update(update)
    .eq('workspace_id', workspaceId)
    .eq('id', groupId)
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new AppError('ERR_VALIDATION', 'a group with that name exists')
    throw new Error(`updateTagGroup failed: ${error.message}`)
  }

  await recordAudit(workspaceId, {
    action: 'crm.tag_group.updated',
    targetType: 'crm_tag_group',
    targetId: groupId,
    actorUserId: access.ctx.userId,
    before: { name: group.name, isActive: group.is_active, hasPrimary: group.has_primary },
    after: update,
  })
}

/** Only an EMPTY group can be deleted. One with values is disabled instead. */
export async function deleteTagGroup(access: AccountAccess, groupId: string): Promise<void> {
  requirePermissionFor(access, 'config.manage')
  const workspaceId = access.ctx.workspace.id
  const group = await groupOf(workspaceId, groupId)
  const db = createAdminClient()

  const { count, error: countError } = await db
    .from('crm_tags')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('group_id', groupId)
  if (countError) throw new Error(`deleteTagGroup failed: ${countError.message}`)
  if ((count ?? 0) > 0) throw new AppError('ERR_VALIDATION', 'group still has values')

  const { error } = await db.from('crm_tag_groups').delete().eq('workspace_id', workspaceId).eq('id', groupId)
  if (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) throw new AppError('ERR_VALIDATION', 'group still has values')
    throw new Error(`deleteTagGroup failed: ${error.message}`)
  }

  await recordAudit(workspaceId, {
    action: 'crm.tag_group.deleted',
    targetType: 'crm_tag_group',
    targetId: groupId,
    actorUserId: access.ctx.userId,
    before: { name: group.name, entity: group.entity },
  })
}

/** Moves a group one place up or down within its entity. */
export async function moveTagGroup(access: AccountAccess, groupId: string, direction: 'up' | 'down'): Promise<void> {
  requirePermissionFor(access, 'config.manage')
  const workspaceId = access.ctx.workspace.id
  const group = await groupOf(workspaceId, groupId)
  const { data, error } = await createAdminClient()
    .from('crm_tag_groups')
    .select('id, sort_order, name')
    .eq('workspace_id', workspaceId)
    .eq('entity', group.entity)
    .order('sort_order')
    .order('name')
  if (error) throw new Error(`moveTagGroup failed: ${error.message}`)
  await reorder('crm_tag_groups', workspaceId, data ?? [], groupId, direction)
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

async function valueOf(workspaceId: string, valueId: string) {
  if (!UUID.test(valueId)) throw new AppError('ERR_NOT_FOUND', 'value id')
  const { data, error } = await createAdminClient()
    .from('crm_tags')
    .select('id, group_id, entity, name, slug, description, aliases, is_active')
    .eq('workspace_id', workspaceId)
    .eq('id', valueId)
    .not('group_id', 'is', null)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`valueOf failed: ${error.message}`)
  if (!data || !data.group_id) throw new AppError('ERR_NOT_FOUND', `value ${valueId}`)
  return { ...data, group_id: data.group_id }
}

function cleanAliases(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[;,|\n]/) : []
  const out: string[] = []
  for (const item of list) {
    const alias = typeof item === 'string' ? item.trim().replace(/\s+/g, ' ') : ''
    if (alias && alias.length <= 60 && !out.some((a) => normalizeName(a) === normalizeName(alias))) out.push(alias)
  }
  if (out.length > 20) throw new AppError('ERR_VALIDATION', 'at most 20 aliases')
  return out
}

function cleanDescription(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text.length > 200) throw new AppError('ERR_VALIDATION', 'description too long')
  return text || null
}

export async function createTagValue(
  access: AccountAccess,
  groupId: string,
  input: { name: unknown; description?: unknown; aliases?: unknown },
): Promise<{ id: string }> {
  requirePermissionFor(access, 'config.manage')
  const workspaceId = access.ctx.workspace.id
  const group = await groupOf(workspaceId, groupId)
  const name = cleanName(input.name, 60)
  const db = createAdminClient()

  const { data: siblings, error: readError } = await db
    .from('crm_tags')
    .select('slug, normalized_name, sort_order')
    .eq('workspace_id', workspaceId)
    .eq('group_id', groupId)
    .is('deleted_at', null)
  if (readError) throw new Error(`createTagValue failed: ${readError.message}`)
  if ((siblings ?? []).some((s) => s.normalized_name === normalizeName(name))) {
    throw new AppError('ERR_VALIDATION', 'that value exists in this group')
  }

  const { data, error } = await db
    .from('crm_tags')
    .insert({
      workspace_id: workspaceId,
      entity: group.entity,
      group_id: groupId,
      name,
      normalized_name: normalizeName(name),
      slug: freeSlug(slugify(name), new Set((siblings ?? []).map((s) => s.slug).filter((s): s is string => Boolean(s)))),
      description: cleanDescription(input.description),
      aliases: cleanAliases(input.aliases),
      sort_order: Math.max(0, ...(siblings ?? []).map((s) => s.sort_order)) + 10,
      created_by: access.ctx.userId,
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new AppError('ERR_VALIDATION', 'that value exists in this group')
    throw new Error(`createTagValue failed: ${error.message}`)
  }

  await recordAudit(workspaceId, {
    action: 'crm.tag_value.created',
    targetType: 'crm_tag',
    targetId: data.id,
    actorUserId: access.ctx.userId,
    after: { group: group.name, name },
  })
  return { id: data.id }
}

/** Rename (the slug stays), describe, alias, enable or disable a value. */
export async function updateTagValue(
  access: AccountAccess,
  valueId: string,
  patch: { name?: unknown; description?: unknown; aliases?: unknown; isActive?: unknown },
): Promise<void> {
  requirePermissionFor(access, 'config.manage')
  const workspaceId = access.ctx.workspace.id
  const value = await valueOf(workspaceId, valueId)

  const update: {
    name?: string
    normalized_name?: string
    description?: string | null
    aliases?: string[]
    is_active?: boolean
  } = {}
  if (patch.name !== undefined) {
    update.name = cleanName(patch.name, 60)
    update.normalized_name = normalizeName(update.name)
  }
  if (patch.description !== undefined) update.description = cleanDescription(patch.description)
  if (patch.aliases !== undefined) update.aliases = cleanAliases(patch.aliases)
  if (typeof patch.isActive === 'boolean') update.is_active = patch.isActive
  if (Object.keys(update).length === 0) return

  const { error } = await createAdminClient()
    .from('crm_tags')
    .update(update)
    .eq('workspace_id', workspaceId)
    .eq('id', valueId)
  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new AppError('ERR_VALIDATION', 'that value exists in this group')
    throw new Error(`updateTagValue failed: ${error.message}`)
  }

  await recordAudit(workspaceId, {
    action: 'crm.tag_value.updated',
    targetType: 'crm_tag',
    targetId: valueId,
    actorUserId: access.ctx.userId,
    before: { name: value.name, isActive: value.is_active },
    after: update,
  })
}

/** Only a value NOTHING carries — no account and no lead — can be deleted. */
export async function deleteTagValue(access: AccountAccess, valueId: string): Promise<void> {
  requirePermissionFor(access, 'config.manage')
  const workspaceId = access.ctx.workspace.id
  const value = await valueOf(workspaceId, valueId)
  /*
   * ⚠️ ONE STATEMENT (0154 `crm_delete_tag_value`). Counting uses and then
   * deleting were two, and crm_contact_tags CASCADES: a lead tagged in between
   * lost the tag silently. The function locks the value against new taggings
   * while it checks.
   */
  const { data, error } = await createAdminClient().rpc('crm_delete_tag_value', {
    p_workspace_id: workspaceId,
    p_tag_id: valueId,
  })
  if (error) throw new Error(`deleteTagValue failed: ${error.message}`)
  if (data === 'in_use') throw new AppError('ERR_VALIDATION', 'value is in use')
  if (data !== 'deleted') throw new AppError('ERR_NOT_FOUND', `value ${valueId}`)

  await recordAudit(workspaceId, {
    action: 'crm.tag_value.deleted',
    targetType: 'crm_tag',
    targetId: valueId,
    actorUserId: access.ctx.userId,
    before: { name: value.name },
  })
}

export async function moveTagValue(access: AccountAccess, valueId: string, direction: 'up' | 'down'): Promise<void> {
  requirePermissionFor(access, 'config.manage')
  const workspaceId = access.ctx.workspace.id
  const value = await valueOf(workspaceId, valueId)
  const { data, error } = await createAdminClient()
    .from('crm_tags')
    .select('id, sort_order, name')
    .eq('workspace_id', workspaceId)
    .eq('group_id', value.group_id)
    .is('deleted_at', null)
    .order('sort_order')
    .order('name')
  if (error) throw new Error(`moveTagValue failed: ${error.message}`)
  await reorder('crm_tags', workspaceId, data ?? [], valueId, direction)
}

/**
 * Swaps one row with its neighbour by rewriting the list's order as 10, 20, 30…
 * Rewriting the whole (short) list rather than swapping two numbers repairs
 * ties left by earlier inserts, which would otherwise make "up" do nothing.
 */
async function reorder(
  table: 'crm_tag_groups' | 'crm_tags',
  workspaceId: string,
  rows: { id: string }[],
  id: string,
  direction: 'up' | 'down',
): Promise<void> {
  const index = rows.findIndex((r) => r.id === id)
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || target < 0 || target >= rows.length) return
  const order = rows.map((r) => r.id)
  ;[order[index], order[target]] = [order[target]!, order[index]!]

  const db = createAdminClient()
  for (let i = 0; i < order.length; i += 1) {
    const { error } = await db
      .from(table)
      .update({ sort_order: (i + 1) * 10 })
      .eq('workspace_id', workspaceId)
      .eq('id', order[i]!)
    if (error) throw new Error(`reorder failed: ${error.message}`)
  }
}
