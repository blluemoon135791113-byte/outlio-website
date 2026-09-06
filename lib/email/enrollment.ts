import 'server-only'

/**
 * Bulk enrollment — M6 Phase 18.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  EVERY SKIPPED CONTACT IS REPORTED WITH A REASON.                        ║
 * ║                                                                           ║
 * ║  The tempting shape is `enrolled: 28`. It is a lie by omission when 40    ║
 * ║  were selected: the customer believes 40 people are being contacted,      ║
 * ║  builds a forecast on it, and finds out weeks later that 12 had no email  ║
 * ║  address. Worse, they cannot tell WHICH 12 without exporting and diffing. ║
 * ║                                                                           ║
 * ║  So every contact gets an outcome, and the reasons are distinct enough to ║
 * ║  act on — "no email address" is a data problem, "already enrolled" is     ║
 * ║  fine, and "owned by someone else" is a conversation to have.            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { policyFor, type CampaignType } from '@/lib/email/campaign-policy'
import { createAdminClient } from '@/lib/supabase/admin'

export type SkipReason =
  | 'no_email'
  | 'suppressed'
  | 'already_enrolled'
  | 'collision'
  | 'campaign_not_enrollable'
  | 'deleted'

export type EnrollmentOutcome =
  | { contactId: string; enrolled: true; enrollmentId: string; email: string }
  | { contactId: string; enrolled: false; reason: SkipReason; detail: string }

export type BulkEnrollResult = {
  enrolled: number
  skipped: number
  outcomes: EnrollmentOutcome[]
  /** Counts per reason, for the summary line. */
  skippedByReason: Record<SkipReason, number>
}

const EMPTY_REASONS: Record<SkipReason, number> = {
  no_email: 0,
  suppressed: 0,
  already_enrolled: 0,
  collision: 0,
  campaign_not_enrollable: 0,
  deleted: 0,
}

export type BulkEnrollInput = {
  workspaceId: string
  campaignId: string
  contactIds: string[]
  /** Who is doing the enrolling — used for the collision check. */
  actorUserId: string
  /**
   * Set when the actor has seen and accepted the collision warnings. Without
   * it, contacts owned by someone else are skipped rather than enrolled.
   */
  acknowledgeCollisions?: boolean
}

/**
 * Enrolls many contacts in one campaign.
 *
 * ⚠️ CHECKS ARE ORDERED CHEAPEST-AND-MOST-DEFINITIVE FIRST. A suppressed
 * contact is skipped before we bother looking at collisions, because
 * suppression is absolute and no amount of acknowledgement overrides it.
 */
export async function bulkEnroll(input: BulkEnrollInput): Promise<BulkEnrollResult> {
  const db = createAdminClient()
  const outcomes: EnrollmentOutcome[] = []
  const skippedByReason = { ...EMPTY_REASONS }

  const skip = (contactId: string, reason: SkipReason, detail: string) => {
    outcomes.push({ contactId, enrolled: false, reason, detail })
    skippedByReason[reason] += 1
  }

  if (input.contactIds.length === 0) {
    return { enrolled: 0, skipped: 0, outcomes, skippedByReason }
  }

  const { data: campaign, error: campaignError } = await db
    .from('email_campaigns')
    .select('id, type, status, account_id')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.campaignId)
    .is('deleted_at', null)
    .maybeSingle()

  if (campaignError) throw new Error(`bulkEnroll failed: ${campaignError.message}`)

  if (!campaign) {
    for (const id of input.contactIds) {
      skip(id, 'campaign_not_enrollable', 'That campaign no longer exists.')
    }
    return { enrolled: 0, skipped: outcomes.length, outcomes, skippedByReason }
  }

  /*
   * ⚠️ A STOPPED OR COMPLETED CAMPAIGN ACCEPTS NOBODY. Enrolling into one
   * looks like success and does nothing — the enrollment sits there with no
   * scheduler ever picking it up, which is worse than a refusal.
   */
  if (campaign.status === 'stopped' || campaign.status === 'completed') {
    for (const id of input.contactIds) {
      skip(id, 'campaign_not_enrollable', `This campaign is ${campaign.status}.`)
    }
    return { enrolled: 0, skipped: outcomes.length, outcomes, skippedByReason }
  }

  const policy = policyFor(campaign.type as CampaignType)

  // --- Gather everything in bulk. One query per concern, not per contact. ---

  const { data: contacts } = await db
    .from('crm_contacts')
    .select('id, full_name, owner_user_id, deleted_at')
    .eq('workspace_id', input.workspaceId)
    .in('id', input.contactIds)

  const contactById = new Map((contacts ?? []).map((c) => [c.id, c]))

  const { data: emails } = await db
    .from('crm_contact_emails')
    .select('contact_id, address, is_primary')
    .eq('workspace_id', input.workspaceId)
    .in('contact_id', input.contactIds)

  /*
   * ⚠️ THE PRIMARY ADDRESS WINS, and the fallback is deterministic rather than
   * "whatever the database returned first". An unstable choice would mean
   * re-running the same enrollment mails a different address.
   */
  const emailByContact = new Map<string, string>()
  for (const row of (emails ?? []).slice().sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1
    return a.address.localeCompare(b.address)
  })) {
    if (!emailByContact.has(row.contact_id)) emailByContact.set(row.contact_id, row.address)
  }

  const addresses = [...new Set(emailByContact.values())]
  const suppressed = new Set<string>()
  if (addresses.length > 0) {
    const { data } = await db
      .from('email_suppressions')
      .select('email')
      .eq('workspace_id', input.workspaceId)
      .in('email', addresses)
    for (const row of data ?? []) suppressed.add(row.email)
  }

  const { data: existing } = await db
    .from('email_enrollments')
    .select('contact_id')
    .eq('workspace_id', input.workspaceId)
    .eq('campaign_id', input.campaignId)
    .in('status', ['active', 'paused'])
    .in('contact_id', input.contactIds)

  const alreadyEnrolled = new Set((existing ?? []).map((e) => e.contact_id))

  // Collision settings, read once.
  const { data: collisionSettings } = await db
    .from('crm_collision_settings')
    .select('contact_mode')
    .eq('workspace_id', input.workspaceId)
    .maybeSingle()

  const collisionMode = collisionSettings?.contact_mode ?? 'warn'

  // --- Decide, per contact. ---

  const toInsert: {
    workspace_id: string
    campaign_id: string
    contact_id: string
    to_email: string
  }[] = []

  for (const contactId of input.contactIds) {
    const contact = contactById.get(contactId)

    if (!contact || contact.deleted_at) {
      skip(contactId, 'deleted', 'This contact has been deleted.')
      continue
    }

    if (alreadyEnrolled.has(contactId)) {
      skip(contactId, 'already_enrolled', 'Already in this campaign.')
      continue
    }

    const email = emailByContact.get(contactId)
    if (!email) {
      /*
       * ⚠️ NAMED, NOT COUNTED. "12 contacts had no email address" is a data
       * problem the customer can fix; a silent drop is one they never learn
       * about.
       */
      skip(contactId, 'no_email', `${contact.full_name ?? 'This contact'} has no email address.`)
      continue
    }

    if (suppressed.has(email)) {
      // Absolute. `respectsSuppression` is true on every campaign type and
      // there is no acknowledgement that overrides it.
      skip(contactId, 'suppressed', 'This address is on the do-not-contact list.')
      continue
    }

    /*
     * ⚠️ COLLISION IS A WARNING, NOT A WALL — unless it is unacknowledged.
     * A contact owned by a teammate means two setters are about to work the
     * same person, which the prospect experiences as being spammed by one
     * company twice. The actor can proceed, but must say so.
     */
    if (
      collisionMode !== 'off' &&
      !input.acknowledgeCollisions &&
      contact.owner_user_id &&
      contact.owner_user_id !== input.actorUserId
    ) {
      skip(
        contactId,
        'collision',
        `${contact.full_name ?? 'This contact'} is owned by a teammate. Confirm you want to include them.`,
      )
      continue
    }

    toInsert.push({
      workspace_id: input.workspaceId,
      campaign_id: input.campaignId,
      contact_id: contactId,
      to_email: email,
    })
  }

  if (toInsert.length === 0) {
    return { enrolled: 0, skipped: outcomes.length, outcomes, skippedByReason }
  }

  /*
   * ⚠️ THE FIRST STEP IS DUE IMMEDIATELY ONLY IF THE CAMPAIGN IS RUNNING.
   * A draft campaign enrolls people without scheduling anything, so the
   * audience can be built before launch — which is how people actually work.
   */
  const nextActionAt = campaign.status === 'running' ? new Date().toISOString() : null

  const { data: inserted, error } = await db
    .from('email_enrollments')
    .insert(toInsert.map((row) => ({ ...row, next_action_at: nextActionAt })))
    .select('id, contact_id, to_email')

  if (error) throw new Error(`bulkEnroll failed to insert: ${error.message}`)

  for (const row of inserted ?? []) {
    outcomes.push({
      contactId: row.contact_id,
      enrolled: true,
      enrollmentId: row.id,
      email: row.to_email,
    })
  }

  // Not self-advancing types are enrolled but driven elsewhere (M7's Flow
  // engine); the row is still correct, nothing schedules it here.
  void policy.selfAdvancing

  return {
    enrolled: inserted?.length ?? 0,
    skipped: outcomes.length - (inserted?.length ?? 0),
    outcomes,
    skippedByReason,
  }
}

/** A one-line summary a person can read. */
export function summarize(result: BulkEnrollResult): string {
  if (result.skipped === 0) {
    return `${result.enrolled} contact${result.enrolled === 1 ? '' : 's'} enrolled.`
  }

  const parts: string[] = []
  const label: Record<SkipReason, string> = {
    no_email: 'no email address',
    suppressed: 'unsubscribed or bounced',
    already_enrolled: 'already enrolled',
    collision: 'owned by a teammate',
    campaign_not_enrollable: 'campaign not accepting contacts',
    deleted: 'deleted',
  }

  for (const [reason, count] of Object.entries(result.skippedByReason)) {
    if (count > 0) parts.push(`${count} ${label[reason as SkipReason]}`)
  }

  return `${result.enrolled} enrolled, ${result.skipped} skipped (${parts.join(', ')}).`
}
