/**
 * The metric registry — Phase 14, per build contract §5.14.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ONE PLACE THAT NAMES EVERY METRIC, WHERE IT COMES FROM, AND HOW IT IS    ║
 * ║  COUNTED — SO THE SQL AND THE DASHBOARD CANNOT DRIFT SILENTLY.            ║
 * ║                                                                           ║
 * ║  Migration 0082 writes 13 metrics into `crm_reporting_daily`.             ║
 * ║  `lib/crm/metrics.ts` reads 13 metric names back out by string literal.   ║
 * ║  Nothing checked that the two lists were the same list.                   ║
 * ║                                                                           ║
 * ║  ⚠️ A NAME THAT DISAGREES IS A SILENT ZERO, NOT AN ERROR. `getMetricTotals`║
 * ║  builds a map from whatever rows came back; a metric nobody wrote is       ║
 * ║  simply absent, and `totals[metric]?.count ?? 0` renders it as 0. The      ║
 * ║  dashboard then reports "0 calls held" with total confidence, which is     ║
 * ║  the could-not-observe case wearing an observed-zero's clothes — exactly   ║
 * ║  the confusion `lib/flows/facts.ts` was careful to avoid in the flow       ║
 * ║  engine, and which nothing prevented here.                                ║
 * ║                                                                           ║
 * ║  0082's own comment says it: "Adding a metric to the rollup does NOT       ║
 * ║  automatically check it." `tests/unit/metric-registry.test.ts` now does.   ║
 * ║                                                                           ║
 * ║  ⚠️ PURE, AND NO SQL IS BUILT HERE. §5.14 forbids user SQL and `eval`.     ║
 * ║  Derived metrics are a whitelisted AST over base metric ids — four         ║
 * ║  operators, metric references and constants. Nothing else parses.          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

/** Which user a row is credited to. Mirrors `crm_reporting_daily.basis`. */
export type MetricBasis = 'actor' | 'owner' | 'workspace'

/**
 * How 0082 counts the metric, and the distinction is load-bearing.
 *
 * `distinct_contacts` exists because four emails to one person is ONE contact
 * emailed — counting events there is what makes a reply rate look like a
 * quarter of what it is (Ledger §20, and the comment above the SQL block).
 */
export type CountMode = 'events' | 'distinct_contacts' | 'opportunity_rows'

export type BaseMetric = {
  readonly label: string
  readonly basis: MetricBasis
  readonly countMode: CountMode
  /** Activity types that contribute, or `null` when the source is not an activity. */
  readonly activityTypes: readonly string[] | null
  /**
   * Whether `crm_reconcile_reporting()` recounts this metric.
   *
   * ⚠️ FIVE OF THIRTEEN ARE FALSE, AND THAT IS 0082'S DELIBERATE CHOICE, not an
   * oversight: "reconciliation that cries wolf about metrics it never checked
   * is worse than none." Recorded here so the gap is visible rather than
   * discovered when a number is doubted.
   */
  readonly reconciled: boolean
  /** Carries money in `amount_value` as well as a count. */
  readonly carriesAmount?: true
}

export const BASE_METRICS = {
  // --- Actor basis, one row per event ---------------------------------------
  openers_sent: { label: 'Openers sent', basis: 'actor', countMode: 'events', activityTypes: ['OPENER_SENT'], reconciled: true },
  personalized_dms: { label: 'Personalised DMs', basis: 'actor', countMode: 'events', activityTypes: ['PERSONALIZED_DM'], reconciled: false },
  follow_ups: { label: 'Follow-ups', basis: 'actor', countMode: 'events', activityTypes: ['FOLLOW_UP'], reconciled: false },
  emails_sent: { label: 'Emails sent', basis: 'actor', countMode: 'events', activityTypes: ['EMAIL_SENT'], reconciled: true },
  calls_booked: { label: 'Calls booked', basis: 'actor', countMode: 'events', activityTypes: ['CALL_BOOKED'], reconciled: true },
  calls_held: { label: 'Calls held', basis: 'actor', countMode: 'events', activityTypes: ['CALL_HELD'], reconciled: false },
  tasks_completed: { label: 'Tasks completed', basis: 'actor', countMode: 'events', activityTypes: ['TASK_COMPLETED'], reconciled: true },
  contacts_created: { label: 'Contacts created', basis: 'actor', countMode: 'events', activityTypes: ['CONTACT_CREATED'], reconciled: true },
  engagements: {
    label: 'Engagements',
    basis: 'actor',
    countMode: 'events',
    activityTypes: ['ENGAGEMENT', 'OPENER_SENT', 'PERSONALIZED_DM', 'FOLLOW_UP'],
    reconciled: true,
  },

  // --- Actor basis, distinct contacts --------------------------------------
  contacts_emailed: { label: 'Contacts emailed', basis: 'actor', countMode: 'distinct_contacts', activityTypes: ['EMAIL_SENT'], reconciled: true },
  replies: { label: 'Replies', basis: 'actor', countMode: 'distinct_contacts', activityTypes: ['EMAIL_REPLIED'], reconciled: true },
  qualified: { label: 'Qualified', basis: 'actor', countMode: 'distinct_contacts', activityTypes: ['QUALIFIED'], reconciled: false },

  /*
   * --- Owner basis, from opportunities -------------------------------------
   *
   * ⚠️ OWNER, NOT ACTOR, AND THE SQL COMMENT EXPLAINS WHY: an outcome is
   * credited to whoever OWNED the record at the time, not to whoever clicked.
   * Reading this on the actor basis returns nothing — a silent zero.
   */
  won_deals: { label: 'Won deals', basis: 'owner', countMode: 'opportunity_rows', activityTypes: null, reconciled: false, carriesAmount: true },
} as const satisfies Record<string, BaseMetric>

export type BaseMetricId = keyof typeof BASE_METRICS

export const BASE_METRIC_IDS = Object.keys(BASE_METRICS) as BaseMetricId[]

export function isBaseMetricId(value: string): value is BaseMetricId {
  return Object.prototype.hasOwnProperty.call(BASE_METRICS, value)
}

/* -------------------------------------------------------------------------- *
 * Derived metrics — a whitelisted AST, never a string to evaluate
 * -------------------------------------------------------------------------- */

/**
 * §5.14's grammar, and nothing wider: `+ - * /`, safe division, metric
 * references, numeric constants.
 *
 * ⚠️ NO `eval`, NO USER SQL, AND NO STRING PARSER. There is deliberately no
 * way to turn text into a formula here. A grammar you can only construct
 * programmatically cannot be injected into.
 */
export type Formula =
  | { readonly op: 'metric'; readonly id: BaseMetricId }
  | { readonly op: 'const'; readonly value: number }
  | { readonly op: 'add' | 'sub' | 'mul' | 'div'; readonly left: Formula; readonly right: Formula }

export type DerivedMetric = {
  readonly label: string
  readonly formula: Formula
  /** `ratio` renders as a percentage; `count` and `money` as themselves. */
  readonly unit: 'ratio' | 'count' | 'money'
}

export const DERIVED_METRICS = {
  /*
   * ⚠️ THE DENOMINATOR IS CONTACTS EMAILED, NOT EMAILS SENT. Using the event
   * count would quarter the rate of a team that follows up four times — it
   * would punish doing the job properly. This reproduces `replyRate()` in
   * lib/crm/metrics.ts exactly, and a test pins the two together so the
   * registry cannot quietly change a number the dashboard already shows.
   */
  reply_rate: {
    label: 'Reply rate',
    unit: 'ratio',
    formula: {
      op: 'div',
      left: { op: 'metric', id: 'replies' },
      right: { op: 'metric', id: 'contacts_emailed' },
    },
  },
} as const satisfies Record<string, DerivedMetric>

export type DerivedMetricId = keyof typeof DERIVED_METRICS

export const DERIVED_METRIC_IDS = Object.keys(DERIVED_METRICS) as DerivedMetricId[]

/* -------------------------------------------------------------------------- *
 * Evaluation
 * -------------------------------------------------------------------------- */

/** What `getMetricTotals` returns: metric id → summed count and amount. */
export type MetricTotalsLike = Record<string, { count: number; amount: number }>

/**
 * Evaluates a formula against one period's totals.
 *
 * ⚠️ A ZERO DENOMINATOR IS `null`, NOT `0` AND NOT `Infinity`. A team that has
 * emailed nobody has no reply rate; rendering 0% reads as failure rather than
 * absence, and `Infinity` or `NaN` would reach the UI as "∞%" or "NaN%". This
 * matches `replyRate()`'s documented behaviour, which is the whole point of
 * reproducing rather than reinventing it.
 *
 * `null` propagates: any sub-expression that cannot be answered makes the
 * whole formula unanswerable, rather than being silently treated as zero.
 */
export function evaluateFormula(formula: Formula, totals: MetricTotalsLike): number | null {
  switch (formula.op) {
    case 'const':
      return formula.value
    case 'metric':
      return totals[formula.id]?.count ?? 0
    case 'add':
    case 'sub':
    case 'mul':
    case 'div': {
      const left = evaluateFormula(formula.left, totals)
      const right = evaluateFormula(formula.right, totals)
      if (left === null || right === null) return null
      if (formula.op === 'add') return left + right
      if (formula.op === 'sub') return left - right
      if (formula.op === 'mul') return left * right
      return right === 0 ? null : left / right
    }
  }
}

/** A derived metric's value for one period, or `null` when unanswerable. */
export function evaluateDerived(
  id: DerivedMetricId,
  totals: MetricTotalsLike,
): number | null {
  return evaluateFormula(DERIVED_METRICS[id].formula, totals)
}

/** Every base metric a formula depends on — for a builder to know what to fetch. */
export function metricsUsedBy(formula: Formula): BaseMetricId[] {
  const found = new Set<BaseMetricId>()
  const walk = (node: Formula): void => {
    if (node.op === 'metric') {
      found.add(node.id)
      return
    }
    if (node.op === 'const') return
    walk(node.left)
    walk(node.right)
  }
  walk(formula)
  return [...found]
}
