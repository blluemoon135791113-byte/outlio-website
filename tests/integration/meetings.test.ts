/**
 * The meeting pipeline, end to end — M8 Phase 24.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  CRITERION 1: a replayed/duplicated webhook creates exactly ONE activity. ║
 * ║  CRITERION 2: an unmatched invitee is handled gracefully — queued for     ║
 * ║               manual match, no crash, no orphan data.                     ║
 * ║  CRITERION 3: a reschedule preserves the original booking history.        ║
 * ║                                                                           ║
 * ║  Criterion 1 is counted as ACTIVITIES, not events. The event dedupe is    ║
 * ║  already proven in SQL; what matters to a customer is that a replayed     ║
 * ║  webhook does not put the same meeting on a contact's timeline twice.     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { normalizeCalendlyEvent } from '@/lib/integrations/calendly/normalize'
import { normalizeEmail } from '@/lib/crm/normalize'
import { ingestMeetingEvent, resolveUnmatchedInvitee } from '@/lib/meetings/ingest'
import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv } from './helpers'

const RUN = Date.now().toString(36)

let user: Awaited<ReturnType<typeof createAuthUser>> | null = null
let workspaceId = ''
let knownContactId = ''
let knownEmail = ''

beforeAll(async () => {
  if (!hasSupabaseEnv) return

  user = await createAuthUser(`meet-${RUN}`)
  const db = adminClient()
  const { data: m } = await db
    .from('workspace_memberships').select('workspace_id').eq('user_id', user.id).single()
  workspaceId = m!.workspace_id

  knownEmail = `known+${RUN}@buyer.example`
  const { data: contact } = await db
    .from('crm_contacts')
    .insert({
      workspace_id: workspaceId, first_name: 'Dana', last_name: 'Reyes',
      full_name: `Dana Reyes ${RUN}`,
    })
    .select('id').single()
  knownContactId = contact!.id

  const identity = normalizeEmail(knownEmail)!
  const { error } = await db.from('crm_contact_emails').insert({
    workspace_id: workspaceId, contact_id: knownContactId,
    address: identity.address, identity_key: identity.identityKey, is_primary: true,
  })
  if (error) throw new Error(`contact email insert failed: ${error.message}`)
}, 60_000)

afterAll(async () => {
  if (!user) return
  await adminClient().from('workspaces').delete().eq('id', workspaceId)
  await deleteTestUser(user.id)
})

/** A Calendly payload for one meeting. */
function payload(opts: {
  meeting: string
  email: string
  start: string
  rescheduled?: boolean
  cancelled?: boolean
}) {
  return {
    event: opts.cancelled ? 'invitee.canceled' : 'invitee.created',
    payload: {
      uri: `https://api.calendly.com/scheduled_events/${opts.meeting}/invitees/${Math.random()}`,
      email: opts.email,
      name: 'Dana Reyes',
      rescheduled: opts.rescheduled ?? false,
      scheduled_event: {
        uri: `https://api.calendly.com/scheduled_events/${opts.meeting}`,
        name: 'Intro call',
        start_time: opts.start,
        end_time: opts.start,
      },
    },
  }
}

const ingest = (body: unknown) =>
  ingestMeetingEvent(workspaceId, normalizeCalendlyEvent(body))

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('CRITERION 1 — a replayed webhook creates exactly one activity', () => {
  it('does not put the same meeting on a timeline twice', async () => {
    const meeting = `M1-${RUN}`
    const body = payload({ meeting, email: knownEmail, start: '2026-09-10T14:00:00.000Z' })

    const first = await ingest(body)
    expect(first.isNew).toBe(true)
    expect(first.matched).toBe(true)

    // Calendly retries aggressively; five deliveries of one booking is normal.
    for (let i = 0; i < 4; i += 1) {
      const replay = await ingest(body)
      expect(replay.isNew).toBe(false)
    }

    const { data: activities } = await adminClient()
      .from('crm_activities')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', knownContactId)
      .eq('activity_type', 'CALL_BOOKED')

    // ⚠️ THE ASSERTION THAT MATTERS: one activity, not five.
    expect(activities!.length).toBe(1)
  }, 90_000)
})

describeIf('CRITERION 2 — an unmatched invitee is handled gracefully', () => {
  it('records the meeting, queues the invitee, and creates no contact', async () => {
    const meeting = `M2-${RUN}`
    const stranger = `stranger+${RUN}@elsewhere.example`

    const result = await ingest(
      payload({ meeting, email: stranger, start: '2026-09-11T10:00:00.000Z' }),
    )

    // No crash, and the meeting is REAL so it is still recorded in full.
    expect(result.isNew).toBe(true)
    expect(result.matched).toBe(false)
    expect(result.queuedForMatching).toBe(true)
    expect(result.bookingId).not.toBeNull()

    const db = adminClient()

    const { data: booking } = await db
      .from('meeting_bookings')
      .select('contact_id, invitee_email, scheduled_at')
      .eq('id', result.bookingId!).single()
    expect(booking!.contact_id).toBeNull()
    expect(booking!.invitee_email).toBe(stranger)

    // Queued for a human.
    const { data: queued } = await db
      .from('meeting_unmatched_invitees')
      .select('id, invitee_email, resolved_at')
      .eq('workspace_id', workspaceId).eq('booking_id', result.bookingId!).single()
    expect(queued!.invitee_email).toBe(stranger)
    expect(queued!.resolved_at).toBeNull()

    /*
     * ⚠️ NO ORPHAN DATA. A contact was NOT auto-created from an email address
     * alone — that would fabricate a record with no name, no company and no
     * source, which is worse than an honest gap.
     */
    const { data: fabricated } = await db
      .from('crm_contact_emails')
      .select('id').eq('workspace_id', workspaceId).eq('address', stranger)
    expect(fabricated!.length).toBe(0)
  }, 90_000)

  it('backfills the activity when a human resolves the match', async () => {
    const meeting = `M3-${RUN}`
    const stranger = `later+${RUN}@elsewhere.example`

    const result = await ingest(
      payload({ meeting, email: stranger, start: '2026-09-12T11:00:00.000Z' }),
    )
    const db = adminClient()

    const { data: queued } = await db
      .from('meeting_unmatched_invitees')
      .select('id').eq('booking_id', result.bookingId!).single()

    const resolved = await resolveUnmatchedInvitee(
      workspaceId, queued!.id, knownContactId, user!.id,
    )
    expect(resolved).toBe(true)

    // The booking now points at the contact...
    const { data: booking } = await db
      .from('meeting_bookings').select('contact_id').eq('id', result.bookingId!).single()
    expect(booking!.contact_id).toBe(knownContactId)

    /*
     * ...and the timeline entry it never got is backfilled. Matching without
     * this would leave a contact whose meeting is invisible on their own page.
     */
    const { data: activities } = await db
      .from('crm_activities')
      .select('metadata')
      .eq('contact_id', knownContactId)
      .eq('activity_type', 'CALL_BOOKED')
    expect(
      activities!.some((a) => (a.metadata as { matched_manually?: boolean }).matched_manually),
    ).toBe(true)

    // And the queue entry is closed, so it stops appearing as outstanding.
    const { data: after } = await db
      .from('meeting_unmatched_invitees').select('resolved_at').eq('id', queued!.id).single()
    expect(after!.resolved_at).not.toBeNull()
  }, 90_000)

  it('is a no-op when the same queue entry is resolved twice', async () => {
    const meeting = `M4-${RUN}`
    const result = await ingest(
      payload({ meeting, email: `twice+${RUN}@elsewhere.example`, start: '2026-09-13T09:00:00.000Z' }),
    )
    const db = adminClient()
    const { data: queued } = await db
      .from('meeting_unmatched_invitees').select('id').eq('booking_id', result.bookingId!).single()

    expect(await resolveUnmatchedInvitee(workspaceId, queued!.id, knownContactId, user!.id)).toBe(true)
    // Two people clicking "match" must not write the activity twice.
    expect(await resolveUnmatchedInvitee(workspaceId, queued!.id, knownContactId, user!.id)).toBe(false)
  }, 90_000)
})

describeIf('CRITERION 3 — a reschedule preserves the original booking', () => {
  it('keeps the first time and counts the reschedules', async () => {
    const meeting = `M5-${RUN}`
    const email = `resched+${RUN}@elsewhere.example`

    await ingest(payload({ meeting, email, start: '2026-09-20T14:00:00.000Z' }))
    await ingest(payload({ meeting, email, start: '2026-09-22T15:00:00.000Z', rescheduled: true }))
    await ingest(payload({ meeting, email, start: '2026-09-25T09:00:00.000Z', rescheduled: true }))

    const { data: booking } = await adminClient()
      .from('meeting_bookings')
      .select('scheduled_at, originally_scheduled_at, reschedule_count')
      .eq('workspace_id', workspaceId).eq('provider_event_id', meeting).single()

    expect(booking!.scheduled_at.startsWith('2026-09-25')).toBe(true)
    // The original survives both moves.
    expect(booking!.originally_scheduled_at.startsWith('2026-09-20')).toBe(true)
    expect(booking!.reschedule_count).toBe(2)
  }, 90_000)

  it('treats a reschedule as ONE meeting, not three', async () => {
    /*
     * ⚠️ THIS IS WHY THE MEETING IS KEYED ON THE SCHEDULED EVENT rather than
     * the invitee. Keying on the invitee would produce three bookings and
     * triple-count booked meetings in every report.
     */
    const meeting = `M6-${RUN}`
    const email = `one+${RUN}@elsewhere.example`

    await ingest(payload({ meeting, email, start: '2026-10-01T14:00:00.000Z' }))
    await ingest(payload({ meeting, email, start: '2026-10-02T14:00:00.000Z', rescheduled: true }))

    const { count } = await adminClient()
      .from('meeting_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).eq('provider_event_id', meeting)

    expect(count).toBe(1)
  }, 90_000)

  it('preserves the original time even after a cancellation', async () => {
    const meeting = `M7-${RUN}`
    const email = `cancel+${RUN}@elsewhere.example`

    await ingest(payload({ meeting, email, start: '2026-10-05T14:00:00.000Z' }))
    await ingest(payload({ meeting, email, start: '2026-10-05T14:00:00.000Z', cancelled: true }))

    const { data: booking } = await adminClient()
      .from('meeting_bookings')
      .select('status, originally_scheduled_at')
      .eq('workspace_id', workspaceId).eq('provider_event_id', meeting).single()

    expect(booking!.status).toBe('cancelled')
    // "It was booked for the 5th and then cancelled" must stay answerable.
    expect(booking!.originally_scheduled_at.startsWith('2026-10-05')).toBe(true)
  }, 90_000)
})
