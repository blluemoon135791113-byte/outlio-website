/**
 * §4.18's denominators — the part that decides whether a number is honest.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  EVERY METRIC HERE IS EASY TO COMPUTE AND EASY TO COMPUTE WRONGLY, AND    ║
 * ║  THE WRONG ANSWER IS ALWAYS PLAUSIBLE.                                    ║
 * ║                                                                           ║
 * ║  An acceptance rate that counts invitations sent yesterday reads LOW,      ║
 * ║  because nobody has had time to accept. A reply rate that counts replies   ║
 * ║  to the connection note reads HIGH, because those are not replies to the   ║
 * ║  message being measured. A held-meeting count taken from the calendar      ║
 * ║  reads HIGH, because a time passing is not somebody attending.            ║
 * ║                                                                           ║
 * ║  None of those look like bugs. They look like results, and somebody        ║
 * ║  decides whether to keep paying for the channel on the strength of them.  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

const DAY_MS = 86_400_000

/** §4.18: acceptance is measured over 14 calendar days from the send. */
export const ACCEPTANCE_WINDOW_DAYS = 14

export type InvitationRecord = {
  contactId: string
  /** R — when the owner recorded actually sending it. Never task-created. */
  sentAt: Date
  /** A — when acceptance was recorded, if it was. */
  acceptedAt: Date | null
  /**
   * Whether anybody actually looked at the thread within the window.
   *
   * ⚠️ THIS IS NOT `acceptedAt === null`. §4.18: "do not infer rejection". An
   * unobserved invitation is one nobody checked, and counting it as declined
   * invents a decision the prospect never made.
   */
  observed: boolean
}

export type RateResult = {
  /** `null` when the denominator is empty — no rate exists, 0% is a claim. */
  rate: number | null
  numerator: number
  denominator: number
  /**
   * Records excluded because their observation window has not closed yet.
   * Surfaced rather than hidden: it is the difference between "this campaign
   * is failing" and "this campaign started on Tuesday".
   */
  immature: number
  /** Share of the denominator anybody actually checked. */
  observationCoverage: number
  /**
   * True when coverage is incomplete. §4.18 requires the figure to be labelled
   * an observed LOWER BOUND in that case — the real rate can only be higher.
   */
  isLowerBound: boolean
}

function rateOf(
  numerator: number,
  denominator: number,
  immature: number,
  observed: number,
): RateResult {
  return {
    rate: denominator === 0 ? null : numerator / denominator,
    numerator,
    denominator,
    immature,
    observationCoverage: denominator === 0 ? 0 : observed / denominator,
    isLowerBound: denominator > 0 && observed < denominator,
  }
}

/** Latest record per contact — §4.18 counts unique people, not events. */
function uniqueByContact<T extends { contactId: string; sentAt: Date }>(rows: readonly T[]): T[] {
  const latest = new Map<string, T>()
  for (const row of rows) {
    const held = latest.get(row.contactId)
    if (!held || row.sentAt > held.sentAt) latest.set(row.contactId, row)
  }
  return [...latest.values()]
}

/**
 * Acceptance rate over a mature cohort.
 *
 * ⚠️ AN INVITATION SENT THREE DAYS AGO IS NOT IN THE DENOMINATOR. §4.18:
 * "unique recorded invitations with a FULL 14-day observation window". Including
 * it cannot raise the rate and can only lower it, so a campaign that started
 * this week reports a failure it has not had time to have — and the response to
 * that false signal is usually to change the copy, which destroys the only
 * cohort that would have answered the question.
 */
export function acceptanceRate(
  invitations: readonly InvitationRecord[],
  now: Date,
  windowDays: number = ACCEPTANCE_WINDOW_DAYS,
): RateResult {
  const rows = uniqueByContact(invitations)
  const windowMs = windowDays * DAY_MS

  const mature = rows.filter((r) => now.getTime() - r.sentAt.getTime() >= windowMs)
  const immature = rows.length - mature.length

  const accepted = mature.filter(
    (r) =>
      r.acceptedAt !== null &&
      /*
       * ⚠️ WITHIN the window, not merely at some point. An acceptance on day 40
       * is real and belongs in contact history, but counting it in a 14-day
       * rate compares it against invitations that only had 14 days.
       */
      r.acceptedAt.getTime() - r.sentAt.getTime() <= windowMs &&
      r.acceptedAt >= r.sentAt,
  ).length

  const observed = mature.filter((r) => r.observed).length

  return rateOf(accepted, mature.length, immature, observed)
}

export type DirectMessageRecord = {
  contactId: string
  /** M1 — when the first DM was actually recorded as sent. */
  sentAt: Date
  /**
   * A human reply to the MESSAGE.
   *
   * ⚠️ NOT A REPLY TO THE CONNECTION NOTE. §4.18: "Replies to invitation notes
   * belong to a separate invite-reply metric, not the DM numerator." They are
   * answers to a different question, they arrive before the DM exists, and
   * counting them inflates the number that decides whether the message works.
   */
  repliedToMessageAt: Date | null
  observed: boolean
}

/**
 * Reply rate on first DMs, over a mature cohort.
 *
 * The maturity window here is the caller's: §4.8's cadence puts the next touch
 * four business days out, so anything shorter measures a conversation that is
 * still in progress.
 */
export function directMessageReplyRate(
  messages: readonly DirectMessageRecord[],
  now: Date,
  windowDays: number,
): RateResult {
  const rows = uniqueByContact(messages)
  const windowMs = windowDays * DAY_MS

  const mature = rows.filter((r) => now.getTime() - r.sentAt.getTime() >= windowMs)
  const replied = mature.filter(
    (r) => r.repliedToMessageAt !== null && r.repliedToMessageAt >= r.sentAt,
  ).length

  return rateOf(replied, mature.length, rows.length - mature.length, mature.filter((r) => r.observed).length)
}

export type MeetingRecord = {
  /** ⚠️ Stable across reschedules, or rescheduling inflates the booking count. */
  eventId: string
  contactId: string
  scheduledFor: Date
  status: 'booked' | 'cancelled' | 'rescheduled'
  /**
   * Whether the meeting was recorded as HELD by a person.
   *
   * ⚠️ `null` IS NOT "HELD". §4.18: "A past calendar time is not proof of
   * attendance." The single most flattering available lie is to count every
   * booking whose time has passed.
   */
  heldRecorded: boolean | null
}

export type HeldBreakdown = {
  booked: number
  held: number
  noShow: number
  /** Time passed, nobody said what happened. Reported, never assumed either way. */
  unknown: number
  cancelled: number
  /** held / (booked whose time has passed), or null when nothing has. */
  heldRate: number | null
}

/**
 * Booked versus held, with the unknowns visible.
 *
 * ⚠️ RESCHEDULES ARE DEDUPED BY `eventId`. §4.18: "Maintain event IDs so
 * rescheduling does not inflate bookings." A prospect who moves the call twice
 * is one meeting, and counting three would make rescheduling look like demand.
 */
export function meetingOutcomes(meetings: readonly MeetingRecord[], now: Date): HeldBreakdown {
  const byEvent = new Map<string, MeetingRecord>()
  for (const m of meetings) {
    const held = byEvent.get(m.eventId)
    // The latest record for an event supersedes earlier ones.
    if (!held || m.scheduledFor > held.scheduledFor) byEvent.set(m.eventId, m)
  }
  const rows = [...byEvent.values()]

  const cancelled = rows.filter((m) => m.status === 'cancelled').length
  const live = rows.filter((m) => m.status !== 'cancelled')
  const elapsed = live.filter((m) => m.scheduledFor <= now)

  const held = elapsed.filter((m) => m.heldRecorded === true).length
  const noShow = elapsed.filter((m) => m.heldRecorded === false).length
  const unknown = elapsed.filter((m) => m.heldRecorded === null).length

  return {
    booked: live.length,
    held,
    noShow,
    unknown,
    cancelled,
    /*
     * ⚠️ THE DENOMINATOR IS ELAPSED BOOKINGS, NOT ALL OF THEM. A meeting next
     * Thursday has not failed to happen. And `unknown` stays in the
     * denominator: dropping it would quietly raise the rate every time somebody
     * forgot to record an outcome.
     */
    heldRate: elapsed.length === 0 ? null : held / elapsed.length,
  }
}

/**
 * How a rate should be described to a reader.
 *
 * ⚠️ "Baseline being established" IS THE FIRST-CAMPAIGN ANSWER. §4.18: there is
 * no sourced universal benchmark appropriate to every industry, and showing
 * another customer's rate — or an invented one — as a target is the thing the
 * brief forbids outright.
 */
export function describeRate(result: RateResult): string {
  if (result.denominator === 0) {
    return result.immature > 0
      ? `Baseline being established — ${result.immature} still within their observation window.`
      : 'Baseline being established.'
  }

  const pct = Math.round((result.rate ?? 0) * 100)
  const base = `${pct}% of ${result.denominator}`

  if (!result.isLowerBound) return `${base}.`

  const coverage = Math.round(result.observationCoverage * 100)
  return `${base}, observed lower bound — ${coverage}% of them were checked.`
}
