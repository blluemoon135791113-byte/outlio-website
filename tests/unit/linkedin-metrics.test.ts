/**
 * §4.18 — the four ways a true-looking number is wrong.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  NONE OF THESE LOOK LIKE BUGS. THEY LOOK LIKE RESULTS.                    ║
 * ║                                                                           ║
 * ║   • counting invitations too young to have been accepted → reads LOW      ║
 * ║   • counting note replies in the DM numerator            → reads HIGH     ║
 * ║   • counting an elapsed calendar slot as attendance      → reads HIGH     ║
 * ║   • counting a reschedule as a second booking            → reads HIGH     ║
 * ║                                                                           ║
 * ║  Three of the four flatter the channel, which is the direction nobody      ║
 * ║  investigates.                                                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import {
  ACCEPTANCE_WINDOW_DAYS,
  acceptanceRate,
  describeRate,
  directMessageReplyRate,
  meetingOutcomes,
  type InvitationRecord,
  type MeetingRecord,
} from '@/lib/linkedin/metrics'

const NOW = new Date('2026-09-12T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

const invite = (
  contactId: string,
  sentDaysAgo: number,
  acceptedDaysAfterSend: number | null,
  observed = true,
): InvitationRecord => ({
  contactId,
  sentAt: daysAgo(sentDaysAgo),
  acceptedAt:
    acceptedDaysAfterSend === null
      ? null
      : new Date(daysAgo(sentDaysAgo).getTime() + acceptedDaysAfterSend * 86_400_000),
  observed,
})

describe('an immature cohort is excluded, not counted as rejection', () => {
  it('leaves invitations whose window has not closed out of the denominator', () => {
    /*
     * ⚠️ THE ONE THAT MISLEADS WORST. Four invitations, three sent yesterday.
     * Counting them makes the rate 25% instead of 100% — a campaign that
     * started this week reporting a failure it has not had time to have. The
     * usual response to that signal is to change the copy, which destroys the
     * only cohort that would have answered the question.
     */
    const result = acceptanceRate(
      [
        invite('a', 20, 2),
        invite('b', 1, null),
        invite('c', 1, null),
        invite('d', 1, null),
      ],
      NOW,
    )

    expect(result.denominator).toBe(1)
    expect(result.immature).toBe(3)
    expect(result.rate).toBe(1)
  })

  it('returns null rather than 0% when nothing is mature yet', () => {
    // A campaign with no mature cohort has no rate. 0% is a claim about
    // performance; null is the absence of one.
    const result = acceptanceRate([invite('a', 1, null)], NOW)

    expect(result.rate).toBeNull()
    expect(describeRate(result)).toContain('Baseline being established')
  })

  it('does not count an acceptance that arrived after the window', () => {
    /*
     * A day-40 acceptance is real and belongs in contact history. Counting it
     * in a 14-day rate compares it against invitations that only had 14 days.
     */
    const result = acceptanceRate([invite('a', 60, 40)], NOW, ACCEPTANCE_WINDOW_DAYS)

    expect(result.denominator).toBe(1)
    expect(result.numerator).toBe(0)
  })
})

describe('unobserved is not declined', () => {
  it('labels the figure an observed lower bound and shows coverage', () => {
    /*
     * §4.18: "Without complete observation, label this an observed lower
     * bound, show observation coverage, and do not infer rejection." Nobody
     * looked at two of these; the real rate can only be higher than reported.
     */
    const result = acceptanceRate(
      [invite('a', 20, 2), invite('b', 20, null, false), invite('c', 20, null, false)],
      NOW,
    )

    expect(result.isLowerBound).toBe(true)
    expect(result.observationCoverage).toBeCloseTo(1 / 3)
    expect(describeRate(result)).toContain('observed lower bound')
  })

  it('does not label a fully observed cohort a lower bound', () => {
    const result = acceptanceRate([invite('a', 20, 2), invite('b', 20, null)], NOW)

    expect(result.isLowerBound).toBe(false)
    expect(describeRate(result)).not.toContain('lower bound')
  })
})

describe('people are counted once', () => {
  it('collapses repeat invitations to one contact', () => {
    const result = acceptanceRate([invite('a', 30, null), invite('a', 20, 2)], NOW)

    expect(result.denominator).toBe(1)
    expect(result.numerator).toBe(1)
  })
})

describe('a reply to the note is not a reply to the message', () => {
  it('counts only replies recorded against the DM', () => {
    /*
     * §4.18: "Replies to invitation notes belong to a separate invite-reply
     * metric, not the DM numerator." They answer a different question, they
     * arrive before the DM exists, and counting them inflates the number that
     * decides whether the message works.
     */
    const result = directMessageReplyRate(
      [
        { contactId: 'a', sentAt: daysAgo(10), repliedToMessageAt: daysAgo(9), observed: true },
        { contactId: 'b', sentAt: daysAgo(10), repliedToMessageAt: null, observed: true },
      ],
      NOW,
      4,
    )

    expect(result.numerator).toBe(1)
    expect(result.denominator).toBe(2)
  })

  it('ignores a reply timestamped before the message was sent', () => {
    // That is a note reply mislabelled, or a clock problem. Either way it is
    // not a reply to something that had not been sent.
    const result = directMessageReplyRate(
      [{ contactId: 'a', sentAt: daysAgo(10), repliedToMessageAt: daysAgo(12), observed: true }],
      NOW,
      4,
    )

    expect(result.numerator).toBe(0)
  })
})

describe('a past calendar time is not attendance', () => {
  const meeting = (
    eventId: string,
    scheduledDaysAgo: number,
    heldRecorded: boolean | null,
    status: MeetingRecord['status'] = 'booked',
  ): MeetingRecord => ({
    eventId,
    contactId: `c-${eventId}`,
    scheduledFor: daysAgo(scheduledDaysAgo),
    status,
    heldRecorded,
  })

  it('keeps unrecorded outcomes as unknown rather than held', () => {
    /*
     * ⚠️ THE MOST FLATTERING AVAILABLE LIE is counting every booking whose time
     * has passed. §4.18: "A past calendar time is not proof of attendance."
     */
    const out = meetingOutcomes([meeting('1', 2, true), meeting('2', 2, null), meeting('3', 2, false)], NOW)

    expect(out.held).toBe(1)
    expect(out.unknown).toBe(1)
    expect(out.noShow).toBe(1)
    expect(out.heldRate).toBeCloseTo(1 / 3)
  })

  it('keeps unknowns in the denominator', () => {
    // Dropping them would quietly raise the rate every time somebody forgot to
    // record an outcome — the metric improving as record-keeping worsens.
    const out = meetingOutcomes([meeting('1', 2, true), meeting('2', 2, null)], NOW)

    expect(out.heldRate).toBeCloseTo(0.5)
  })

  it('does not count a future meeting as failed to happen', () => {
    const out = meetingOutcomes([meeting('1', -5, null)], NOW)

    expect(out.booked).toBe(1)
    expect(out.heldRate).toBeNull()
  })

  it('counts a rescheduled meeting once', () => {
    /*
     * §4.18: "Maintain event IDs so rescheduling does not inflate bookings." A
     * prospect who moves the call twice is one meeting; counting three would
     * make rescheduling look like demand.
     */
    const out = meetingOutcomes(
      [meeting('evt-1', 9, null), meeting('evt-1', 5, null), meeting('evt-1', 2, true)],
      NOW,
    )

    expect(out.booked).toBe(1)
    expect(out.held).toBe(1)
  })

  it('excludes a cancellation from the booked count', () => {
    const out = meetingOutcomes([meeting('1', 2, null, 'cancelled'), meeting('2', 2, true)], NOW)

    expect(out.booked).toBe(1)
    expect(out.cancelled).toBe(1)
    expect(out.heldRate).toBe(1)
  })
})

describe('no invented benchmark', () => {
  it('says a baseline is being established rather than naming a target', () => {
    /*
     * §4.18: there is no sourced universal benchmark appropriate to every
     * industry, and showing another customer's rate — or an invented one — as a
     * target is forbidden outright.
     */
    const text = describeRate(acceptanceRate([], NOW))

    expect(text).toContain('Baseline being established')
    expect(text).not.toMatch(/\d+%/)
  })
})
