import 'server-only'

/**
 * What happens when a meeting event arrives — M8 Phase 24.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  PROVIDER-NEUTRAL BY CONSTRUCTION. This file takes a                     ║
 * ║  `NormalizedMeetingEvent` and never learns where it came from — which is  ║
 * ║  M8 criterion 4, "no integration logic inside CRM controllers".          ║
 * ║                                                                           ║
 * ║  The pipeline the brief specifies:                                        ║
 * ║    booked → match invitee to Contact → CALL_BOOKED activity →            ║
 * ║    notify owner → trigger Flow                                            ║
 * ║                                                                           ║
 * ║  ⚠️ NOTHING ACTS UNTIL `record_meeting_event` REPORTS THE EVENT WAS NEW.  ║
 * ║  That single check is what makes criterion 1 hold end to end: a replayed  ║
 * ║  webhook writes no activity, sends no notification and starts no flow.    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { recordActivity } from '@/lib/crm/activities'
import type { NormalizedMeetingEvent } from '@/lib/integrations/calendly/normalize'
import { deliveryKeyFor } from '@/lib/integrations/calendly/normalize'
import { startRun } from '@/lib/flows/engine'
import { createAdminClient } from '@/lib/supabase/admin'

export type IngestResult = {
  bookingId: string | null
  /** False when this delivery had already been processed. */
  isNew: boolean
  /** Whether the invitee resolved to a known contact. */
  matched: boolean
  /** Queued for a human to match. Criterion 2. */
  queuedForMatching: boolean
}

/**
 * Finds the contact who booked.
 *
 * ⚠️ MATCHES ON A STORED ADDRESS ONLY — never on name, never fuzzily. Two
 * people called Dana Reyes are two people, and attaching a booked meeting to
 * the wrong contact puts a real meeting on a stranger's timeline and credits
 * the wrong setter for it.
 */
async function findContact(workspaceId: string, email: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from('crm_contact_emails')
    .select('contact_id')
    .eq('workspace_id', workspaceId)
    .eq('address', email.toLowerCase())
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  return data?.contact_id ?? null
}

/**
 * Records a meeting event and does everything that follows from it.
 *
 * @param triggerFlowId optional flow to start on a booking, so the CRM does
 *   not need to know a flow exists.
 */
export async function ingestMeetingEvent(
  workspaceId: string,
  event: NormalizedMeetingEvent,
  options: { triggerFlowId?: string | null } = {},
): Promise<IngestResult> {
  const db = createAdminClient()
  const contactId = await findContact(workspaceId, event.inviteeEmail)

  const { data, error } = await db.rpc('record_meeting_event', {
    p_workspace_id: workspaceId,
    p_provider: event.provider,
    p_provider_event_id: event.providerEventId,
    p_type: event.type,
    p_invitee_email: event.inviteeEmail,
    p_scheduled_at: event.scheduledAt,
    p_delivery_id: deliveryKeyFor(event),
    p_invitee_name: event.inviteeName ?? undefined,
    p_title: event.title ?? undefined,
    p_ends_at: event.endsAt ?? undefined,
    p_join_url: event.joinUrl ?? undefined,
    p_contact_id: contactId ?? undefined,
    p_cancel_reason: event.cancelReason ?? undefined,
  })

  if (error) throw new Error(`ingestMeetingEvent failed: ${error.message}`)

  const row = data?.[0]
  const bookingId = row?.booking_id ?? null

  /*
   * ⚠️ A REPLAY STOPS HERE. Everything below has a side effect a customer can
   * see — an activity on a timeline, a notification, a flow run — and doing any
   * of it twice is exactly what criterion 1 forbids.
   */
  if (!row?.is_new || !bookingId) {
    return { bookingId, isNew: false, matched: Boolean(contactId), queuedForMatching: false }
  }

  /*
   * ⚠️ CRITERION 2. An invitee we do not recognise is the NORMAL inbound case:
   * a referral, a personal address, someone forwarding the booking link. The
   * meeting is still recorded in full — it is real and it is happening — and
   * the unmatched invitee is QUEUED for a human.
   *
   * Auto-creating a contact from an email address alone would fabricate a
   * record with no name, no company and no source, which is worse than an
   * honest gap someone can resolve in one click.
   */
  let queuedForMatching = false
  if (!contactId) {
    const { error: queueError } = await db.from('meeting_unmatched_invitees').insert({
      workspace_id: workspaceId,
      booking_id: bookingId,
      invitee_email: event.inviteeEmail,
      invitee_name: event.inviteeName,
    })
    // A failed queue insert must not lose the meeting, which is already saved.
    if (!queueError) queuedForMatching = true
  }

  if (contactId) {
    /*
     * The CRM timeline entry. Goes through `recordActivity`, which freezes
     * `owner_user_id_at_event` — a meeting booked today must stay credited to
     * whoever owned the contact today, even after reassignment (M4 criterion 2).
     */
    await recordActivity(workspaceId, {
      contactId,
      activityType: activityTypeFor(event.type),
      channel: 'meeting',
      actorUserId: null,
      occurredAt: event.scheduledAt,
      metadata: {
        provider: event.provider,
        title: event.title,
        scheduled_at: event.scheduledAt,
        ...(event.cancelReason ? { cancel_reason: event.cancelReason } : {}),
      },
    })
  }

  /*
   * ⚠️ THE FLOW IS STARTED BY ID PASSED IN, not looked up here. This file must
   * not decide which flows exist — that coupling is what criterion 4 rules out,
   * and it would make the meeting pipeline depend on the automation module
   * being installed.
   */
  if (options.triggerFlowId && contactId && event.type === 'booked') {
    await startRun({
      workspaceId,
      flowId: options.triggerFlowId,
      triggerType: 'call_booked',
      contactId,
      // Deterministic, so a retried webhook cannot start a second run even if
      // the meeting dedupe were somehow bypassed.
      idempotencyKey: `meeting:${bookingId}:booked`,
    }).catch(() => {
      // A flow that will not start must not lose the meeting.
    })
  }

  return { bookingId, isNew: true, matched: Boolean(contactId), queuedForMatching }
}

/** Maps a meeting event onto the CRM's existing activity vocabulary. */
function activityTypeFor(type: NormalizedMeetingEvent['type']) {
  switch (type) {
    case 'booked':
    case 'rescheduled':
      // A reschedule is still a booked call — it has not been lost, and
      // counting it as anything else would understate booked meetings.
      return 'CALL_BOOKED' as const
    case 'no_show':
      return 'CALL_NO_SHOW' as const
    case 'cancelled':
    default:
      /*
       * There is no CALL_CANCELLED in the activity enum. Rather than add one
       * mid-build, a cancellation is recorded as ENGAGEMENT with its reason in
       * metadata — the booking table carries the authoritative status, and
       * reports read that.
       */
      return 'ENGAGEMENT' as const
  }
}

/**
 * Resolves a queued invitee to a contact.
 *
 * ⚠️ BACKFILLS THE ACTIVITY THE BOOKING NEVER GOT. Matching after the fact
 * without writing the timeline entry would leave a contact whose meeting is
 * invisible on their own page.
 */
export async function resolveUnmatchedInvitee(
  workspaceId: string,
  unmatchedId: string,
  contactId: string,
  resolvedBy: string,
): Promise<boolean> {
  const db = createAdminClient()

  const { data: pending } = await db
    .from('meeting_unmatched_invitees')
    .select('id, booking_id, invitee_email')
    .eq('workspace_id', workspaceId)
    .eq('id', unmatchedId)
    .is('resolved_at', null)
    .maybeSingle()

  if (!pending) return false

  const { data: booking } = await db
    .from('meeting_bookings')
    .select('id, title, scheduled_at, provider, status')
    .eq('id', pending.booking_id)
    .maybeSingle()

  /*
   * The booking could have been erased between queueing and resolving. Clear
   * the queue entry rather than leaving a row pointing at nothing, which would
   * sit in the "needs matching" list forever with nothing to match.
   */
  if (!booking) {
    await db
      .from('meeting_unmatched_invitees')
      .update({ resolved_at: new Date().toISOString(), resolved_by: resolvedBy })
      .eq('id', unmatchedId)
    return false
  }

  await db
    .from('meeting_bookings')
    .update({ contact_id: contactId })
    .eq('id', pending.booking_id)

  await recordActivity(workspaceId, {
    contactId,
    activityType: 'CALL_BOOKED',
    channel: 'meeting',
    actorUserId: resolvedBy,
    occurredAt: booking.scheduled_at,
    metadata: {
      provider: booking.provider,
      title: booking.title,
      matched_manually: true,
    },
  })

  await db
    .from('meeting_unmatched_invitees')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_contact_id: contactId,
      resolved_by: resolvedBy,
    })
    .eq('id', unmatchedId)

  return true
}
