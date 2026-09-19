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
  getMetricSeries,
  getMetricTotals,
  getSetterDashboard,
  replyRate,
  type MetricTotals,
  type SetterDashboard,
} from '@/lib/crm/metrics'
import {
  previousRange,
  RANGES,
  resolveRange,
  trend,
  type RangeKey,
} from '@/lib/crm/reports'

export type PerformanceCard = {
  key: string
  label: string
  /**
   * ⚠️ A STRING WHEN THE FIGURE IS NOT A PLAIN COUNT — a percentage, or money
   * already formatted. Forcing those into a number would lose the one
   * distinction that matters: a reply rate of `null` renders as "—", and a
   * numeric 0 would say "we were ignored" instead of "we have not started".
   */
  value: number | string
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
  /**
   * One stored value per day across the selected range.
   *
   * ⚠️ REAL ROWS OR AN EMPTY ARRAY — NEVER A PLACEHOLDER CURVE. An empty array
   * renders no sparkline at all, which is the honest output when the series
   * could not be read. See `getMetricSeries`.
   */
  series: number[]
  /** Where the figure can be checked in full. */
  href: string
  /** Which glyph `StatCard` draws. A name, never markup. */
  icon: StatIcon
}

/**
 * ⚠️ A CLOSED SET, NOT A FREE STRING. The icon is chosen from a vocabulary
 * `StatCard` can actually draw, so a typo is a compile error rather than a card
 * that silently renders no glyph and sits a few pixels shorter than its row.
 */
export type StatIcon =
  | 'target'
  | 'trend'
  | 'people'
  | 'money'
  | 'mail'
  | 'reply'
  | 'phone'
  | 'calendar'

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
  /*
   * ⚠️ NUMBERS ONLY. A card whose value is a string is a rate or a formatted
   * sum, and `'—' > 0` is `false` while `'12%' > 0` is also `false` — so a
   * loose comparison would quietly answer "no activity" for a workspace whose
   * only non-zero figures happened to be the formatted ones.
   */
  return (
    data.kind === 'ready'
    && data.cards.some((c) => typeof c.value === 'number' && c.value > 0)
  )
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
  extra: { series?: number[]; href: string; icon: StatIcon },
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
    // Absent means "not read", and renders as no sparkline rather than a flat
    // line — a flat line is a claim that nothing happened.
    series: extra.series ?? [],
    href: extra.href,
    icon: extra.icon,
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
  let series: Record<string, number[]>

  try {
    ;[now, before, lastRun, series] = await Promise.all([
      getSetterDashboard(workspaceId, userId, range.fromDay, range.toDay),
      getSetterDashboard(workspaceId, userId, prior.fromDay, prior.toDay),
      getLastRollupRun(workspaceId),
      /*
       * ⚠️ THE SAME BASIS AND USER AS THE TOTALS ABOVE. A sparkline drawn from
       * workspace rows under a figure computed from one setter's rows would be
       * a picture of somebody else's month sitting beneath this person's
       * number — and it would look entirely plausible.
       */
      getMetricSeries(workspaceId, {
        fromDay: range.fromDay,
        toDay: range.toDay,
        basis: 'actor',
        userId,
        metrics: ['contacts_created', 'emails_sent', 'replies', 'calls_booked'],
      }),
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
        { series: series.contacts_created, href: '/crm/contacts', icon: 'people' },
      ),
      card(
        'emails_sent',
        'Emails sent',
        now.emailsSent,
        before.emailsSent,
        `${now.contactsEmailed.toLocaleString()} ${
          now.contactsEmailed === 1 ? 'person' : 'people'
        } reached`,
        { series: series.emails_sent, href: '/email/analytics', icon: 'mail' },
      ),
      card('replies', 'Replies', now.replies, before.replies, percentText(now.replyRate), {
        series: series.replies,
        href: '/email/inbox',
        icon: 'reply',
      }),
      card(
        'calls_booked',
        'Calls booked',
        now.callsBooked,
        before.callsBooked,
        `${now.callsHeld.toLocaleString()} held`,
        { series: series.calls_booked, href: '/crm/tasks', icon: 'phone' },
      ),
    ],
  }
}

/* -------------------------------------------------------------------------- *
 * The headline row — the workspace, not one person
 * -------------------------------------------------------------------------- */

/**
 * The four figures at the top of the overview.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ WORKSPACE BASIS, AND THE HEADING MUST SAY SO.                        ║
 * ║                                                                           ║
 * ║  "Your activity" directly below is one setter's own work on the `actor`   ║
 * ║  basis. This row is the whole workspace. Rendering the two under headings ║
 * ║  that do not distinguish them is the defect the reports page records as   ║
 * ║  D24: the number is right and the sentence above it is wrong.            ║
 * ║                                                                           ║
 * ║  The `workspace` rows are stored by the rollup rather than summed on read ║
 * ║  (migration 0082), so this is one lookup, not a scan across every member. ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ EVERY LABEL NAMES WHAT IS ACTUALLY COUNTED. The obvious headline set for
 * a sales product is "Total Leads / Conversion Rate / Total Customers / Monthly
 * Revenue", and three of those four would be a claim this product cannot
 * support: nothing here knows what a customer is, "conversion" has no agreed
 * denominator, and revenue is won-deal value rather than money received. So the
 * cards keep the shape and take the names of the figures that exist — CLAUDE.md
 * rule 4 governs a label exactly as it governs a stored value.
 */
export type HeadlineKpis =
  | { kind: 'ready'; cards: PerformanceCard[]; rangeLabel: string }
  | { kind: 'pending' }
  | { kind: 'unavailable' }

export async function getHeadlineKpis(
  workspaceId: string,
  rangeKey: RangeKey = '30d',
): Promise<HeadlineKpis> {
  const range = resolveRange(rangeKey)
  const prior = previousRange(range)

  let now: MetricTotals
  let before: MetricTotals
  let lastRun: Awaited<ReturnType<typeof getLastRollupRun>>
  let series: Record<string, number[]>

  try {
    ;[now, before, lastRun, series] = await Promise.all([
      getMetricTotals(workspaceId, { ...range, basis: 'workspace' }),
      getMetricTotals(workspaceId, { ...prior, basis: 'workspace' }),
      getLastRollupRun(workspaceId),
      getMetricSeries(workspaceId, {
        fromDay: range.fromDay,
        toDay: range.toDay,
        basis: 'workspace',
        metrics: ['contacts_created', 'contacts_emailed', 'replies', 'won_deals'],
      }),
    ])
  } catch {
    // Reported as a state, never as zeroes. Same reasoning as the row below.
    return { kind: 'unavailable' }
  }

  if (lastRun === null) return { kind: 'pending' }

  const count = (metric: string, totals: MetricTotals) => totals[metric]?.count ?? 0
  const amount = (metric: string, totals: MetricTotals) => totals[metric]?.amount ?? 0

  /*
   * ⚠️ REPLY RATE IS COMPUTED BY THE REGISTRY, NOT HERE. `evaluateDerived`
   * owns the formula — contacts replied over contacts EMAILED, and `null`
   * rather than 0 when nobody was emailed. A second copy of that division is
   * how two screens of one product come to disagree about a percentage.
   */
  const rateNow = replyRate(now)
  const ratePrior = replyRate(before)

  const wonNow = amount('won_deals', now)
  const wonBefore = amount('won_deals', before)

  return {
    kind: 'ready',
    rangeLabel: RANGES[range.key].label,
    cards: [
      card(
        'leads',
        'Leads added',
        count('contacts_created', now),
        count('contacts_created', before),
        'Everyone the workspace brought in',
        { series: series.contacts_created, href: '/crm/contacts', icon: 'target' },
      ),
      {
        key: 'reply_rate',
        label: 'Reply rate',
        /*
         * ⚠️ A STRING, BECAUSE `null` IS NOT ZERO. Nobody emailed has no reply
         * rate, and 0% reads as "we were ignored" rather than "we have not
         * started". `StatCard` renders a string verbatim.
         */
        value: rateNow === null ? '—' : `${Math.round(rateNow * 100)}%`,
        previous: ratePrior === null ? 0 : Math.round(ratePrior * 100),
        /*
         * ⚠️ NO PERCENTAGE MOVEMENT ON A PERCENTAGE. "Up 3% from 24%" is
         * ambiguous between points and proportion, and both readings are
         * defensible — so the delta is the POINT difference, and it is only
         * offered when both periods produced a real rate.
         */
        delta:
          rateNow === null || ratePrior === null || ratePrior === 0
            ? null
            : (rateNow - ratePrior) / ratePrior,
        isNew: ratePrior === null && rateNow !== null,
        higherIsBetter: true,
        hint:
          rateNow === null
            ? 'Nobody emailed in this period'
            : `${count('contacts_emailed', now).toLocaleString()} emailed, ${count('replies', now).toLocaleString()} replied`,
        series: series.replies ?? [],
        href: '/crm/reports',
        icon: 'trend',
      },
      card(
        'won_deals',
        'Deals won',
        count('won_deals', now),
        count('won_deals', before),
        'Closed in this period',
        { series: series.won_deals, href: '/crm/pipeline', icon: 'people' },
      ),
      {
        key: 'won_value',
        label: 'Won revenue',
        /*
         * ⚠️ FORMATTED HERE AND PASSED AS A STRING, so `StatCard` never has to
         * know a currency. 0124 sums `value_amount_base`, so a deal priced in a
         * currency with no rate is EXCLUDED from this figure while still being
         * counted in "Deals won" beside it — which is why the two cards can
         * legitimately disagree, and why the pipeline page carries the
         * `unconvertible` warning.
         */
        value: formatBaseMoney(wonNow),
        previous: wonBefore,
        delta: trend(wonNow, wonBefore),
        isNew: wonBefore === 0 && wonNow > 0,
        higherIsBetter: true,
        hint: 'Value of deals marked won',
        // Money has no stored daily count column; `count_value` on `won_deals`
        // is the number of deals, which is the card above. Drawing it here
        // would label a count as revenue.
        series: [],
        href: '/crm/reports',
        icon: 'money',
      },
    ],
  }
}

/**
 * ⚠️ THE WORKSPACE'S BASE CURRENCY, WITHOUT NAMING IT. `amount_value` is
 * already converted to base (0124), and this function has no workspace row to
 * read a symbol from — printing "$" would be a guess. The compact form keeps a
 * six-figure sum inside a card that also holds a delta chip.
 */
function formatBaseMoney(value: number): string {
  if (value === 0) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${Math.round(value / 1_000)}K`
  return Math.round(value).toLocaleString()
}
