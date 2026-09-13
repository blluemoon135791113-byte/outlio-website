/**
 * §4.10's stage ladder, and the arithmetic that decides whether a task may be
 * released.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THESE NUMBERS ARE OUTLIO PILOT DEFAULTS. THEY ARE NOT LINKEDIN        ║
 * ║  LIMITS, AND NOTHING MAY PRESENT THEM AS SAFE.                           ║
 * ║                                                                           ║
 * ║  §4.10 and F10 both record that no universal numeric cap was verifiable   ║
 * ║  from LinkedIn's own documentation — vendor guidance for invitations      ║
 * ║  alone spans 10/day to 200/week, and LinkedIn's own page gives no daily   ║
 * ║  figure at all. What the ladder controls is what OUTLIO releases. A lower ║
 * ║  observed platform limit always wins, and a customer may always go lower. ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import type { TaskKind } from '@/lib/linkedin/outcomes'

/** The action kinds a budget is kept for. Mirrors `linkedin_action_kind`. */
export type ActionKind =
  | 'invitation'
  | 'direct_message'
  | 'inmail'
  | 'profile_review'
  | 'engagement'

export type Caps = {
  /** Calendar day in the sender's FIXED timezone. */
  perDay: number
  /**
   * Rolling seven days.
   *
   * ⚠️ NOT `perDay * 7`. §4.10's ladder deliberately sets it lower — stage 1 is
   * 5/day and 25/week, not 35 — so a sender cannot spend a week's allowance in
   * five days and call it compliant.
   */
  perWeek: number
}

/**
 * ⚠️ STAGE 0 RELEASES NOTHING, AND THAT IS THE DEFAULT. §4.10: "release zero
 * proactive actions until the owner reviews account status, confirms account
 * ownership and recent activity". A newly linked account is unreviewed, and
 * "unreviewed" is not "probably fine".
 */
export const STAGES: readonly Readonly<Record<ActionKind, Caps>>[] = [
  // Stage 0 — unreviewed / newly linked.
  {
    invitation: { perDay: 0, perWeek: 0 },
    direct_message: { perDay: 0, perWeek: 0 },
    inmail: { perDay: 0, perWeek: 0 },
    profile_review: { perDay: 0, perWeek: 0 },
    engagement: { perDay: 0, perWeek: 0 },
  },
  // Stage 1 — first five working days.
  {
    invitation: { perDay: 5, perWeek: 25 },
    direct_message: { perDay: 10, perWeek: 50 },
    inmail: { perDay: 1, perWeek: 5 },
    profile_review: { perDay: 10, perWeek: 70 },
    // §4.10: disabled in starters. Enabling it is a deliberate act.
    engagement: { perDay: 0, perWeek: 0 },
  },
  // Stage 2 — after explicit review.
  {
    invitation: { perDay: 10, perWeek: 50 },
    direct_message: { perDay: 15, perWeek: 75 },
    inmail: { perDay: 1, perWeek: 5 },
    profile_review: { perDay: 15, perWeek: 105 },
    engagement: { perDay: 0, perWeek: 0 },
  },
  // Stage 3 — after another five working days and review.
  {
    invitation: { perDay: 15, perWeek: 75 },
    direct_message: { perDay: 20, perWeek: 100 },
    inmail: { perDay: 1, perWeek: 5 },
    profile_review: { perDay: 20, perWeek: 140 },
    engagement: { perDay: 0, perWeek: 0 },
  },
]

export const MAX_STAGE = STAGES.length - 1

/** Which budget a manual task spends. */
export const KIND_FOR_TASK: Readonly<Record<TaskKind, ActionKind>> = {
  CONNECTION_REQUEST: 'invitation',
  DIRECT_MESSAGE: 'direct_message',
  INMAIL: 'inmail',
  REVIEW_PROFILE: 'profile_review',
}

export type BudgetInput = {
  stage: number
  kind: ActionKind
  /** Actions counted in the sender's current calendar day. */
  usedToday: number
  /** Actions counted in the trailing seven days. */
  usedThisWeek: number
  /**
   * §4.10's owner-reported allowance for manual LinkedIn use outside Outlio.
   *
   * ⚠️ SUBTRACTED FROM THE DAILY CAP, NOT ADDED TO THE USED COUNT. Those differ
   * when the reserve exceeds the cap: subtracting floors the result at zero,
   * whereas adding could make `used` exceed the cap and produce a negative
   * remainder that a caller might render as a number.
   */
  externalReservePerDay: number
  /**
   * A customer-set ceiling. §4.10 requires a customer to be able to go LOWER;
   * it never raises. `null` means they have not set one.
   */
  customerDailyCap: number | null
}

export type BudgetResult = {
  /** How many more actions of this kind may be released right now. */
  remaining: number
  /** Which window is binding — useful copy, and the reason it is not just a number. */
  limitedBy: 'day' | 'week' | 'stage' | null
}

function clampToZero(n: number): number {
  return n < 0 ? 0 : n
}

/**
 * How much of this kind's budget is left.
 *
 * ⚠️ THE TIGHTEST WINDOW WINS, ALWAYS. A sender with 10 left today and 2 left
 * this week has 2 — and reporting the daily figure would let a week's ladder be
 * spent in an afternoon, which is the burst LinkedIn names as a restriction
 * trigger.
 */
export function remainingBudget(input: BudgetInput): BudgetResult {
  const stage = STAGES[Math.min(Math.max(input.stage, 0), MAX_STAGE)]!
  const caps = stage[input.kind]

  /*
   * Stage 0 — and any kind a stage sets to zero, such as engagement — is not a
   * "0 remaining" to be waited out. Saying so lets the caller explain that the
   * account needs reviewing rather than that it is busy.
   */
  if (caps.perDay === 0 && caps.perWeek === 0) {
    return { remaining: 0, limitedBy: 'stage' }
  }

  const dailyCap = Math.min(
    caps.perDay,
    input.customerDailyCap ?? Number.POSITIVE_INFINITY,
  )

  const dayLeft = clampToZero(dailyCap - input.externalReservePerDay - input.usedToday)
  const weekLeft = clampToZero(caps.perWeek - input.usedThisWeek)

  /*
   * A tie reports the DAY, because that is the one that resets sooner and so
   * is the more useful thing to tell somebody who is waiting.
   */
  if (dayLeft <= weekLeft) return { remaining: dayLeft, limitedBy: 'day' }
  return { remaining: weekLeft, limitedBy: 'week' }
}

/**
 * Whether the stage may advance.
 *
 * ⚠️ IT NEVER ADVANCES ITSELF. §4.10: "Do not advance automatically on a timer.
 * A new account does not become trusted merely because several days elapsed."
 * This answers whether a human MAY advance it, and the caller records who did.
 */
export function canAdvanceStage(input: {
  stage: number
  lastOwnerReviewAt: Date | null
  now: Date
  /** Working days the owner must have operated at the current stage. */
  requiredDaysAtStage: number
}): { allowed: boolean; reason?: 'already_max' | 'never_reviewed' | 'too_soon' } {
  if (input.stage >= MAX_STAGE) return { allowed: false, reason: 'already_max' }

  /*
   * ⚠️ NO REVIEW AT ALL IS NOT "LONG ENOUGH AGO". The tempting reading of null
   * — nothing recorded, so nothing to wait for — is exactly backwards, and it
   * is the same mistake the preflight's thread check makes explicit.
   */
  if (input.lastOwnerReviewAt === null) return { allowed: false, reason: 'never_reviewed' }

  const elapsedDays =
    (input.now.getTime() - input.lastOwnerReviewAt.getTime()) / 86_400_000

  // A review timestamped in the future is clock skew, not readiness.
  if (elapsedDays < 0 || elapsedDays < input.requiredDaysAtStage) {
    return { allowed: false, reason: 'too_soon' }
  }

  return { allowed: true }
}
