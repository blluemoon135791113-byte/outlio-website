/**
 * Gradual volume increase — M5 Phase 13.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS IS THE HONEST ALTERNATIVE TO A WARMUP NETWORK.                      ║
 * ║                                                                           ║
 * ║  A warmup network manufactures engagement: pools of accounts emailing     ║
 * ║  each other and marking the results as important, to convince a spam      ║
 * ║  filter that strangers want this mail. It is deception aimed at the       ║
 * ║  recipient's provider, and the brief rules it out.                        ║
 * ║                                                                           ║
 * ║  What actually works is unglamorous: send a small number of real emails   ║
 * ║  to real people, and increase slowly while watching real bounce and       ║
 * ║  complaint rates. That is all this file does.                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

export type RampSettings = {
  enabled: boolean
  /** ISO date (YYYY-MM-DD) the ramp began, or null if it has not started. */
  startedOn: string | null
  initialDaily: number
  dailyIncrement: number
  targetDaily: number
  /** A hard ceiling the customer set, independent of the ramp. */
  configuredDailyLimit: number | null
}

/**
 * ⚠️ CONSERVATIVE ON PURPOSE. The failure is asymmetric: starting too low costs
 * a few days, starting too high burns a domain and there is no undo. These are
 * deliberately slower than most tools default to.
 */
export const RAMP_DEFAULTS = {
  initialDaily: 20,
  dailyIncrement: 5,
  targetDaily: 200,
} as const

/** Whole days elapsed between two ISO dates, floored at zero. */
export function daysBetween(startIso: string, todayIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00Z`)
  const today = Date.parse(`${todayIso}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(today)) return 0
  return Math.max(0, Math.round((today - start) / 86_400_000))
}

/**
 * How many messages this mailbox may send today.
 *
 * ⚠️ THE LOWEST LIMIT WINS. The ramp and the customer's own configured ceiling
 * are both maxima, not targets — taking the larger would let a ramping mailbox
 * ignore the ramp the moment someone typed a bigger number into settings.
 */
export function dailyAllowance(settings: RampSettings, todayIso: string): number {
  const configured = settings.configuredDailyLimit

  if (!settings.enabled) {
    // Ramp off: the customer's ceiling is the only limit. `null` means the
    // customer set none, so the target acts as a backstop rather than
    // unlimited — an accidental unlimited is how a domain dies overnight.
    return configured ?? settings.targetDaily
  }

  if (!settings.startedOn) {
    // Ramp enabled but never started: day one has not happened yet, so the
    // mailbox gets the opening allowance rather than nothing.
    return Math.min(settings.initialDaily, configured ?? settings.initialDaily)
  }

  const days = daysBetween(settings.startedOn, todayIso)
  const ramped = settings.initialDaily + days * settings.dailyIncrement
  const capped = Math.min(ramped, settings.targetDaily)

  return configured === null ? capped : Math.min(capped, configured)
}

/** Whether the ramp is still climbing toward its target. */
export function isRamping(settings: RampSettings, todayIso: string): boolean {
  if (!settings.enabled) return false
  if (!settings.startedOn) return true
  return dailyAllowance({ ...settings, configuredDailyLimit: null }, todayIso) < settings.targetDaily
}

export type RampDecision =
  | { allowed: true; remaining: number; allowance: number }
  | { allowed: false; reason: string; allowance: number; sentToday: number }

/**
 * The scheduler's gate — M5 criterion 5, "ramp limits enforced by scheduler".
 *
 * ⚠️ CHECKED AT ENQUEUE, WHERE IT CAN STILL BE ACTED ON. Refusing at send time
 * would leave the message claimed and then failed, burning an attempt and
 * telling the customer nothing until after the fact.
 */
export function checkRampAllowance(
  settings: RampSettings,
  sentToday: number,
  todayIso: string,
): RampDecision {
  const allowance = dailyAllowance(settings, todayIso)

  if (sentToday >= allowance) {
    return {
      allowed: false,
      allowance,
      sentToday,
      reason: settings.enabled
        ? `This mailbox has sent its ${allowance} messages for today while it builds up sending volume. The allowance rises by ${settings.dailyIncrement} a day.`
        : `This mailbox has reached its daily limit of ${allowance} messages.`,
    }
  }

  return { allowed: true, allowance, remaining: allowance - sentToday }
}
