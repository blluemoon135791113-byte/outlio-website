/**
 * When a mailbox is allowed to send — M5 Phase 14.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  SENDING WINDOWS ARE WALL-CLOCK TIME IN A NAMED ZONE, NOT AN OFFSET.      ║
 * ║                                                                           ║
 * ║  "09:00–17:00, Monday to Friday, Europe/London" has to mean 09:00 local   ║
 * ║  in March and 09:00 local in July, which are different UTC instants. An   ║
 * ║  offset stored at setup time is silently wrong for half the year, and the ║
 * ║  failure mode is emails landing at 08:00 or 10:00 — early enough to look  ║
 * ║  automated, which is exactly what cold outbound must not look like.       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ NO DEPENDENCY. `Intl` already carries the IANA database, and the two
 * conversions needed here are small enough that adding a date library would be
 * more surface than it saves.
 */

export type SendSchedule = {
  /** IANA name, e.g. `Europe/London`. */
  timezone: string
  /** `HH:MM` or `HH:MM:SS`, local to `timezone`. */
  sendWindowStart: string
  sendWindowEnd: string
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  sendDays: number[]
}

export class UnusableScheduleError extends Error {}

/** Minutes past local midnight, from `HH:MM` or `HH:MM:SS`. */
function minutesOfDay(time: string): number {
  const [h, m] = time.split(':')
  const hours = Number(h)
  const minutes = Number(m ?? 0)

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    throw new UnusableScheduleError(`"${time}" is not a valid time of day.`)
  }
  return hours * 60 + minutes
}

type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number
}

const ISO_WEEKDAY: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
}

/** The wall-clock reading a person in `timeZone` would see at `instant`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  let parts
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    }).formatToParts(instant)
  } catch {
    // An unknown zone must be loud. Falling back to UTC would send at the
    // wrong local hour forever without anything looking broken.
    throw new UnusableScheduleError(`"${timeZone}" is not a known time zone.`)
  }

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    // `hour12: false` yields 24 for midnight in some ICU versions.
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: ISO_WEEKDAY[get('weekday')] ?? 1,
  }
}

/** The zone's UTC offset in milliseconds at a given instant. */
function offsetAt(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  // Seconds and milliseconds are dropped by the formatter, so compare on the
  // same granularity or the offset picks up a spurious remainder.
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000
}

/**
 * The UTC instant at which a given wall-clock time occurs in `timeZone`.
 *
 * ⚠️ TWO PASSES, BECAUSE THE OFFSET DEPENDS ON THE ANSWER. Guessing the offset
 * from the wrong instant puts the result an hour out on exactly the days
 * around a DST change — days when nobody is looking at the send log.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  minutesFromMidnight: number,
  timeZone: string,
): Date {
  const hour = Math.floor(minutesFromMidnight / 60)
  const minute = minutesFromMidnight % 60

  const naive = Date.UTC(year, month - 1, day, hour, minute)
  const firstGuess = new Date(naive - offsetAt(new Date(naive), timeZone))
  // Re-resolve using an instant that is already close to correct.
  return new Date(naive - offsetAt(firstGuess, timeZone))
}

/**
 * The first moment at or after `earliest` that this schedule permits.
 *
 * ⚠️ RETURNS `earliest` UNCHANGED WHEN IT IS ALREADY INSIDE A WINDOW, so a
 * message that is due now goes now rather than being pushed to tomorrow.
 *
 * @throws UnusableScheduleError if no day is enabled, rather than looping.
 */
export function nextSendTime(schedule: SendSchedule, earliest: Date): Date {
  const days = new Set(schedule.sendDays)
  if (days.size === 0) {
    throw new UnusableScheduleError(
      'This mailbox has no sending days enabled, so nothing could ever be sent from it.',
    )
  }

  const startMinutes = minutesOfDay(schedule.sendWindowStart)
  const endMinutes = minutesOfDay(schedule.sendWindowEnd)
  if (startMinutes >= endMinutes) {
    throw new UnusableScheduleError('The sending window ends before it starts.')
  }

  const local = zonedParts(earliest, schedule.timezone)
  const nowMinutes = local.hour * 60 + local.minute

  // Today, if today is allowed and we are inside or before the window.
  if (days.has(local.weekday)) {
    if (nowMinutes >= startMinutes && nowMinutes < endMinutes) return earliest
    if (nowMinutes < startMinutes) {
      return zonedTimeToUtc(local.year, local.month, local.day, startMinutes, schedule.timezone)
    }
  }

  /*
   * Otherwise walk forward day by day in the ACCOUNT'S calendar, not by adding
   * 24h to a UTC instant — across a DST change a "day" is 23 or 25 hours, and
   * adding 24 would drift the send an hour off the window every spring.
   *
   * Seven steps covers any weekday set; the eighth is a guard, not a case.
   */
  for (let ahead = 1; ahead <= 8; ahead += 1) {
    const probe = new Date(earliest.getTime() + ahead * 86_400_000)
    const p = zonedParts(probe, schedule.timezone)
    if (!days.has(p.weekday)) continue

    return zonedTimeToUtc(p.year, p.month, p.day, startMinutes, schedule.timezone)
  }

  throw new UnusableScheduleError('Could not find a permitted sending time within a week.')
}

/** Whether an instant falls inside the schedule. */
export function isWithinWindow(schedule: SendSchedule, instant: Date): boolean {
  return nextSendTime(schedule, instant).getTime() === instant.getTime()
}

/**
 * Spaces sends out by at least `minDelaySeconds`.
 *
 * ⚠️ PACING IS A DELIVERABILITY CONTROL, NOT A POLITENESS ONE. A mailbox that
 * emits sixty identical messages in a minute looks exactly like a compromised
 * account, and providers throttle or suspend on that pattern.
 */
export function applyMinimumDelay(
  schedule: SendSchedule,
  candidate: Date,
  lastSendAt: Date | null,
  minDelaySeconds: number,
): Date {
  if (!lastSendAt || minDelaySeconds <= 0) return nextSendTime(schedule, candidate)

  const earliest = new Date(lastSendAt.getTime() + minDelaySeconds * 1000)
  // Re-checked against the window: pushing past the delay can push past 17:00,
  // and the result must still be a legal sending moment.
  return nextSendTime(schedule, candidate > earliest ? candidate : earliest)
}
