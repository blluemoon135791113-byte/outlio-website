import 'server-only'

/**
 * A lead's other public profiles (0154 `crm_contact_links`). Governed by the
 * CONTACT rules like the rest of the lead's record: `crm.contact.edit`, and a
 * member limited to their own contacts may only touch theirs
 * (`assertCanEditContact`).
 */
import { recordAudit } from '@/lib/crm/activities'
import { assertCanEditContact } from '@/lib/crm/lead-role-service'
import type { SocialLink } from '@/lib/crm/social-links'
import { AppError } from '@/lib/errors/catalog'
import { createAdminClient } from '@/lib/supabase/admin'
import type { WorkspaceContext } from '@/lib/workspaces/context'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ContactLink = { id: string; kind: string; label: string | null; url: string }

/** Every link of these leads, oldest first. The caller has already scoped the ids. */
export async function listContactLinks(
  workspaceId: string,
  contactIds: string[],
): Promise<Map<string, ContactLink[]>> {
  const out = new Map<string, ContactLink[]>()
  if (contactIds.length === 0) return out
  const { data, error } = await createAdminClient()
    .from('crm_contact_links')
    .select('id, contact_id, kind, label, url')
    .eq('workspace_id', workspaceId)
    .in('contact_id', contactIds)
    .order('created_at')
    .order('id')
  if (error) throw new Error(`listContactLinks failed: ${error.message}`)
  for (const row of data ?? []) {
    const list = out.get(row.contact_id) ?? []
    list.push({ id: row.id, kind: row.kind, label: row.label, url: row.url })
    out.set(row.contact_id, list)
  }
  return out
}

/**
 * Adds links (already validated by `parseSocialLink`). An address the lead
 * already has is skipped. Returns how many were added.
 */
export async function addContactLinks(
  ctx: WorkspaceContext,
  contactId: string,
  links: SocialLink[],
): Promise<number> {
  await assertCanEditContact(ctx, contactId)
  if (links.length === 0) return 0

  const { data, error } = await createAdminClient().rpc('crm_add_contact_links', {
    p_workspace_id: ctx.workspace.id,
    p_contact_id: contactId,
    p_links: links.map((l) => ({ kind: l.kind, label: l.label, url: l.url, url_key: l.urlKey })),
    p_actor_id: ctx.userId,
    p_source: 'manual',
  })
  if (error) {
    if (error.code === '23514' && error.message.includes('at most 20 links')) {
      throw new AppError('ERR_VALIDATION', 'link cap')
    }
    throw new Error(`addContactLinks failed: ${error.message}`)
  }

  const added = data ?? 0
  if (added > 0) {
    await recordAudit(ctx.workspace.id, {
      action: 'crm.contact.links_added',
      targetType: 'crm_contact',
      targetId: contactId,
      actorUserId: ctx.userId,
      after: { kinds: links.map((l) => l.kind) },
    })
  }
  return added
}

export async function removeContactLink(ctx: WorkspaceContext, linkId: string): Promise<{ contactId: string }> {
  if (!UUID.test(linkId)) throw new AppError('ERR_NOT_FOUND', 'link id')
  const db = createAdminClient()
  const { data: link, error } = await db
    .from('crm_contact_links')
    .select('contact_id, kind')
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', linkId)
    .maybeSingle()
  if (error) throw new Error(`removeContactLink failed: ${error.message}`)
  if (!link) throw new AppError('ERR_NOT_FOUND', `link ${linkId}`)

  await assertCanEditContact(ctx, link.contact_id)

  const { error: deleteError } = await db
    .from('crm_contact_links')
    .delete()
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', linkId)
  if (deleteError) throw new Error(`removeContactLink failed: ${deleteError.message}`)

  await recordAudit(ctx.workspace.id, {
    action: 'crm.contact.link_removed',
    targetType: 'crm_contact',
    targetId: link.contact_id,
    actorUserId: ctx.userId,
    before: { kind: link.kind },
  })
  return { contactId: link.contact_id }
}
