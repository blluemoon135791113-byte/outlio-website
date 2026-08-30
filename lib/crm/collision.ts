import 'server-only'

/**
 * Outreach collision guard (M3 Phase 8).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  NOT THE SAME QUESTION AS DEDUPLICATION.                                 ║
 * ║                                                                          ║
 * ║  Dedup (M2 Phase 4) asks "are these two records the same person?"        ║
 * ║  This asks "is a TEAMMATE already working this one?"                     ║
 * ║                                                                          ║
 * ║  One record, one real person, two setters about to email them in the     ║
 * ║  same week: nothing is duplicated and the prospect is still pitched      ║
 * ║  twice by the same company.                                             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ A COLLISION IS NOT "SOMEONE ELSE OWNS THIS". Ownership alone is a filing
 * decision — half a CRM is assigned to people who have never touched it. A
 * collision needs ownership AND recent activity, or every import creates
 * thousands of false warnings on its first day and the guard is switched off.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

export type CollisionMode = Database['public']['Enums']['crm_collision_mode']

export type CollisionSettings = {
  contactMode: CollisionMode
  companyMode: CollisionMode
  activeWithinDays: number
}

/**
 * Defaults for a workspace with no settings row.
 *
 * ⚠️ Mirrors the column defaults in migration 0079. A workspace that has never
 * opened the settings page is still guarded — absence must not mean "off".
 */
export const DEFAULT_COLLISION_SETTINGS: CollisionSettings = {
  contactMode: 'warn',
  companyMode: 'off',
  activeWithinDays: 30,
}

export type CollisionParty = {
  ownerUserId: string
  ownerName: string | null
  contactId: string
  contactName: string | null
  lastActivityAt: string | null
  lastActivityType: string | null
  openOpportunities: number
}

export type CollisionReport = {
  settings: CollisionSettings
  /** The person themselves is owned and active elsewhere. */
  contact: CollisionParty | null
  /** Colleagues working OTHER people at the same company. */
  company: { companyId: string; companyName: string | null; parties: CollisionParty[] } | null
  /**
   * `true` when the workspace requires approval and a collision exists. The
   * caller must refuse the action, not merely warn.
   */
  blocked: boolean
  /** `true` when there is anything to show at all. */
  hasCollision: boolean
}

export async function getCollisionSettings(workspaceId: string): Promise<CollisionSettings> {
  const { data, error } = await createAdminClient()
    .from('crm_collision_settings')
    .select('contact_mode, company_mode, active_within_days')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (error) throw new Error(`getCollisionSettings failed: ${error.message}`)
  if (!data) return DEFAULT_COLLISION_SETTINGS

  return {
    contactMode: data.contact_mode,
    companyMode: data.company_mode,
    activeWithinDays: data.active_within_days,
  }
}

/**
 * Asks whether a teammate is already working this person, or their company.
 *
 * Called before assigning a contact and before first outreach. Returns a
 * report; it never blocks anything itself, because the same answer drives a
 * warning banner, a refusal, and a "request reassignment" button.
 */
export async function checkCollision(
  workspaceId: string,
  contactId: string,
  actorUserId: string,
): Promise<CollisionReport> {
  const db = createAdminClient()
  const settings = await getCollisionSettings(workspaceId)

  const { data: contact, error } = await db
    .from('crm_contacts')
    .select('id, full_name, owner_user_id, primary_company_id')
    .eq('workspace_id', workspaceId)
    .eq('id', contactId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw new Error(`checkCollision failed: ${error.message}`)
  if (!contact) {
    return { settings, contact: null, company: null, blocked: false, hasCollision: false }
  }

  const since = new Date(
    Date.now() - settings.activeWithinDays * 86_400_000,
  ).toISOString()

  // ---- the person themselves ----------------------------------------------
  let contactCollision: CollisionParty | null = null

  if (
    settings.contactMode !== 'off' &&
    contact.owner_user_id &&
    contact.owner_user_id !== actorUserId
  ) {
    const activity = await lastActivity(workspaceId, contact.id, since)
    // Owned by someone else AND touched recently. Ownership without activity
    // is a filing decision, not a collision.
    if (activity) {
      contactCollision = {
        ownerUserId: contact.owner_user_id,
        ownerName: await displayName(contact.owner_user_id),
        contactId: contact.id,
        contactName: contact.full_name,
        lastActivityAt: activity.occurredAt,
        lastActivityType: activity.activityType,
        openOpportunities: await openOpportunityCount(workspaceId, contact.id),
      }
    }
  }

  // ---- other people at the same company -----------------------------------
  let companyCollision: CollisionReport['company'] = null

  if (settings.companyMode !== 'off' && contact.primary_company_id) {
    const { data: siblings, error: siblingError } = await db
      .from('crm_contacts')
      .select('id, full_name, owner_user_id')
      .eq('workspace_id', workspaceId)
      .eq('primary_company_id', contact.primary_company_id)
      .neq('id', contact.id)
      .not('owner_user_id', 'is', null)
      .neq('owner_user_id', actorUserId)
      .is('deleted_at', null)
      // Bounded: a 5,000-person account must not be scanned to render a
      // warning banner. Showing three colleagues makes the point.
      .limit(25)

    if (siblingError) throw new Error(`checkCollision failed: ${siblingError.message}`)

    const parties: CollisionParty[] = []
    for (const sibling of siblings ?? []) {
      const activity = await lastActivity(workspaceId, sibling.id, since)
      if (!activity || !sibling.owner_user_id) continue
      parties.push({
        ownerUserId: sibling.owner_user_id,
        ownerName: await displayName(sibling.owner_user_id),
        contactId: sibling.id,
        contactName: sibling.full_name,
        lastActivityAt: activity.occurredAt,
        lastActivityType: activity.activityType,
        openOpportunities: 0,
      })
      if (parties.length >= 3) break
    }

    if (parties.length > 0) {
      const { data: company } = await db
        .from('crm_companies')
        .select('id, name')
        .eq('workspace_id', workspaceId)
        .eq('id', contact.primary_company_id)
        .maybeSingle()

      companyCollision = {
        companyId: contact.primary_company_id,
        companyName: company?.name ?? null,
        parties,
      }
    }
  }

  const blocked =
    (contactCollision !== null && settings.contactMode === 'require_approval') ||
    (companyCollision !== null && settings.companyMode === 'require_approval')

  return {
    settings,
    contact: contactCollision,
    company: companyCollision,
    blocked,
    hasCollision: contactCollision !== null || companyCollision !== null,
  }
}

async function lastActivity(
  workspaceId: string,
  contactId: string,
  since: string,
): Promise<{ occurredAt: string; activityType: string } | null> {
  const { data, error } = await createAdminClient()
    .from('crm_activities')
    .select('occurred_at, activity_type')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`lastActivity failed: ${error.message}`)
  if (!data) return null
  return { occurredAt: data.occurred_at, activityType: data.activity_type }
}

async function openOpportunityCount(workspaceId: string, contactId: string): Promise<number> {
  const { count, error } = await createAdminClient()
    .from('crm_opportunities')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .eq('status', 'open')
    .is('deleted_at', null)

  if (error) throw new Error(`openOpportunityCount failed: ${error.message}`)
  return count ?? 0
}

async function displayName(userId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from('profiles')
    .select('full_name, email')
    .eq('id', userId)
    .maybeSingle()

  // A name if we have one, else the address — "someone is working this" is
  // useless without saying who.
  return data?.full_name?.trim() || data?.email || null
}

// ---------------------------------------------------------------------------
// Acting on a collision
// ---------------------------------------------------------------------------

/**
 * Records that someone proceeded anyway.
 *
 * ⚠️ THE ACTIVITY AND THE AUDIT ROW ARE WRITTEN BY ONE FUNCTION, so it is both
 * or neither. Two records that disagree about whether an override happened are
 * worse than one that is missing.
 */
export async function recordCollisionOverride(
  workspaceId: string,
  contactId: string,
  actorUserId: string,
  reason?: string,
): Promise<string> {
  const { data, error } = await createAdminClient().rpc('crm_record_collision_override', {
    p_workspace_id: workspaceId,
    p_contact_id: contactId,
    p_actor_id: actorUserId,
    ...(reason ? { p_reason: reason } : {}),
  })

  if (error) throw new Error(`recordCollisionOverride failed: ${error.message}`)
  return data as unknown as string
}

export class DuplicateRequestError extends Error {}

/**
 * Asks the current owner for the record — the polite alternative to stepping
 * over the warning.
 */
export async function requestReassignment(
  workspaceId: string,
  contactId: string,
  requestedBy: string,
  note?: string,
): Promise<string> {
  const db = createAdminClient()

  const { data: contact, error: readError } = await db
    .from('crm_contacts')
    .select('owner_user_id')
    .eq('workspace_id', workspaceId)
    .eq('id', contactId)
    .is('deleted_at', null)
    .maybeSingle()

  if (readError) throw new Error(`requestReassignment failed: ${readError.message}`)
  if (!contact) throw new Error('requestReassignment: no such contact in this workspace')

  const { data, error } = await db
    .from('crm_reassignment_requests')
    .insert({
      workspace_id: workspaceId,
      contact_id: contactId,
      requested_by: requestedBy,
      // Frozen: the owner can change while the request sits pending, and it
      // still has to be readable afterwards.
      current_owner_user_id: contact.owner_user_id,
      note: note?.trim() || null,
    })
    .select('id')
    .single()

  if (error) {
    // The partial unique index on pending requests. Asking twice is not a
    // second request.
    if (error.code === '23505') {
      throw new DuplicateRequestError('You have already asked for this contact.')
    }
    throw new Error(`requestReassignment failed: ${error.message}`)
  }

  return data.id
}

/**
 * Approves or declines a request.
 *
 * Approving REASSIGNS the contact, through `assignContact`, so the change lands
 * on the activity stream like any other handover rather than as a silent
 * update — a reassignment nobody can see in the timeline is one nobody can
 * report on.
 */
export async function resolveReassignment(
  workspaceId: string,
  requestId: string,
  decision: 'approved' | 'declined',
  resolvedBy: string,
): Promise<void> {
  const db = createAdminClient()

  const { data: request, error } = await db
    .from('crm_reassignment_requests')
    .update({
      status: decision,
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy,
    })
    .eq('workspace_id', workspaceId)
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('contact_id, requested_by')
    .maybeSingle()

  if (error) throw new Error(`resolveReassignment failed: ${error.message}`)
  if (!request) return

  if (decision === 'approved' && request.requested_by) {
    const { assignContact } = await import('@/lib/crm/activities')
    await assignContact(workspaceId, request.contact_id, request.requested_by, resolvedBy)
  }
}
