/**
 * The six conditions a flow must satisfy before it may send — M7 Phase 21.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE BRIEF NAMES SIX, AND ALL SIX ARE CHECKED EVERY TIME:                 ║
 * ║                                                                           ║
 * ║    provider connected · recipient eligible · not suppressed ·             ║
 * ║    limit available · provider healthy · user authorized                   ║
 * ║                                                                           ║
 * ║  ⚠️ SEND_EMAIL IS THE ONLY IRREVERSIBLE ACTION IN THE CATALOGUE. Every    ║
 * ║  other flow action can be undone — a tag removed, a task deleted, a stage ║
 * ║  moved back. An email cannot be unsent. That asymmetry is why this gate   ║
 * ║  exists at all, and why it fails CLOSED: any condition it cannot          ║
 * ║  evaluate is treated as unmet.                                            ║
 * ║                                                                           ║
 * ║  ⚠️ PURE. No database, no network. The caller gathers the facts; this     ║
 * ║  decides. That means every one of the six refusals is unit-testable       ║
 * ║  without standing up a mailbox.                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

export type SendGateFacts = {
  /** An account row exists and is not disconnected. */
  accountConnected: boolean
  /** The account's readiness gate (Phase 13) says it may send right now. */
  accountHealthy: boolean
  /** Why readiness refused, when it did. Surfaced verbatim. */
  accountBlockedReason?: string | null
  /** The recipient has a usable address. */
  recipientEmail: string | null
  /** The address is on the do-not-contact list. */
  suppressed: boolean
  suppressionReason?: string | null
  /** Messages this mailbox may still send today (ramp + configured limit). */
  remainingToday: number
  /** The person the flow runs as holds `email.campaign.launch`. */
  actorAuthorized: boolean
  /**
   * ⚠️ SEPARATE FROM SUPPRESSION. A contact may be perfectly contactable and
   * still ineligible for THIS send — already enrolled, already emailed today,
   * or erased. Collapsing the two would report "unsubscribed" for someone who
   * simply got a message an hour ago.
   */
  recipientEligible: boolean
  recipientIneligibleReason?: string | null
}

export type SendGateFailure =
  | 'provider_not_connected'
  | 'provider_unhealthy'
  | 'no_recipient'
  | 'suppressed'
  | 'daily_limit_reached'
  | 'not_authorized'
  | 'recipient_ineligible'

export type SendGateResult =
  | { allowed: true; email: string; remainingToday: number }
  | { allowed: false; failure: SendGateFailure; reason: string }

/**
 * Decides whether this send may proceed.
 *
 * ⚠️ ORDERED MOST-DEFINITIVE FIRST, and that order is a product decision. A
 * suppressed recipient is reported as suppressed even if the mailbox is also
 * over its daily limit, because "they asked not to be contacted" is the fact
 * the operator needs — fixing the limit would not make this send acceptable.
 */
export function checkSendGate(facts: SendGateFacts): SendGateResult {
  // 1. Authorization. Nothing else matters if the actor may not send at all.
  if (!facts.actorAuthorized) {
    return {
      allowed: false,
      failure: 'not_authorized',
      reason: 'This flow runs as someone who is not allowed to send email.',
    }
  }

  // 2. A recipient at all.
  if (!facts.recipientEmail) {
    return {
      allowed: false,
      failure: 'no_recipient',
      reason: 'This contact has no email address.',
    }
  }

  /*
   * 3. Suppression, before anything about the mailbox. A person who asked not
   * to be contacted has not become contactable because we fixed a mailbox.
   */
  if (facts.suppressed) {
    return {
      allowed: false,
      failure: 'suppressed',
      reason: facts.suppressionReason
        ? `This address is on the do-not-contact list (${facts.suppressionReason}).`
        : 'This address is on the do-not-contact list.',
    }
  }

  // 4. Eligibility for THIS send, which is not the same as suppression.
  if (!facts.recipientEligible) {
    return {
      allowed: false,
      failure: 'recipient_ineligible',
      reason: facts.recipientIneligibleReason ?? 'This contact is not eligible for this send.',
    }
  }

  // 5. The mailbox exists and is connected.
  if (!facts.accountConnected) {
    return {
      allowed: false,
      failure: 'provider_not_connected',
      reason: 'No connected mailbox is available to send from.',
    }
  }

  // 6. Readiness — the Phase 13 safety gate.
  if (!facts.accountHealthy) {
    return {
      allowed: false,
      failure: 'provider_unhealthy',
      reason: facts.accountBlockedReason ?? 'This mailbox is not currently able to send.',
    }
  }

  /*
   * 7. Capacity. Last because it is the most transient: it clears by itself
   * tomorrow, so reporting it over a suppression would send someone to wait
   * for a limit to reset on a send that must never happen.
   */
  if (facts.remainingToday <= 0) {
    return {
      allowed: false,
      failure: 'daily_limit_reached',
      reason: 'This mailbox has sent everything it is allowed to today.',
    }
  }

  return { allowed: true, email: facts.recipientEmail, remainingToday: facts.remainingToday }
}

/**
 * Whether a refusal is worth retrying later.
 *
 * ⚠️ THE DISTINCTION MATTERS FOR THE FLOW'S SHAPE. A daily limit clears
 * overnight, so the run should wait. A suppression never clears, so waiting
 * would park a run forever on something that will never become true.
 */
export function isTransient(failure: SendGateFailure): boolean {
  return failure === 'daily_limit_reached' || failure === 'provider_unhealthy'
}
