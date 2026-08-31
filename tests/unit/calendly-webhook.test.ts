/**
 * Calendly webhook handling — M8 Phase 24.
 *
 * ⚠️ THE WEBHOOK URL IS PUBLIC AND ITS SHAPE IS GUESSABLE. Without a signature
 * check anyone could POST a "meeting booked" and have it become a CALL_BOOKED
 * activity on a real contact — poisoning the metrics a team is paid on and
 * firing whatever flow watches for booked calls.
 *
 * There are no Calendly credentials in this environment, so every payload here
 * is constructed and signed locally. That is enough: the criteria are about
 * OUR handling, not Calendly's uptime.
 */
import { describe, expect, it } from 'vitest'

import {
  deliveryKeyFor,
  normalizeCalendlyEvent,
  UnsupportedCalendlyEvent,
} from '@/lib/integrations/calendly/normalize'
import {
  parseSignatureHeader,
  signCalendlyPayload,
  verifyCalendlySignature,
} from '@/lib/integrations/calendly/signature'

const KEY = 'a-test-signing-key'

const booking = (over: Record<string, unknown> = {}) => ({
  event: 'invitee.created',
  payload: {
    uri: 'https://api.calendly.com/scheduled_events/EVT/invitees/INV1',
    email: 'Dana@Buyer.Example',
    name: 'Dana Reyes',
    rescheduled: false,
    scheduled_event: {
      uri: 'https://api.calendly.com/scheduled_events/EVT',
      name: 'Intro call',
      start_time: '2026-09-10T14:00:00.000Z',
      end_time: '2026-09-10T14:30:00.000Z',
      location: { join_url: 'https://meet.example/abc' },
    },
    ...over,
  },
})

describe('signature verification', () => {
  it('accepts a correctly signed body', () => {
    const body = JSON.stringify(booking())
    const header = signCalendlyPayload(body, KEY)
    expect(verifyCalendlySignature(body, header, KEY)).toEqual({ valid: true })
  })

  it('REJECTS when no signing key is configured', () => {
    /*
     * A missing environment variable must never turn signature checking off —
     * that is how an endpoint silently becomes open in the one environment
     * where the variable was forgotten.
     */
    const body = JSON.stringify(booking())
    const header = signCalendlyPayload(body, KEY)
    expect(verifyCalendlySignature(body, header, undefined)).toEqual({
      valid: false,
      reason: 'not_configured',
    })
  })

  it('rejects a body that was altered after signing', () => {
    const body = JSON.stringify(booking())
    const header = signCalendlyPayload(body, KEY)
    const tampered = body.replace('Dana@Buyer.Example', 'attacker@evil.example')
    expect(verifyCalendlySignature(tampered, header, KEY).valid).toBe(false)
  })

  it('rejects a signature made with a different key', () => {
    const body = JSON.stringify(booking())
    const header = signCalendlyPayload(body, 'someone-elses-key')
    expect(verifyCalendlySignature(body, header, KEY)).toEqual({
      valid: false,
      reason: 'bad_signature',
    })
  })

  it('rejects a replayed signature that is too old', () => {
    /*
     * A signature with no time bound can be replayed forever by anyone who
     * ever saw one — from a log, a proxy, or a bug report.
     */
    const body = JSON.stringify(booking())
    const old = new Date('2026-09-01T12:00:00Z')
    const header = signCalendlyPayload(body, KEY, old)
    const muchLater = new Date('2026-09-01T12:30:00Z')

    expect(verifyCalendlySignature(body, header, KEY, muchLater)).toEqual({
      valid: false,
      reason: 'stale',
    })
  })

  it('accepts a signature within the freshness window', () => {
    const body = JSON.stringify(booking())
    const at = new Date('2026-09-01T12:00:00Z')
    const header = signCalendlyPayload(body, KEY, at)
    const soonAfter = new Date('2026-09-01T12:02:00Z')
    expect(verifyCalendlySignature(body, header, KEY, soonAfter).valid).toBe(true)
  })

  it.each([
    ['', 'empty'],
    ['garbage', 'no key=value'],
    ['t=123', 'no v1'],
    ['v1=abc', 'no timestamp'],
    ['t=notanumber,v1=abc', 'non-numeric timestamp'],
  ])('rejects a malformed header: %s (%s)', (header) => {
    const body = JSON.stringify(booking())
    expect(verifyCalendlySignature(body, header, KEY).valid).toBe(false)
  })

  it('rejects a missing header outright', () => {
    expect(verifyCalendlySignature('{}', null, KEY)).toEqual({ valid: false, reason: 'malformed' })
  })

  it('parses a header with spacing and extra versions', () => {
    expect(parseSignatureHeader('t=1, v1=abc, v0=legacy')).toEqual({ t: '1', v1: 'abc' })
  })
})

describe('normalizing a booking', () => {
  it('reads the invitee, time and meeting details', () => {
    const event = normalizeCalendlyEvent(booking())
    expect(event.type).toBe('booked')
    // Lowercased, because everything downstream matches on a normalized address.
    expect(event.inviteeEmail).toBe('dana@buyer.example')
    expect(event.inviteeName).toBe('Dana Reyes')
    expect(event.title).toBe('Intro call')
    expect(event.joinUrl).toBe('https://meet.example/abc')
  })

  it('keys on the SCHEDULED EVENT, not the invitee', () => {
    /*
     * ⚠️ THE CASE THAT DECIDES CRITERION 3. The invitee uri changes on every
     * reschedule; the scheduled event's does not. Keying on the invitee would
     * make each reschedule a brand-new meeting, losing the original booking
     * history and double-counting bookings in every report.
     */
    const first = normalizeCalendlyEvent(booking())
    const afterReschedule = normalizeCalendlyEvent(
      booking({
        uri: 'https://api.calendly.com/scheduled_events/EVT/invitees/INV2',
        rescheduled: true,
        scheduled_event: {
          uri: 'https://api.calendly.com/scheduled_events/EVT',
          name: 'Intro call',
          start_time: '2026-09-12T15:00:00.000Z',
        },
      }),
    )

    expect(afterReschedule.providerEventId).toBe(first.providerEventId)
    expect(afterReschedule.type).toBe('rescheduled')
  })

  it('treats invitee.created with rescheduled:true as a RESCHEDULE, not a booking', () => {
    // Calendly sends no distinct reschedule event; it cancels the old invitee
    // and creates a new one.
    expect(normalizeCalendlyEvent(booking({ rescheduled: true })).type).toBe('rescheduled')
  })

  it('IGNORES the cancellation half of a reschedule', () => {
    /*
     * Recording it would mark the meeting cancelled and then un-cancel it
     * moments later — and any flow watching for cancellations would fire on a
     * meeting that still exists.
     */
    expect(() =>
      normalizeCalendlyEvent({
        event: 'invitee.canceled',
        payload: { ...booking().payload, rescheduled: true },
      }),
    ).toThrow(UnsupportedCalendlyEvent)
  })

  it('records a genuine cancellation with its reason', () => {
    const event = normalizeCalendlyEvent({
      event: 'invitee.canceled',
      payload: {
        ...booking().payload,
        rescheduled: false,
        cancellation: { reason: 'Something came up' },
      },
    })
    expect(event.type).toBe('cancelled')
    expect(event.cancelReason).toBe('Something came up')
  })
})

describe('malformed payloads fail loudly rather than writing half a meeting', () => {
  it('refuses a payload with no invitee email', () => {
    // Without an address there is nobody to match, and inventing one would be
    // fabricating a lead.
    expect(() =>
      normalizeCalendlyEvent({ event: 'invitee.created', payload: { ...booking().payload, email: undefined } }),
    ).toThrow(UnsupportedCalendlyEvent)
  })

  it('refuses a payload with no scheduled event', () => {
    expect(() =>
      normalizeCalendlyEvent({ event: 'invitee.created', payload: { email: 'a@b.example' } }),
    ).toThrow(UnsupportedCalendlyEvent)
  })

  it('refuses a payload with no start time', () => {
    expect(() =>
      normalizeCalendlyEvent({
        event: 'invitee.created',
        payload: {
          email: 'a@b.example',
          scheduled_event: { uri: 'https://api.calendly.com/scheduled_events/X' },
        },
      }),
    ).toThrow(UnsupportedCalendlyEvent)
  })

  it('refuses an event type it does not model, naming it', () => {
    expect(() => normalizeCalendlyEvent({ event: 'routing_form.submitted', payload: {} })).toThrow(
      UnsupportedCalendlyEvent,
    )
  })

  it('refuses an empty body without throwing something unhelpful', () => {
    expect(() => normalizeCalendlyEvent({})).toThrow(UnsupportedCalendlyEvent)
    expect(() => normalizeCalendlyEvent(null)).toThrow(UnsupportedCalendlyEvent)
  })
})

describe('the delivery key', () => {
  it('collides for the same booking delivered twice', () => {
    // Criterion 1: a replayed webhook must not create a second activity.
    expect(deliveryKeyFor(normalizeCalendlyEvent(booking()))).toBe(
      deliveryKeyFor(normalizeCalendlyEvent(booking())),
    )
  })

  it('does NOT collide for a genuine reschedule to a new time', () => {
    /*
     * A key derived from the signature timestamp would make a reschedule
     * seconds later look like a duplicate and silently drop it.
     */
    const first = deliveryKeyFor(normalizeCalendlyEvent(booking()))
    const moved = deliveryKeyFor(
      normalizeCalendlyEvent(
        booking({
          rescheduled: true,
          scheduled_event: {
            uri: 'https://api.calendly.com/scheduled_events/EVT',
            start_time: '2026-09-12T15:00:00.000Z',
          },
        }),
      ),
    )
    expect(moved).not.toBe(first)
  })

  it('does not collide between a booking and its later cancellation', () => {
    const booked = deliveryKeyFor(normalizeCalendlyEvent(booking()))
    const cancelled = deliveryKeyFor(
      normalizeCalendlyEvent({
        event: 'invitee.canceled',
        payload: { ...booking().payload, rescheduled: false },
      }),
    )
    expect(cancelled).not.toBe(booked)
  })
})
