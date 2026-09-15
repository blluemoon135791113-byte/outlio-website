/**
 * What a LinkedIn campaign can honestly say about itself — Phase 18.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  §7.5: "a vendor outage must surface as a visible partial, never a silent ║
 * ║  one."                                                                    ║
 * ║                                                                           ║
 * ║  ⚠️ THERE IS NO VENDOR, WHICH MAKES THIS HARDER RATHER THAN EASIER. An    ║
 * ║  email campaign learns from an API response whether a message went. Here  ║
 * ║  a human performs every action inside LinkedIn (rule 1) and comes back to ║
 * ║  say what happened — so "did it send?" is a claim somebody makes, or      ║
 * ║  fails to make.                                                          ║
 * ║                                                                           ║
 * ║  `OUTCOME_UNKNOWN` already exists for exactly that: an action nobody can  ║
 * ║  rule out having happened. It keeps its quota slot (§4.17) because a      ║
 * ║  connection request that MIGHT be sitting in someone's inbox cannot be    ║
 * ║  retried as though it were not.                                          ║
 * ║                                                                           ║
 * ║  So a campaign has no clean total, and this module refuses to invent one. ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ NO PERCENTAGE, AND THAT IS THE WHOLE DESIGN. A single "68% complete"
 * requires deciding which bucket `unknown` belongs to, and both answers are
 * lies: counted as done it overstates what was achieved, counted as outstanding
 * it implies work that may already have been performed on a real person.
 *
 * ⚠️ AND NOTHING HERE IS STORED. 0128 deliberately holds no counters — a cached
 * total can disagree with the rows an operator actually changed, and the rows
 * are the only thing that moved.
 */
import { isTerminal, reasonMeansSuccess, type EnrollmentState, type TerminalReason } from '@/lib/linkedin/enrollment'
import type { TaskOutcome } from '@/lib/linkedin/outcomes'

/** One enrollment, reduced to what progress depends on. */
export type EnrollmentRow = {
  state: EnrollmentState
  terminalReason: TerminalReason | null
}

/** One task, reduced likewise. `outcome` is null while it is still pending. */
export type TaskRow = {
  outcome: TaskOutcome | null
}

export type CampaignProgress = {
  enrollments: number
  /** Ended, and `reasonMeansSuccess` says it ended well. */
  succeeded: number
  /** Ended, and it did not. Includes NOT_INTERESTED, DNC, NO_REPLY, EXPIRED. */
  ended: number
  /** Still moving, or waiting on a person. */
  inFlight: number
  /**
   * ⚠️ NOT A SUBSET OF THE OTHERS, AND NEVER FOLDED INTO THEM.
   *
   * Enrollments carrying at least one task whose outcome nobody could
   * establish. Such an enrollment is ALSO counted in `succeeded`, `ended` or
   * `inFlight` — it has a state like any other — and this says the state rests
   * on an action we cannot confirm.
   *
   * Reported separately precisely because it does not add up. A reader who
   * wants a total gets one; a reader who wants to trust it gets this.
   */
  unconfirmed: number
  /** Tasks nobody has acted on yet. */
  tasksPending: number
  /** Tasks with `OUTCOME_UNKNOWN` — the operator could not say. */
  tasksUnknown: number
}

/**
 * ⚠️ `OUTCOME_UNKNOWN` IS THE ONLY OUTCOME THAT MEANS "WE CANNOT SAY".
 * `FAILED` is a claim — somebody looked and it did not happen. `SKIPPED` is a
 * decision. Collapsing unknown into either loses the distinction §4.17 is
 * built on, and it is the distinction that decides whether a quota slot is
 * released.
 */
function isUnconfirmed(outcome: TaskOutcome | null): boolean {
  return outcome === 'OUTCOME_UNKNOWN'
}

/**
 * Derives a campaign's progress from its rows.
 *
 * Pure, so every combination is testable without a database — which matters
 * because the combination that needs testing most is the one nobody will
 * produce on demand: an enrollment that finished on the back of an action
 * nobody could confirm.
 */
export function campaignProgress(
  enrollments: readonly EnrollmentRow[],
  tasksByEnrollment: readonly (readonly TaskRow[])[],
): CampaignProgress {
  /*
   * ⚠️ POSITIONAL PAIRING, ASSERTED RATHER THAN ASSUMED. The caller passes
   * tasks in enrollment order; a mismatch would attribute one person's
   * unconfirmed action to another's enrollment, which is worse than reporting
   * nothing. Cheap to check, impossible to notice otherwise.
   */
  if (tasksByEnrollment.length !== enrollments.length) {
    throw new Error(
      `campaignProgress: ${enrollments.length} enrollments but ${tasksByEnrollment.length} task groups`,
    )
  }

  let succeeded = 0
  let ended = 0
  let inFlight = 0
  let unconfirmed = 0
  let tasksPending = 0
  let tasksUnknown = 0

  enrollments.forEach((enrollment, index) => {
    if (isTerminal(enrollment.state)) {
      /*
       * ⚠️ A TERMINAL STATE WITH NO REASON IS NOT A SUCCESS. `terminal_reason`
       * is set only when the state is terminal (0125), so a null here is a row
       * that ended without recording how. Counting it as succeeded would
       * invent the one fact it is missing.
       */
      if (enrollment.terminalReason !== null && reasonMeansSuccess(enrollment.terminalReason)) {
        succeeded += 1
      } else {
        ended += 1
      }
    } else {
      inFlight += 1
    }

    const tasks = tasksByEnrollment[index] ?? []
    let enrollmentUnconfirmed = false

    for (const task of tasks) {
      if (task.outcome === null) tasksPending += 1
      if (isUnconfirmed(task.outcome)) {
        tasksUnknown += 1
        enrollmentUnconfirmed = true
      }
    }

    if (enrollmentUnconfirmed) unconfirmed += 1
  })

  return {
    enrollments: enrollments.length,
    succeeded,
    ended,
    inFlight,
    unconfirmed,
    tasksPending,
    tasksUnknown,
  }
}

/**
 * One sentence for an operator, which says what is unconfirmed or says nothing.
 *
 * ⚠️ IT RENDERS NOTHING WHEN EVERYTHING IS CONFIRMED, rather than "0
 * unconfirmed". A line that is almost always zero is a line people stop
 * reading, and this one has to be read the day it is not — the same reason
 * `ExcludedDeals` stays silent at zero.
 */
export function unconfirmedNote(progress: CampaignProgress): string | null {
  if (progress.unconfirmed === 0) return null

  const people = progress.unconfirmed === 1 ? '1 person' : `${progress.unconfirmed} people`
  const actions = progress.tasksUnknown === 1 ? 'an action' : `${progress.tasksUnknown} actions`

  return (
    `${people} in this campaign reached their current state after ${actions} nobody could confirm. ` +
    'Those may or may not have happened in LinkedIn.'
  )
}
