/**
 * Is this mailbox safe to send from? — M5 Phase 13.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE SCORE DESCRIBES CONFIGURATION AND OBSERVED OUTCOMES.                 ║
 * ║  IT IS NOT, AND MUST NEVER BE PRESENTED AS, INBOX PLACEMENT.              ║
 * ║                                                                           ║
 * ║  Nobody outside Google and Microsoft can measure whether a message landed ║
 * ║  in the inbox or the spam folder. Vendors who show "94% inbox placement"  ║
 * ║  are extrapolating from seed accounts they control, which are not your    ║
 * ║  customers and are not treated like them. Claiming that number here would ║
 * ║  be inventing data, which this codebase does not do.                     ║
 * ║                                                                           ║
 * ║  What CAN be known honestly: whether the domain is configured correctly,  ║
 * ║  whether the mailbox authenticates, how much it has sent, and how much of ║
 * ║  that bounced or drew a complaint. That is what this file computes.       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import type { EmailCheckStatus, DomainAuthResult } from '@/lib/email/dns'

export type ReadinessState =
  | 'not_configured'
  | 'authentication_required'
  | 'ramping'
  | 'ready'
  | 'warning'
  | 'throttled'
  | 'paused'
  | 'disconnected'
  | 'error'

export type ReadinessCheck = {
  id: string
  label: string
  status: EmailCheckStatus
  /** Contribution to the score. Zero for checks that only inform. */
  weight: number
  /** Plain-language finding. Shown to the customer verbatim. */
  detail: string
}

/**
 * ⚠️ THRESHOLDS ARE STATED WITH THEIR REASONING, not tuned by feel.
 *
 * The complaint gate is the brief's: 0.3%. It is not arbitrary — Google
 * Postmaster Tools treats 0.3% as the line above which delivery degrades, and
 * a sender who crosses it is already in trouble by the time they notice.
 *
 * Bounce thresholds follow the same logic: a 5% bounce rate means one address
 * in twenty was never real, which reads as a purchased or stale list.
 */
export const THRESHOLDS = {
  /** Above this, stop sending. The brief's gate. */
  complaintCritical: 0.003,
  /** Above this, warn: still sending, but the trend is wrong. */
  complaintWarning: 0.001,
  /** Above this, stop: the list quality is damaging the domain. */
  bounceCritical: 0.1,
  bounceWarning: 0.05,
  /** Rates below this volume are noise — 1 bounce in 3 sends is not 33%. */
  minimumVolumeForRates: 20,
} as const

export type ReadinessInput = {
  /** Set when the account is disconnected, paused, or has never connected. */
  accountStatus: 'connected' | 'not_configured' | 'disconnected' | 'paused'
  /** Did the last connection test authenticate? */
  connectionOk: boolean
  connectionDetail?: string
  /** Whether the last connection failure was specifically an auth failure. */
  authenticationFailed?: boolean
  domain: DomainAuthResult
  /** Does the sending address's domain match what SPF/DKIM authorise? */
  fromDomainAligned: boolean
  /** RFC 8058 one-click unsubscribe — we set the header, so this is ours. */
  listUnsubscribeCapable: boolean
  sent24h: number
  sent7d: number
  bounced: number
  complained: number
  /** Provider told us to slow down. */
  throttled?: boolean
  /** True while the configured ramp is still climbing. */
  rampInProgress: boolean
}

export type ReadinessResult = {
  state: ReadinessState
  score: number
  checks: ReadinessCheck[]
  bounceRate: number | null
  complaintRate: number | null
  /** Why sending is blocked, or null when it is not. */
  blockedReason: string | null
}

/**
 * A rate, or `null` when the sample is too small to mean anything.
 *
 * ⚠️ NULL, NOT ZERO, AND NOT A MISLEADING PERCENTAGE. One bounce out of three
 * sends is not a 33% bounce rate — it is three sends. Reporting it as 33%
 * would pause a brand-new mailbox on its first afternoon, which is exactly
 * when a ramping account looks worst and matters least.
 */
export function rateOf(numerator: number, denominator: number): number | null {
  if (denominator < THRESHOLDS.minimumVolumeForRates) return null
  if (denominator === 0) return null
  return numerator / denominator
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`
}

/**
 * Assesses one mailbox.
 *
 * ⚠️ PURE. No DNS, no database, no clock — every input is passed in, so every
 * threshold and transition is testable without a network.
 */
export function assessReadiness(input: ReadinessInput): ReadinessResult {
  const checks: ReadinessCheck[] = []

  // --- Connection ---------------------------------------------------------
  checks.push({
    id: 'connection',
    label: 'Mailbox connection',
    status: input.connectionOk ? 'pass' : 'fail',
    weight: 25,
    detail: input.connectionOk
      ? 'Outlio can sign in and send from this mailbox.'
      : (input.connectionDetail ?? 'Outlio could not sign in to this mailbox.'),
  })

  // --- Domain authentication ----------------------------------------------
  checks.push({
    id: 'spf',
    label: 'SPF',
    status: input.domain.spf.status,
    weight: 15,
    detail: input.domain.spf.detail,
  })

  checks.push({
    id: 'dkim',
    label: 'DKIM',
    status: input.domain.dkim.status,
    weight: 15,
    detail: input.domain.dkim.detail,
  })

  checks.push({
    id: 'dmarc',
    label: 'DMARC',
    status: input.domain.dmarc.status,
    weight: 15,
    detail: input.domain.dmarc.detail,
  })

  checks.push({
    id: 'alignment',
    label: 'From-domain alignment',
    status: input.fromDomainAligned ? 'pass' : 'warn',
    weight: 10,
    detail: input.fromDomainAligned
      ? 'The From address matches the domain that SPF and DKIM authorise.'
      : 'The From address does not match the authenticated domain, so DMARC will not align. Mail is far more likely to be filtered.',
  })

  checks.push({
    id: 'list_unsubscribe',
    label: 'One-click unsubscribe',
    status: input.listUnsubscribeCapable ? 'pass' : 'fail',
    weight: 5,
    detail: input.listUnsubscribeCapable
      ? 'Outlio adds an RFC 8058 one-click unsubscribe header.'
      : 'No unsubscribe header can be added, which bulk senders are required to provide.',
  })

  // --- Observed outcomes --------------------------------------------------
  const bounceRate = rateOf(input.bounced, input.sent7d)
  const complaintRate = rateOf(input.complained, input.sent7d)

  checks.push({
    id: 'volume',
    label: 'Sending volume',
    status: 'pass',
    weight: 0, // Informational: volume is context, not a pass/fail judgement.
    detail: `${input.sent24h} sent in the last 24 hours, ${input.sent7d} in the last 7 days.`,
  })

  checks.push({
    id: 'bounce_rate',
    label: 'Bounce rate',
    status:
      bounceRate === null
        ? 'unknown'
        : bounceRate >= THRESHOLDS.bounceCritical
          ? 'fail'
          : bounceRate >= THRESHOLDS.bounceWarning
            ? 'warn'
            : 'pass',
    weight: 10,
    detail:
      bounceRate === null
        ? `Not enough sending yet to measure — rates need at least ${THRESHOLDS.minimumVolumeForRates} messages.`
        : `${pct(bounceRate)} of the last ${input.sent7d} messages bounced.`,
  })

  checks.push({
    id: 'complaint_rate',
    label: 'Complaint rate',
    status:
      complaintRate === null
        ? 'unknown'
        : complaintRate >= THRESHOLDS.complaintCritical
          ? 'fail'
          : complaintRate >= THRESHOLDS.complaintWarning
            ? 'warn'
            : 'pass',
    weight: 5,
    detail:
      complaintRate === null
        ? `Not enough sending yet to measure — rates need at least ${THRESHOLDS.minimumVolumeForRates} messages.`
        : `${pct(complaintRate)} of the last ${input.sent7d} messages were marked as spam. The safe ceiling is ${pct(THRESHOLDS.complaintCritical)}.`,
  })

  /*
   * ⚠️ `unknown` SCORES AS HALF, NOT ZERO AND NOT FULL.
   *
   * A DKIM record we could not verify is not proof of a problem, so scoring it
   * zero would panic a correctly-configured customer. It is not proof of
   * correctness either, so scoring it full would tell someone with no DKIM at
   * all that they are fine. Half is the honest position: it lowers the score
   * enough to prompt a look, without asserting a fault.
   */
  const scored = checks.filter((c) => c.weight > 0)
  const totalWeight = scored.reduce((sum, c) => sum + c.weight, 0)
  const earned = scored.reduce((sum, c) => {
    if (c.status === 'pass' || c.status === 'not_applicable') return sum + c.weight
    if (c.status === 'warn') return sum + c.weight * 0.5
    if (c.status === 'unknown') return sum + c.weight * 0.5
    return sum
  }, 0)

  const score = totalWeight === 0 ? 0 : Math.round((earned / totalWeight) * 100)

  const { state, blockedReason } = resolveState(input, bounceRate, complaintRate)

  return { state, score, checks, bounceRate, complaintRate, blockedReason }
}

/**
 * The state machine.
 *
 * ⚠️ PRECEDENCE IS DELIBERATE AND ORDERED MOST-SEVERE-FIRST. A disconnected
 * mailbox with a high bounce rate is DISCONNECTED, not WARNING: telling
 * someone to clean their list when the real problem is that we cannot sign in
 * sends them to fix the wrong thing.
 */
function resolveState(
  input: ReadinessInput,
  bounceRate: number | null,
  complaintRate: number | null,
): { state: ReadinessState; blockedReason: string | null } {
  if (input.accountStatus === 'disconnected') {
    return { state: 'disconnected', blockedReason: 'This mailbox is disconnected.' }
  }

  if (input.accountStatus === 'not_configured') {
    return { state: 'not_configured', blockedReason: 'This mailbox is not set up yet.' }
  }

  if (input.accountStatus === 'paused') {
    return { state: 'paused', blockedReason: 'Sending from this mailbox is paused.' }
  }

  if (!input.connectionOk) {
    return input.authenticationFailed
      ? {
          state: 'authentication_required',
          blockedReason: 'Outlio can no longer sign in to this mailbox. Reconnect it.',
        }
      : { state: 'error', blockedReason: 'Outlio cannot reach this mailbox.' }
  }

  if (input.throttled) {
    return {
      state: 'throttled',
      blockedReason: 'The provider is rate-limiting this mailbox. Sending will resume by itself.',
    }
  }

  /*
   * ⚠️ THE COMPLAINT GATE BLOCKS. This is the one number that gets a domain
   * blacklisted rather than merely filtered, and the recipients have already
   * said, explicitly, that they did not want this mail.
   */
  if (complaintRate !== null && complaintRate >= THRESHOLDS.complaintCritical) {
    return {
      state: 'warning',
      blockedReason: `Too many recipients marked this mail as spam (${pct(complaintRate)}, ceiling ${pct(THRESHOLDS.complaintCritical)}). Sending is stopped to protect the domain.`,
    }
  }

  if (bounceRate !== null && bounceRate >= THRESHOLDS.bounceCritical) {
    return {
      state: 'warning',
      blockedReason: `Too many addresses bounced (${pct(bounceRate)}). Clean the list before sending more.`,
    }
  }

  // Above the warning line but below the gate: keep sending, say so clearly.
  if (
    (complaintRate !== null && complaintRate >= THRESHOLDS.complaintWarning) ||
    (bounceRate !== null && bounceRate >= THRESHOLDS.bounceWarning)
  ) {
    return { state: 'warning', blockedReason: null }
  }

  if (input.rampInProgress) {
    return { state: 'ramping', blockedReason: null }
  }

  return { state: 'ready', blockedReason: null }
}

/** Whether a campaign may use this mailbox. The safety gate. */
export function canSendFrom(result: ReadinessResult): boolean {
  return result.blockedReason === null
}

/**
 * ⚠️ THE LABEL IS PART OF THE CONTRACT. Every surface showing this number must
 * say what it is, so nobody reads it as a deliverability guarantee.
 */
export const SCORE_LABEL = 'Setup and sending health'
export const SCORE_CAVEAT =
  'Based on your domain settings and your real bounce and complaint rates. This is not an inbox-placement figure — nobody outside the mailbox providers can measure that.'
