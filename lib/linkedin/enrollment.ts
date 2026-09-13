/**
 * Enrollment state — §4.7's "a single campaign status must not stand in for
 * all four".
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A REPLY ENDS THE SEQUENCE AND LEAVES THE GOAL UNMET. THOSE ARE TWO       ║
 * ║  FACTS AND ONE STATUS COLUMN CANNOT HOLD BOTH.                           ║
 * ║                                                                           ║
 * ║  §4.7: "A reply ends unsolicited sequencing but may leave the commercial  ║
 * ║  goal unmet." A product that records only `completed` cannot tell the      ║
 * ║  difference between somebody who booked a call and somebody who said       ║
 * ║  "wrong person" — and it will report both as the same outcome to the       ║
 * ║  person deciding whether the channel works.                               ║
 * ║                                                                           ║
 * ║  So a terminal enrollment carries a REASON, always, and the reason is      ║
 * ║  what the reporting layer counts.                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

export type EnrollmentState =
  | 'DRAFT'
  | 'ELIGIBILITY_REVIEW'
  | 'READY'
  | 'RUNNING'
  | 'WAITING_EVENT'
  | 'WAITING_APPROVAL'
  | 'WAITING_MANUAL_ACTION'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'

export type TerminalReason =
  | 'GOAL_MET'
  | 'REPLIED'
  | 'NOT_INTERESTED'
  | 'DNC'
  | 'NOT_ACCEPTED'
  | 'NO_REPLY'
  | 'EXPIRED'
  | 'DISQUALIFIED'
  | 'MANUAL_STOP'

export const TERMINAL_STATES = ['COMPLETED', 'CANCELLED', 'FAILED'] as const

export function isTerminal(state: EnrollmentState): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state)
}

/**
 * ⚠️ ONLY `GOAL_MET` MEANS THE THING WORKED.
 *
 * `REPLIED` is the one that gets miscounted: a reply is a good sign and it is
 * not an outcome. §4.18 asks for qualified conversations and held meetings as
 * separate denominators precisely so a wall of "replied" cannot be presented
 * as success.
 */
export function reasonMeansSuccess(reason: TerminalReason): boolean {
  return reason === 'GOAL_MET'
}

/** Which terminal state a reason belongs to. */
const REASON_STATE: Readonly<Record<TerminalReason, EnrollmentState>> = {
  GOAL_MET: 'COMPLETED',
  // Sequencing ended as designed, whatever the commercial result.
  REPLIED: 'COMPLETED',
  NO_REPLY: 'COMPLETED',
  NOT_ACCEPTED: 'COMPLETED',
  // Somebody or something stopped it early.
  NOT_INTERESTED: 'CANCELLED',
  DNC: 'CANCELLED',
  MANUAL_STOP: 'CANCELLED',
  DISQUALIFIED: 'CANCELLED',
  EXPIRED: 'CANCELLED',
}

export function stateForReason(reason: TerminalReason): EnrollmentState {
  return REASON_STATE[reason]
}

/**
 * Legal transitions.
 *
 * ⚠️ EVERY NON-TERMINAL STATE CAN REACH A TERMINAL ONE. A reply, a DNC or a
 * hostile message can arrive at any moment, including while a task sits
 * approved and waiting, and a state machine that cannot accept that from
 * `WAITING_APPROVAL` is a state machine that keeps outreach running after
 * somebody asked it to stop.
 */
const TRANSITIONS: Readonly<Record<EnrollmentState, readonly EnrollmentState[]>> = {
  DRAFT: ['ELIGIBILITY_REVIEW', 'CANCELLED'],
  ELIGIBILITY_REVIEW: ['READY', 'CANCELLED', 'FAILED'],
  READY: ['RUNNING', 'PAUSED', 'CANCELLED'],
  RUNNING: [
    'WAITING_EVENT',
    'WAITING_APPROVAL',
    'WAITING_MANUAL_ACTION',
    'PAUSED',
    'COMPLETED',
    'CANCELLED',
    'FAILED',
  ],
  WAITING_EVENT: ['RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'],
  WAITING_APPROVAL: ['RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'],
  WAITING_MANUAL_ACTION: ['RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'],
  PAUSED: ['RUNNING', 'CANCELLED'],
  /*
   * ⚠️ TERMINAL MEANS TERMINAL. §4.7: "Late events update CRM history without
   * silently reopening a terminal enrollment." A late acceptance after
   * NOT_ACCEPTED is recorded and offered for a NEW owner review — it never
   * replays the expired invitation route, because the prospect would receive a
   * message referring to a request they answered weeks ago.
   */
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
}

export function canTransition(from: EnrollmentState, to: EnrollmentState): boolean {
  return TRANSITIONS[from].includes(to)
}

export type LateEventDisposition =
  /** Applied to the enrollment. */
  | { kind: 'applied'; to: EnrollmentState }
  /**
   * Recorded against the contact's history and surfaced for review, but the
   * enrollment stays terminal.
   */
  | { kind: 'recorded_for_review'; because: 'enrollment_already_terminal' }

/**
 * What to do with an event that arrives after the enrollment ended.
 *
 * ⚠️ IT IS NEVER DISCARDED AND NEVER REPLAYED. Discarding loses a fact about a
 * real person — a late acceptance is still an acceptance, and the CRM should
 * show it. Replaying restarts outreach that already concluded. §4.7 asks for
 * the third thing: record it, and let a human decide whether to start
 * something new.
 */
export function disposeLateEvent(
  current: EnrollmentState,
  proposed: EnrollmentState,
): LateEventDisposition {
  if (isTerminal(current)) {
    return { kind: 'recorded_for_review', because: 'enrollment_already_terminal' }
  }
  if (!canTransition(current, proposed)) {
    return { kind: 'recorded_for_review', because: 'enrollment_already_terminal' }
  }
  return { kind: 'applied', to: proposed }
}

/** §4.7's IF_NOW: evaluated once, with an explicit third answer. */
export type ConditionResult = 'TRUE' | 'FALSE' | 'UNKNOWN'

/**
 * §4.7's WAIT_FOR_EVENT outcomes.
 *
 * ⚠️ `UNAVAILABLE` IS NOT `TIMEOUT`. A wait that timed out watched for the
 * event and did not see it; a wait that was unavailable could not watch at all
 * — no permitted connector, no recorded observation. Treating the second as
 * the first asserts "it did not happen" when the honest answer is "nobody
 * looked", and §4.18 needs that distinction to report an observed lower bound
 * rather than a rejection rate.
 */
export type WaitOutcome = 'SUCCESS' | 'TIMEOUT' | 'UNAVAILABLE'
