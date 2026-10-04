import 'server-only'

/**
 * Lead roles: reading them, suggesting them, and recording a person's choice.
 *
 * A role belongs to the LEAD, so a person's edit is governed by the CONTACT
 * rules — `crm.contact.edit` and `dataScope` — exactly like the rest of the
 * lead's record. Suggestions are the classifier's (`lib/crm/lead-roles.ts`)
 * and are written by `crm_apply_auto_roles` (0152), which never touches a
 * lead someone has edited by hand.
 */
import { classifyTitle, type Classifier } from '@/lib/crm/lead-roles'
import { AppError } from '@/lib/errors/catalog'
import { createAdminClient } from '@/lib/supabase/admin'
import type { WorkspaceContext } from '@/lib/workspaces/context'
import { dataScope, decidePermission } from '@/lib/workspaces/permissions'
import type { Json } from '@/types/database'

const BATCH = 200
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type LeadRole = { id: string; name: string; isActive: boolean }

export async function loadLeadRoles(workspaceId: string): Promise<LeadRole[]> {
  const { data, error } = await createAdminClient()
    .from('crm_lead_roles')
    .select('id, name, is_active')
    .eq('workspace_id', workspaceId)
    .order('sort_order')
    .order('name')
  if (error) throw new Error(`loadLeadRoles failed: ${error.message}`)
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, isActive: r.is_active }))
}

export async function loadClassifier(workspaceId: string): Promise<Classifier> {
  const db = createAdminClient()
  const [roles, rules] = await Promise.all([
    db.from('crm_lead_roles').select('id, system_key, is_active').eq('workspace_id', workspaceId),
    db
      .from('crm_lead_role_rules')
      .select('role_id, match_kind, keyword')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true),
  ])
  if (roles.error) throw new Error(`loadClassifier failed: ${roles.error.message}`)
  if (rules.error) throw new Error(`loadClassifier failed: ${rules.error.message}`)
  return {
    roles: (roles.data ?? []).map((r) => ({ id: r.id, systemKey: r.system_key, isActive: r.is_active })),
    rules: (rules.data ?? []).flatMap((r) =>
      r.match_kind === 'title' || r.match_kind === 'function'
        ? [{ roleId: r.role_id, matchKind: r.match_kind, keyword: r.keyword }]
        : [],
    ),
  }
}

export type ApplyResult = { applied: number; skippedManual: number; missing: number }

/**
 * Suggests roles for these leads from their CURRENT titles. Leads someone
 * edited by hand are skipped inside the SQL, under a lock.
 */
export async function applyAutoRoles(workspaceId: string, contactIds: string[]): Promise<ApplyResult> {
  // Sorted, so chunks lock in the same global order the SQL uses within one.
  const ids = [...new Set(contactIds)].filter((id) => UUID.test(id)).sort()
  const total: ApplyResult = { applied: 0, skippedManual: 0, missing: 0 }
  if (ids.length === 0) return total

  const classifier = await loadClassifier(workspaceId)
  const db = createAdminClient()

  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH)
    const { data: contacts, error } = await db
      .from('crm_contacts')
      .select('id, job_title')
      .eq('workspace_id', workspaceId)
      .in('id', chunk)
      .is('deleted_at', null)
    if (error) throw new Error(`applyAutoRoles failed: ${error.message}`)

    const rows = (contacts ?? []).map((c) => ({
      contact_id: c.id,
      title: c.job_title,
      role_ids: classifyTitle(c.job_title, classifier),
    }))
    if (rows.length === 0) continue

    const { data, error: rpcError } = await db.rpc('crm_apply_auto_roles', {
      p_workspace_id: workspaceId,
      p_rows: rows as unknown as Json,
    })
    if (rpcError) throw new Error(`applyAutoRoles failed: ${rpcError.message}`)
    const result = (data ?? {}) as { applied?: number; skipped_manual?: number; missing?: number }
    total.applied += result.applied ?? 0
    total.skippedManual += result.skipped_manual ?? 0
    total.missing += result.missing ?? 0
  }
  return total
}

/**
 * For the paths that bring leads in (ingestion, manual add, a workflow title
 * update). ⚠️ NEVER THROWS: a role suggestion is a convenience, and failing it
 * must not fail the import, the save or the workflow that triggered it.
 */
export async function applyAutoRolesQuietly(workspaceId: string, contactIds: string[]): Promise<void> {
  try {
    await applyAutoRoles(workspaceId, contactIds)
  } catch (error) {
    console.error('[lead-roles] suggestion skipped:', error instanceof Error ? error.message : 'unknown')
  }
}

export type ContactRoles = {
  roles: { id: string; name: string; auto: boolean; isActive: boolean }[]
  /** A person chose these; suggestions leave the lead alone. */
  manual: boolean
}

export async function getContactRoles(
  workspaceId: string,
  contactIds: string[],
  roles: LeadRole[],
): Promise<Map<string, ContactRoles>> {
  const out = new Map<string, ContactRoles>()
  if (contactIds.length === 0) return out
  const db = createAdminClient()
  const [assignments, state] = await Promise.all([
    db
      .from('crm_contact_role_assignments')
      .select('contact_id, role_id, is_auto')
      .eq('workspace_id', workspaceId)
      .in('contact_id', contactIds),
    db
      .from('crm_contact_role_state')
      .select('contact_id, manual_at')
      .eq('workspace_id', workspaceId)
      .in('contact_id', contactIds),
  ])
  if (assignments.error) throw new Error(`getContactRoles failed: ${assignments.error.message}`)
  if (state.error) throw new Error(`getContactRoles failed: ${state.error.message}`)

  const byId = new Map(roles.map((r) => [r.id, r]))
  const order = new Map(roles.map((r, i) => [r.id, i]))
  for (const id of contactIds) out.set(id, { roles: [], manual: false })
  for (const s of state.data ?? []) out.get(s.contact_id)!.manual = s.manual_at !== null
  for (const a of assignments.data ?? []) {
    const role = byId.get(a.role_id)
    if (!role) continue
    out.get(a.contact_id)?.roles.push({ id: role.id, name: role.name, auto: a.is_auto, isActive: role.isActive })
  }
  for (const entry of out.values()) entry.roles.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  return out
}

/**
 * Throws unless this member may edit this lead: `crm.contact.edit`, and — for
 * someone limited to their own contacts — the lead is theirs. An invisible
 * lead is NOT FOUND, never forbidden.
 */
export async function assertCanEditContact(ctx: WorkspaceContext, contactId: string): Promise<void> {
  if (!decidePermission({ role: ctx.role, modules: ctx.modules }, 'crm.contact.edit').allowed) {
    throw new AppError('ERR_FORBIDDEN', `crm.contact.edit user=${ctx.userId}`)
  }
  if (!UUID.test(contactId)) throw new AppError('ERR_NOT_FOUND', 'contact id')
  const { data, error } = await createAdminClient()
    .from('crm_contacts')
    .select('owner_user_id')
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', contactId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`assertCanEditContact failed: ${error.message}`)
  if (!data) throw new AppError('ERR_NOT_FOUND', `contact ${contactId}`)
  if (dataScope(ctx.role) === 'assigned' && data.owner_user_id !== ctx.userId) {
    throw new AppError('ERR_NOT_FOUND', `contact ${contactId} not visible to ${ctx.userId}`)
  }
}

/**
 * A person's choice: exactly these roles, pinned against suggestions.
 * `roleIds = null` puts the lead back on suggestions and re-runs them now.
 */
export async function setContactRoles(
  ctx: WorkspaceContext,
  contactId: string,
  roleIds: string[] | null,
): Promise<void> {
  await assertCanEditContact(ctx, contactId)
  if (roleIds && roleIds.some((id) => !UUID.test(id))) throw new AppError('ERR_VALIDATION', 'role id')

  const { error } = await createAdminClient().rpc('crm_set_contact_roles', {
    p_workspace_id: ctx.workspace.id,
    p_contact_id: contactId,
    p_role_ids: roleIds as string[],
    p_actor_id: ctx.userId,
  })
  if (error) {
    if (error.code === '23514' && error.message.startsWith('crm_set_contact_roles: ')) {
      throw new AppError('ERR_VALIDATION', error.message)
    }
    throw new Error(`setContactRoles failed: ${error.message}`)
  }

  if (roleIds === null) await applyAutoRoles(ctx.workspace.id, [contactId])
}

/**
 * Adds ONE role by its system key — "Add decision maker" — and pins the lead
 * (0154 `crm_add_contact_role`). The lead's other roles stay, now as a
 * person's choice; an "Other" is dropped because it stops being true.
 */
export async function addContactRole(
  ctx: WorkspaceContext,
  contactId: string,
  systemKey: 'decision_maker' | 'champion' | 'technical',
): Promise<void> {
  await assertCanEditContact(ctx, contactId)
  const { error } = await createAdminClient().rpc('crm_add_contact_role', {
    p_workspace_id: ctx.workspace.id,
    p_contact_id: contactId,
    p_system_key: systemKey,
    p_actor_id: ctx.userId,
  })
  if (error) {
    if (error.code === '23514' && error.message.startsWith('crm_add_contact_role: ')) {
      throw new AppError('ERR_VALIDATION', error.message)
    }
    throw new Error(`addContactRole failed: ${error.message}`)
  }
}
