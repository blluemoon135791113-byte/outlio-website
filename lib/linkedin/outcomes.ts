/**
 * What a result form may record — §4.13's "records what actually happened".
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  "'MARK REQUEST SENT' CANNOT MARK ACCEPTANCE."                           ║
 * ║                                                                           ║
 * ║  §4.13 states it as a UI rule and §4.7 states the fact underneath it: "a  ║
 * ║  sent request is not an accepted connection". They are two different       ║
 * ║  events, days apart, and only one of them is something the operator did.  ║
 * ║                                                                           ║
 * ║  Collapsing them is not a cosmetic error. Acceptance is what gates the     ║
 * ║  first DM, so a form that lets "sent" imply "accepted" sends a message     ║
 * ║  into a connection that was never made — to somebody who declined, or who ║
 * ║  never saw the request.                                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * So there are two vocabularies, and this module's whole job is that they do
 * not mix:
 *
 *   TASK OUTCOMES  — what the operator did with the task in front of them.
 *   OBSERVATIONS   — what they later saw happen, recorded against the contact.
 *
 * A result form offers the first. It can never offer the second, because the
 * second is not an outcome of doing anything.
 */

/** The kinds of manual task an operator can be handed (§4.6). */
export type TaskKind =
  | 'REVIEW_PROFILE'
  | 'CONNECTION_REQUEST'
  | 'DIRECT_MESSAGE'
  | 'INMAIL'

/** What the operator did with the task. §4.7's manual evidence events. */
export type TaskOutcome =
  | 'REQUEST_MARKED_SENT'
  | 'MESSAGE_MARKED_SENT'
  | 'PROFILE_REVIEW_RECORDED'
  | 'SKIPPED'
  | 'FAILED'
  /**
   * ⚠️ NOT THE SAME AS `FAILED`, AND THE DISTINCTION IS LOAD-BEARING. §4.17:
   * "an expired action-ready session does not prove 'not sent'. Ask the owner
   * to confirm sent, not sent, or unknown." An unknown outcome keeps its quota
   * reservation and must never release another attempt, because the thing we
   * cannot rule out is that a stranger already received it.
   */
  | 'OUTCOME_UNKNOWN'

/**
 * What was later seen to happen. Recorded against the contact, never as the
 * completion of an outreach task.
 */
export type Observation =
  | 'CONNECTION_ACCEPTANCE_RECORDED'
  | 'INBOX_REVIEW_RECORDED'
  | 'REPLY_RECORDED'
  | 'MEETING_BOOKED_RECORDED'
  | 'MEETING_HELD_RECORDED'

const ALWAYS: readonly TaskOutcome[] = ['SKIPPED', 'FAILED', 'OUTCOME_UNKNOWN']

/**
 * ⚠️ ONE POSITIVE OUTCOME PER KIND, DELIBERATELY. A task is a request to
 * perform exactly one action, so "what happened" has exactly one affirmative
 * answer. Offering two invites the form to become a place where state is
 * asserted rather than recorded.
 */
const POSITIVE: Readonly<Record<TaskKind, TaskOutcome>> = {
  REVIEW_PROFILE: 'PROFILE_REVIEW_RECORDED',
  CONNECTION_REQUEST: 'REQUEST_MARKED_SENT',
  DIRECT_MESSAGE: 'MESSAGE_MARKED_SENT',
  INMAIL: 'MESSAGE_MARKED_SENT',
}

/** The outcomes a result form may offer for this task. */
export function allowedOutcomes(kind: TaskKind): readonly TaskOutcome[] {
  return [POSITIVE[kind], ...ALWAYS]
}

export function isAllowedOutcome(kind: TaskKind, outcome: string): outcome is TaskOutcome {
  return (allowedOutcomes(kind) as readonly string[]).includes(outcome)
}

/**
 * Whether recording this outcome frees the sender's quota slot.
 *
 * ⚠️ `OUTCOME_UNKNOWN` DOES NOT. §4.17 requires the reservation retained
 * conservatively — an action we cannot rule out having happened has to keep
 * counting, because the cost of being wrong is a restriction on somebody's real
 * account. Only a definite non-action gives the slot back.
 */
export function releasesQuota(outcome: TaskOutcome): boolean {
  return outcome === 'SKIPPED' || outcome === 'FAILED'
}

/**
 * Whether this outcome may be applied to many tasks at once.
 *
 * ⚠️ §4.13: "Manual tasks are never bulk-marked sent." Bulk skip is permitted
 * and bulk *sent* is not, because one is a statement about a decision the
 * operator made in Outlio and the other is a claim that they performed N
 * actions in LinkedIn's interface — which, at bulk scale, they did not.
 */
export function allowsBulk(outcome: TaskOutcome): boolean {
  return outcome === 'SKIPPED'
}

/** A skip has to say why; §4.13 lists "skip with reason" as the control. */
export function requiresReason(outcome: TaskOutcome): boolean {
  return outcome === 'SKIPPED' || outcome === 'FAILED' || outcome === 'OUTCOME_UNKNOWN'
}

/**
 * Observations are never task outcomes.
 *
 * The function exists to be called by the result form's validator, so the rule
 * is enforced rather than merely described in a comment — the distinction this
 * repository keeps having to relearn.
 */
export const OBSERVATIONS: readonly Observation[] = [
  'CONNECTION_ACCEPTANCE_RECORDED',
  'INBOX_REVIEW_RECORDED',
  'REPLY_RECORDED',
  'MEETING_BOOKED_RECORDED',
  'MEETING_HELD_RECORDED',
]

export function isObservation(value: string): value is Observation {
  return (OBSERVATIONS as readonly string[]).includes(value)
}
