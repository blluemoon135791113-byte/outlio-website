/**
 * Calendly payload → normalized meeting event — M8 Phase 24.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS FILE IS THE ONLY PLACE THAT KNOWS CALENDLY'S SHAPE.                ║
 * ║                                                                           ║
 * ║  M8 criterion 4: "no integration logic inside CRM controllers (adapter +  ║
 * ║  events only)". Everything downstream consumes `NormalizedMeetingEvent`   ║
 * ║  and never learns which provider produced it, so a second booking tool    ║
 * ║  adds a file here and changes nothing else.                              ║
 * ║                                                                           ║
 * ║  ⚠️ PURE. No database, no network — so every payload shape is testable    ║
 * ║  without a Calendly account, which matters because there are no Calendly  ║
 * ║  credentials in this environment (Ledger).                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

export type NormalizedMeetingEvent = {
  provider: 'calendly'
  /** Stable across reschedules — the meeting, not this notification. */
  providerEventId: string
  type: 'booked' | 'cancelled' | 'rescheduled' | 'no_show'
  inviteeEmail: string
  inviteeName: string | null
  title: string | null
  scheduledAt: string
  endsAt: string | null
  joinUrl: string | null
  cancelReason: string | null
}

export class UnsupportedCalendlyEvent extends Error {}

type CalendlyPayload = {
  event?: string
  payload?: {
    uri?: string
    email?: string
    name?: string
    status?: string
    rescheduled?: boolean
    cancel_url?: string
    reschedule_url?: string
    cancellation?: { reason?: string; canceled_by?: string }
    scheduled_event?: {
      uri?: string
      name?: string
      start_time?: string
      end_time?: string
      location?: { join_url?: string; type?: string }
      status?: string
    }
  }
}

/**
 * ⚠️ THE MEETING'S ID IS THE `scheduled_event.uri`, NOT the invitee uri.
 *
 * Calendly sends an INVITEE object; its own uri changes when a booking is
 * rescheduled, while the scheduled event's does not. Keying on the invitee uri
 * would make every reschedule look like a brand-new meeting — losing the
 * original booking history that criterion 3 requires be preserved, and
 * double-counting bookings in every report.
 */
function meetingIdOf(payload: CalendlyPayload['payload']): string | null {
  const uri = payload?.scheduled_event?.uri
  if (!uri) return null
  // The trailing path segment is the id; the full uri is stable too, but the
  // segment is what appears in Calendly's own UI.
  return uri.split('/').filter(Boolean).pop() ?? uri
}

/**
 * Turns one webhook body into a normalized event.
 *
 * @throws UnsupportedCalendlyEvent for anything we do not model, so an
 *   unrecognised event is a loud no-op rather than a partial write.
 */
export function normalizeCalendlyEvent(body: unknown): NormalizedMeetingEvent {
  const typed = body as CalendlyPayload
  const kind = typed?.event
  const payload = typed?.payload

  if (!payload) throw new UnsupportedCalendlyEvent('The webhook had no payload.')

  const email = payload.email?.trim().toLowerCase()
  if (!email) {
    // Without an address there is nobody to match, and inventing one would be
    // fabricating a lead.
    throw new UnsupportedCalendlyEvent('The booking had no invitee email address.')
  }

  const meetingId = meetingIdOf(payload)
  if (!meetingId) throw new UnsupportedCalendlyEvent('The booking had no scheduled event.')

  const scheduledAt = payload.scheduled_event?.start_time
  if (!scheduledAt) throw new UnsupportedCalendlyEvent('The booking had no start time.')

  const common = {
    provider: 'calendly' as const,
    providerEventId: meetingId,
    inviteeEmail: email,
    inviteeName: payload.name?.trim() || null,
    title: payload.scheduled_event?.name?.trim() || null,
    scheduledAt,
    endsAt: payload.scheduled_event?.end_time ?? null,
    joinUrl: payload.scheduled_event?.location?.join_url ?? null,
    cancelReason: null,
  }

  if (kind === 'invitee.created') {
    /*
     * ⚠️ A RESCHEDULE ARRIVES AS `invitee.created` WITH `rescheduled: true`.
     * Calendly does not send a distinct reschedule event — it cancels the old
     * invitee and creates a new one. Treating this as a fresh booking is the
     * mistake that loses the original history.
     */
    return { ...common, type: payload.rescheduled === true ? 'rescheduled' : 'booked' }
  }

  if (kind === 'invitee.canceled' || kind === 'invitee.cancelled') {
    /*
     * ⚠️ THE CANCELLATION HALF OF A RESCHEDULE IS IGNORED, deliberately. When
     * someone reschedules, Calendly sends BOTH a cancel for the old invitee
     * and a create for the new one. Recording the cancel would mark the
     * meeting cancelled and then un-cancel it moments later — and any flow
     * watching for cancellations would fire on a meeting that still exists.
     */
    if (payload.rescheduled === true) {
      throw new UnsupportedCalendlyEvent(
        'This cancellation is one half of a reschedule; the matching booking carries the change.',
      )
    }

    return {
      ...common,
      type: 'no_show' === payload.status ? 'no_show' : 'cancelled',
      cancelReason: payload.cancellation?.reason?.trim() || null,
    }
  }

  throw new UnsupportedCalendlyEvent(`Outlio does not handle the "${kind ?? 'unknown'}" event.`)
}

/**
 * The delivery id used for replay protection.
 *
 * ⚠️ DERIVED FROM THE EVENT, not from a header. Calendly does not send a
 * delivery id, and using the signature timestamp would make a genuine
 * reschedule seconds later look like a duplicate. Meeting + kind + start time
 * is unique per real change: the same booking arriving twice collides, while a
 * reschedule to a new time does not.
 */
export function deliveryKeyFor(event: NormalizedMeetingEvent): string {
  return `${event.providerEventId}:${event.type}:${event.scheduledAt}`
}
