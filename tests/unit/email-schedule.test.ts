/**
 * Sending windows across time zones and DST — M5 Phase 14.
 *
 * The failure this guards against is quiet: emails going out an hour early or
 * late for half the year. Nothing errors, nothing logs, and the only symptom
 * is mail arriving at 08:00 — early enough to look automated, which is exactly
 * what cold outbound must not look like.
 */
import { describe, expect, it } from 'vitest'

import {
  applyMinimumDelay,
  isWithinWindow,
  nextSendTime,
  UnusableScheduleError,
  zonedTimeToUtc,
} from '@/lib/email/schedule'

const london = {
  timezone: 'Europe/London',
  sendWindowStart: '09:00',
  sendWindowEnd: '17:00',
  sendDays: [1, 2, 3, 4, 5],
}

const newYork = { ...london, timezone: 'America/New_York' }
const kolkata = { ...london, timezone: 'Asia/Kolkata' }

describe('a time inside the window is left alone', () => {
  it('sends now when now is a Wednesday lunchtime in London', () => {
    // 2026-08-26 is a Wednesday. 12:00 BST = 11:00 UTC.
    const now = new Date('2026-08-26T11:00:00Z')
    expect(nextSendTime(london, now).toISOString()).toBe(now.toISOString())
    expect(isWithinWindow(london, now)).toBe(true)
  })
})

describe('DST is the case that matters', () => {
  it('opens at 09:00 LOCAL in British Summer Time (UTC+1)', () => {
    // Wednesday 26 August 2026, 06:00 UTC = 07:00 BST — before the window.
    const before = new Date('2026-08-26T06:00:00Z')
    // 09:00 BST is 08:00 UTC.
    expect(nextSendTime(london, before).toISOString()).toBe('2026-08-26T08:00:00.000Z')
  })

  it('opens at 09:00 LOCAL in Greenwich Mean Time (UTC+0)', () => {
    // Wednesday 21 January 2026, 06:00 UTC = 06:00 GMT.
    const before = new Date('2026-01-21T06:00:00Z')
    // 09:00 GMT is 09:00 UTC — a DIFFERENT UTC instant from the summer case,
    // which is the entire point of storing a zone rather than an offset.
    expect(nextSendTime(london, before).toISOString()).toBe('2026-01-21T09:00:00.000Z')
  })

  it('does not drift when stepping over the spring-forward boundary', () => {
    /*
     * The UK moves to BST on Sunday 29 March 2026. From Friday evening the
     * next permitted send is Monday 30 March at 09:00 BST = 08:00 UTC.
     * Naively adding 3 × 24h to a UTC instant would land an hour out.
     */
    const fridayEvening = new Date('2026-03-27T18:00:00Z')
    expect(nextSendTime(london, fridayEvening).toISOString()).toBe('2026-03-30T08:00:00.000Z')
  })

  it('does not drift over the autumn fall-back boundary', () => {
    // The UK returns to GMT on Sunday 25 October 2026.
    const fridayEvening = new Date('2026-10-23T18:00:00Z')
    expect(nextSendTime(london, fridayEvening).toISOString()).toBe('2026-10-26T09:00:00.000Z')
  })
})

describe('weekends and disabled days are skipped', () => {
  it('moves a Saturday to Monday morning', () => {
    // Saturday 29 August 2026.
    const saturday = new Date('2026-08-29T10:00:00Z')
    // Monday 31 August, 09:00 BST = 08:00 UTC.
    expect(nextSendTime(london, saturday).toISOString()).toBe('2026-08-31T08:00:00.000Z')
  })

  it('moves an after-hours Friday to Monday morning', () => {
    // Friday 28 August 2026, 19:00 BST = 18:00 UTC — after the window closes.
    const fridayNight = new Date('2026-08-28T18:00:00Z')
    expect(nextSendTime(london, fridayNight).toISOString()).toBe('2026-08-31T08:00:00.000Z')
  })

  it('honours a weekend-only schedule', () => {
    const weekendOnly = { ...london, sendDays: [6, 7] }
    // Wednesday 26 August → Saturday 29 August, 09:00 BST = 08:00 UTC.
    const wednesday = new Date('2026-08-26T11:00:00Z')
    expect(nextSendTime(weekendOnly, wednesday).toISOString()).toBe('2026-08-29T08:00:00.000Z')
  })

  it('handles a single-day schedule that requires a near-full week of waiting', () => {
    const mondaysOnly = { ...london, sendDays: [1] }
    // Tuesday 25 August → Monday 31 August.
    const tuesday = new Date('2026-08-25T11:00:00Z')
    expect(nextSendTime(mondaysOnly, tuesday).toISOString()).toBe('2026-08-31T08:00:00.000Z')
  })
})

describe('the zone is the account holder’s, not the server’s', () => {
  it('opens at 09:00 New York time, not 09:00 UTC', () => {
    // Wednesday 26 August 2026, 06:00 UTC = 02:00 EDT.
    const early = new Date('2026-08-26T06:00:00Z')
    // 09:00 EDT = 13:00 UTC.
    expect(nextSendTime(newYork, early).toISOString()).toBe('2026-08-26T13:00:00.000Z')
  })

  it('handles a half-hour offset zone', () => {
    // Asia/Kolkata is UTC+5:30 with no DST — the case that breaks any
    // implementation assuming whole-hour offsets.
    const early = new Date('2026-08-26T00:00:00Z') // 05:30 IST
    // 09:00 IST = 03:30 UTC.
    expect(nextSendTime(kolkata, early).toISOString()).toBe('2026-08-26T03:30:00.000Z')
  })
})

describe('a schedule that could never send is an error, not a hang', () => {
  it('rejects an empty set of days', () => {
    expect(() => nextSendTime({ ...london, sendDays: [] }, new Date())).toThrow(
      UnusableScheduleError,
    )
  })

  it('rejects an inverted window', () => {
    expect(() =>
      nextSendTime({ ...london, sendWindowStart: '17:00', sendWindowEnd: '09:00' }, new Date()),
    ).toThrow(UnusableScheduleError)
  })

  it('rejects an unknown time zone loudly rather than defaulting to UTC', () => {
    // Falling back to UTC would send at the wrong local hour forever with
    // nothing appearing broken.
    expect(() => nextSendTime({ ...london, timezone: 'Mars/Olympus' }, new Date())).toThrow(
      UnusableScheduleError,
    )
  })
})

describe('minimum delay between sends', () => {
  const wednesdayNoon = new Date('2026-08-26T11:00:00Z')

  it('spaces consecutive sends', () => {
    const last = new Date('2026-08-26T11:00:00Z')
    const next = applyMinimumDelay(london, wednesdayNoon, last, 300)
    expect(next.toISOString()).toBe('2026-08-26T11:05:00.000Z')
  })

  it('does not delay the first send of a mailbox', () => {
    expect(applyMinimumDelay(london, wednesdayNoon, null, 300).toISOString()).toBe(
      wednesdayNoon.toISOString(),
    )
  })

  it('pushes past the window into the NEXT day rather than sending late', () => {
    // Last send at 16:58 BST (15:58 UTC) with a 10-minute gap lands at 17:08
    // local, past the 17:00 close — so it must wait for tomorrow, not squeak
    // out after hours.
    const last = new Date('2026-08-26T15:58:00Z')
    const next = applyMinimumDelay(london, last, last, 600)
    expect(next.toISOString()).toBe('2026-08-27T08:00:00.000Z')
  })

  it('keeps the later of the candidate and the delay', () => {
    const last = new Date('2026-08-26T11:00:00Z')
    const laterCandidate = new Date('2026-08-26T14:00:00Z')
    expect(applyMinimumDelay(london, laterCandidate, last, 60).toISOString()).toBe(
      laterCandidate.toISOString(),
    )
  })
})

describe('wall-clock to UTC conversion', () => {
  it('resolves summer and winter to different UTC instants for the same local time', () => {
    expect(zonedTimeToUtc(2026, 8, 26, 9 * 60, 'Europe/London').toISOString()).toBe(
      '2026-08-26T08:00:00.000Z',
    )
    expect(zonedTimeToUtc(2026, 1, 21, 9 * 60, 'Europe/London').toISOString()).toBe(
      '2026-01-21T09:00:00.000Z',
    )
  })
})
