import 'server-only'

/**
 * The overview's performance row.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE DASHBOARD SHOWED CONSUMPTION AND CALLED IT AN OVERVIEW.               ║
 * ║                                                                           ║
 * ║  Credits remaining, searches today, exports this month — every number on   ║
 * ║  the first screen was about what the customer had spent, and none was      ║
 * ║  about whether any of it worked. A setter opening the product could not    ║
 * ║  see whether they had emailed anyone or heard back.                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THE THREE OUTCOMES ARE DISTINCT AND MUST STAY DISTINCT: figures that are
 * real, figures that have not been computed yet, and figures that could not be
 * read. Collapsing the second into the first is the defect this codebase keeps
 * relearning — the credit balance that rendered `?? 0` told an account with a
 * missing row that it had no credits, and a performance row that renders an
 * uncomputed week as four zeroes tells a setter they did nothing. Zero is a
 * finding. Unknown is not.
 */
import {
  getLastRollupRun,
  getSetterDashboard,
  type SetterDashboard,
} from '@/lib/crm/metrics'
import { previousRange, resolveRange, trend, type RangeKey } from '@/lib/crm/reports'

export type PerformanceCard = {
  key: string
  label: string
  value: number
  previous: number
  /**
   * Change as a fraction, or `null` when there is no honest one to show —
   * `trend` refuses to divide by a zero previous period. `isNew` distinguishes
   * the interesting null (nothing before, something now) from the dull one
   * (nothing before, nothing now).
   */
  delta: number | null
  isNew: boolean
  /**
   * ⚠️ PER-CARD, NOT GLOBAL. Up is good for all four of these, and stating it
   * per card is what stops the fifth one inheriting it: the day someone adds
   * bounces or unsubscribes here, a rise must not render in the success colour
   * because the row assumed every metric grows in the right direction.
   */
  higherIsBetter: boolean
  /** A second fact, not a restatement of the first. */
  hint: string
}

export type OverviewPerformance =
  | {
      kind: 'ready'
      cards: PerformanceCard[]
      fromDay: string
      toDay: string
      priorFromDay: string
      priorToDay: string
      /** When the aggregate was last recomputed, or null if a run never finished. */
      computedAt: string | null
    }
  /** The rollup has never run for this workspace, so there is nothing to read yet. */
  | { kind: 'pending' }
  /** The read itself failed. Never rendered as zeroes. */
  | { kind: 'unavailable' }

/**
 * Whether this row has anything worth putting at the top of the screen.
 *
 * ⚠️ THE CONDITION ON THE FIRST-RUN CHECKLIST'S PLACEMENT, not a second
 * opinion about it. The checklist sits above the numbers because "someone on
 * their first day has no usage to read, and a row of zeroes is a worse first
 * screen than a list of what to do next" — which is true, and which is a
 * statement about a row of zeroes. Once there are real figures the same
 * reasoning points the other way, and a seven-item checklist that fills the
 * whole first viewport is burying the thing the customer came to read.
 *
 * `pending` and `unavailable` both answer false: neither is a figure.
 */
export function hasRealActivity(data: OverviewPerformance): boolean {
  return data.kind === 'ready' && data.cards.some((c) => c.value > 0)
}

function percentText(rate: number | null): string {
  // `null` is "nobody was emailed", which is not the same fact as 0%.
  if (rate === null) return 'nobody emailed yet'
  return `${Math.round(rate * 100)}% of contacts emailed`
}

function card(
  key: string,
  label: string,
  now: number,
  before: number,
  hint: string,
): PerformanceCard {
  return {
    key,
    label,
    value: now,
    previous: before,
    delta: trend(now, before),
    isNew: before === 0 && now > 0,
    higherIsBetter: true,
    hint,
  }
}

/**
 * ⚠️ ONE SETTER'S OWN FIGURES, ALWAYS — never the workspace's.
 *
 * `getSetterDashboard` is per-user by construction, and the caller labels this
 * row "your activity" for that reason. Handing a manager the team's totals
 * under the same heading is the mistake the reports page records as D24: the
 * number is right and the sentence above it is wrong.
 */
export async function getOverviewPerformance(
  workspaceId: string,
  userId: string,
  rangeKey: RangeKey = '30d',
): Promise<OverviewPerformance> {
  const range = resolveRange(rangeKey)
  /*
   * The immediately preceding window of the SAME length, which is what makes
   * the comparison fair. A month-to-date measured against a whole previous
   * month would show a decline every time, on the first of the month, forever.
   */
  const prior = previousRange(range)

  let now: SetterDashboard
  let before: SetterDashboard
  let lastRun: Awaited<ReturnType<typeof getLastRollupRun>>

  try {
    ;[now, before, lastRun] = await Promise.all([
      getSetterDashboard(workspaceId, userId, range.fromDay, range.toDay),
      getSetterDashboard(workspaceId, userId, prior.fromDay, prior.toDay),
      getLastRollupRun(workspaceId),
    ])
  } catch {
    /*
     * Swallowed here and reported as a state, deliberately. A reporting outage
     * must not take the whole dashboard down with it — the upload path, the
     * credit balance and the extension card have nothing to do with it — and
     * the row that failed says so itself rather than showing a plausible zero.
     */
    return { kind: 'unavailable' }
  }

  /*
   * ⚠️ NO RUN AT ALL IS THE ONLY HONEST "PENDING" SIGNAL. A workspace whose
   * rotation has not reached it yet has no `crm_reporting_runs` row, and its
   * `crm_reporting_daily` rows do not exist either — so every figure would read
   * zero for a reason that has nothing to do with the setter's week.
   *
   * A run that HAS happened and returned zeroes is a different thing entirely:
   * that is a real, quiet week, and it renders as zeroes because it is true.
   */
  if (lastRun === null) return { kind: 'pending' }

  return {
    kind: 'ready',
    fromDay: range.fromDay,
    toDay: range.toDay,
    priorFromDay: prior.fromDay,
    priorToDay: prior.toDay,
    /*
     * `finished_at` and not `started_at`: a run that started and never finished
     * computed nothing, and dating the figures by it would claim a freshness
     * they do not have.
     */
    computedAt: lastRun.finishedAt,
    cards: [
      card(
        'contacts_created',
        'Contacts added',
        now.contactsCreated,
        before.contactsCreated,
        `${before.contactsCreated.toLocaleString()} in the previous period`,
      ),
      card(
        'emails_sent',
        'Emails sent',
        now.emailsSent,
        before.emailsSent,
        `${now.contactsEmailed.toLocaleString()} ${
          now.contactsEmailed === 1 ? 'person' : 'people'
        } reached`,
      ),
      card('replies', 'Replies', now.replies, before.replies, percentText(now.replyRate)),
      card(
        'calls_booked',
        'Calls booked',
        now.callsBooked,
        before.callsBooked,
        `${now.callsHeld.toLocaleString()} held`,
      ),
    ],
  }
}
