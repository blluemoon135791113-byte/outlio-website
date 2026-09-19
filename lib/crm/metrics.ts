import 'server-only'

/**
 * Reporting rollups and reads (M4 Phase 9).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS FILE IMPLEMENTS LEDGER §20 AND NOTHING ELSE.                       ║
 * ║                                                                          ║
 * ║  Every formula was written down before any of this existed. If the two   ║
 * ║  disagree, the Ledger is the contract and this is the bug — fix the       ║
 * ║  Ledger first only if the DEFINITION was wrong.                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THE AGGREGATE IS A CACHE. Every number is recomputable from
 * `crm_activities` and `crm_opportunities`, which is what makes
 * `reconcileReporting` meaningful. The moment a number exists only here, this
 * stops being a cache and starts being a second source of truth.
 */
import { evaluateDerived } from '@/lib/reporting/registry'
import { createAdminClient } from '@/lib/supabase/admin'

/** Attribution basis — Ledger §20. */
export type MetricBasis = 'actor' | 'owner' | 'workspace'

export type RollupResult = {
  runId: string
  rowsWritten: number
  fromDay: string
  toDay: string
}

/**
 * How far back a routine rollup reaches.
 *
 * ⚠️ NOT just "today". An event can arrive late — ingested history, a replayed
 * webhook, a backfill — and a rollup that only ever recomputed the current day
 * would leave yesterday permanently wrong. Seven days is cheap and covers
 * every late arrival we actually produce.
 */
export const DEFAULT_LOOKBACK_DAYS = 7

function toDay(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/**
 * Recomputes a date range and records the run.
 *
 * The run row is written FIRST and finished afterwards, so a crash leaves a
 * row with no `finished_at` — visible evidence that a rollup started and did
 * not complete. A job that records only its successes cannot be distinguished
 * from one that never ran.
 */
export async function rollupWorkspace(
  workspaceId: string,
  options: { fromDay?: string; toDay?: string; lookbackDays?: number } = {},
): Promise<RollupResult> {
  const db = createAdminClient()

  const end = options.toDay ?? toDay(new Date())
  const start =
    options.fromDay ??
    toDay(new Date(Date.now() - (options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) * 86_400_000))

  const { data: run, error: runError } = await db
    .from('crm_reporting_runs')
    .insert({ workspace_id: workspaceId, from_day: start, to_day: end })
    .select('id')
    .single()

  if (runError) throw new Error(`rollupWorkspace failed: ${runError.message}`)

  try {
    const { data, error } = await db.rpc('crm_rollup_activity_metrics', {
      p_workspace_id: workspaceId,
      p_from_day: start,
      p_to_day: end,
    })

    if (error) throw new Error(error.message)

    const rowsWritten = (data as unknown as number) ?? 0

    await db
      .from('crm_reporting_runs')
      .update({ rows_written: rowsWritten, finished_at: new Date().toISOString() })
      .eq('id', run.id)

    return { runId: run.id, rowsWritten, fromDay: start, toDay: end }
  } catch (error) {
    // The failure is recorded on the run, so a stalled rollup is visible
    // rather than looking like a quiet week.
    await db
      .from('crm_reporting_runs')
      .update({
        finished_at: new Date().toISOString(),
        error: error instanceof Error ? error.message.slice(0, 500) : 'unknown',
      })
      .eq('id', run.id)

    throw error instanceof Error ? error : new Error('rollupWorkspace failed')
  }
}

export type Discrepancy = {
  day: string
  metric: string
  aggregateValue: number
  rawValue: number
}

/**
 * M4 ACCEPTANCE CRITERION 1: the aggregate must equal the raw event counts.
 *
 * ⚠️ REPORTS, NEVER REPAIRS. A reconciliation that silently fixed itself would
 * hide the bug that caused the drift, and the drift is the only symptom that
 * bug has. An empty array is the success signal.
 *
 * ⚠️ It verifies only the metrics it knows how to recount. Adding a metric to
 * the rollup does NOT automatically cover it — the checked list in
 * `crm_reconcile_reporting` has to be extended too, deliberately.
 */
export async function reconcileReporting(
  workspaceId: string,
  fromDay: string,
  toDay: string,
  options: { runId?: string } = {},
): Promise<Discrepancy[]> {
  const db = createAdminClient()

  const { data, error } = await db.rpc('crm_reconcile_reporting', {
    p_workspace_id: workspaceId,
    p_from_day: fromDay,
    p_to_day: toDay,
  })

  if (error) throw new Error(`reconcileReporting failed: ${error.message}`)

  const discrepancies = (data ?? []).map((row) => ({
    day: row.day,
    metric: row.metric,
    aggregateValue: Number(row.aggregate_value),
    rawValue: Number(row.raw_value),
  }))

  if (options.runId) {
    await db
      .from('crm_reporting_runs')
      .update({ discrepancies: discrepancies.length })
      .eq('id', options.runId)
  }

  return discrepancies
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type MetricTotals = Record<string, { count: number; amount: number }>

/**
 * Totals for a date range.
 *
 * A month is a SUM OF DAYS (Ledger §20). Nothing is stored at month grain,
 * because two grains can disagree and only the day grain answers an arbitrary
 * range.
 */
export async function getMetricTotals(
  workspaceId: string,
  options: {
    fromDay: string
    toDay: string
    basis: MetricBasis
    /** Required when basis is `actor` or `owner`; ignored for `workspace`. */
    userId?: string | null
  },
): Promise<MetricTotals> {
  const db = createAdminClient()

  let query = db
    .from('crm_reporting_daily')
    .select('metric, count_value, amount_value')
    .eq('workspace_id', workspaceId)
    .eq('basis', options.basis)
    .gte('day', options.fromDay)
    .lte('day', options.toDay)

  query = options.basis === 'workspace'
    ? query.is('user_id', null)
    : query.eq('user_id', options.userId ?? '')

  const { data, error } = await query
  if (error) throw new Error(`getMetricTotals failed: ${error.message}`)

  const totals: MetricTotals = {}
  for (const row of data ?? []) {
    const entry = (totals[row.metric] ??= { count: 0, amount: 0 })
    entry.count += Number(row.count_value)
    entry.amount += Number(row.amount_value)
  }

  return totals
}

/**
 * One value per day, for a sparkline.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ EVERY POINT IS A STORED ROW. NOTHING IS INTERPOLATED, SMOOTHED OR    ║
 * ║  INVENTED.                                                                ║
 * ║                                                                           ║
 * ║  A sparkline is the easiest place in a product to draw a shape that means ║
 * ║  nothing — a pleasing curve is the default output of every charting       ║
 * ║  library whether or not the data supports one. CLAUDE.md rule 4 applies   ║
 * ║  to a drawn line exactly as it applies to a stored field.                 ║
 * ║                                                                           ║
 * ║  ⚠️ A DAY WITH NO ROW IS A REAL ZERO HERE, and that is the one inference  ║
 * ║  this function makes. The rollup writes a row per (day, metric) only when ║
 * ║  something happened, so an absent day means "nothing happened", not       ║
 * ║  "unknown" — the caller already knows the rollup ran, because             ║
 * ║  `getLastRollupRun` gates the whole panel. Without the zero-fill, a week  ║
 * ║  with activity on two days would render as a two-point line and read as   ║
 * ║  a smooth trend.                                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export async function getMetricSeries(
  workspaceId: string,
  options: {
    fromDay: string
    toDay: string
    basis: MetricBasis
    userId?: string | null
    /** Which metrics to return. One query covers all of them. */
    metrics: string[]
  },
): Promise<Record<string, number[]>> {
  if (options.metrics.length === 0) return {}

  const db = createAdminClient()

  let query = db
    .from('crm_reporting_daily')
    .select('day, metric, count_value')
    .eq('workspace_id', workspaceId)
    .eq('basis', options.basis)
    .in('metric', options.metrics)
    .gte('day', options.fromDay)
    .lte('day', options.toDay)

  query = options.basis === 'workspace'
    ? query.is('user_id', null)
    : query.eq('user_id', options.userId ?? '')

  const { data, error } = await query
  if (error) throw new Error(`getMetricSeries failed: ${error.message}`)

  /*
   * The day axis is built from the RANGE, not from the rows that came back —
   * so the series length is the same for every metric on the screen and two
   * sparklines side by side are on the same horizontal scale. Built from rows,
   * a quiet metric would be drawn across fewer points and its line would look
   * steeper than a busy one's for the same movement.
   */
  const days = daysBetween(options.fromDay, options.toDay)
  const index = new Map(days.map((day, i) => [day, i]))

  const series: Record<string, number[]> = {}
  for (const metric of options.metrics) series[metric] = new Array(days.length).fill(0)

  for (const row of data ?? []) {
    const at = index.get(row.day)
    if (at === undefined) continue
    const bucket = series[row.metric]
    if (bucket) bucket[at] += Number(row.count_value)
  }

  return series
}

/**
 * Every `YYYY-MM-DD` from `from` to `to`, inclusive.
 *
 * ⚠️ STEPPED IN UTC MILLISECONDS, NOT BY MUTATING A LOCAL `Date`. Adding one
 * to `getDate()` lands on the wrong day across a daylight-saving boundary —
 * twice a year a series would silently drop or repeat a day, which is the kind
 * of fault nobody notices and nobody can reproduce on demand.
 */
function daysBetween(fromDay: string, toDay: string): string[] {
  const start = Date.parse(`${fromDay}T00:00:00Z`)
  const end = Date.parse(`${toDay}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return []

  const out: string[] = []
  // A guard, not a limit: 400 days is beyond any range this product offers,
  // and an unbounded loop on a malformed date would hang the request.
  for (let at = start; at <= end && out.length < 400; at += 86_400_000) {
    out.push(new Date(at).toISOString().slice(0, 10))
  }
  return out
}

/**
 * Reply rate, as Ledger §20 defines it.
 *
 * ⚠️ THE DENOMINATOR IS CONTACTS EMAILED, NOT EMAILS SENT. Using the event
 * count would quarter the rate of a team that follows up four times — it would
 * punish doing the job properly.
 *
 * `null` rather than 0 when nobody was emailed: a team that has sent nothing
 * has no reply rate, and showing 0% reads as failure rather than absence.
 */
export function replyRate(totals: MetricTotals): number | null {
  /*
   * ⚠️ DELEGATED TO THE REGISTRY, NOT REIMPLEMENTED. This function and
   * `DERIVED_METRICS.reply_rate` were the same formula written twice, and two
   * agreeing copies is how `TASK_FOR` came to exist three times and diverge.
   * The registry owns the definition; this stays as the name the reports page
   * already calls, so the call sites did not have to change.
   */
  return evaluateDerived('reply_rate', totals)
}

export type SetterDashboard = {
  userId: string
  fromDay: string
  toDay: string
  contactsCreated: number
  engagements: number
  openersSent: number
  personalizedDms: number
  followUps: number
  emailsSent: number
  contactsEmailed: number
  replies: number
  replyRate: number | null
  qualified: number
  callsBooked: number
  callsHeld: number
  tasksCompleted: number
  wonDeals: number
  wonRevenue: number
}

/** One setter's numbers. Work by actor, outcomes by owner-at-event. */
export async function getSetterDashboard(
  workspaceId: string,
  userId: string,
  fromDay: string,
  toDay: string,
): Promise<SetterDashboard> {
  const [actor, owner] = await Promise.all([
    getMetricTotals(workspaceId, { fromDay, toDay, basis: 'actor', userId }),
    getMetricTotals(workspaceId, { fromDay, toDay, basis: 'owner', userId }),
  ])

  const n = (totals: MetricTotals, metric: string) => totals[metric]?.count ?? 0

  return {
    userId,
    fromDay,
    toDay,
    contactsCreated: n(actor, 'contacts_created'),
    engagements: n(actor, 'engagements'),
    openersSent: n(actor, 'openers_sent'),
    personalizedDms: n(actor, 'personalized_dms'),
    followUps: n(actor, 'follow_ups'),
    emailsSent: n(actor, 'emails_sent'),
    contactsEmailed: n(actor, 'contacts_emailed'),
    replies: n(actor, 'replies'),
    replyRate: replyRate(actor),
    qualified: n(actor, 'qualified'),
    callsBooked: n(actor, 'calls_booked'),
    callsHeld: n(actor, 'calls_held'),
    tasksCompleted: n(actor, 'tasks_completed'),
    // Outcomes, credited to whoever OWNED the record at the time.
    wonDeals: n(owner, 'won_deals'),
    wonRevenue: owner.won_deals?.amount ?? 0,
  }
}

/** When this workspace's numbers were last computed, and whether it worked. */
export async function getLastRollupRun(workspaceId: string): Promise<{
  finishedAt: string | null
  rowsWritten: number
  discrepancies: number | null
  error: string | null
} | null> {
  const { data, error } = await createAdminClient()
    .from('crm_reporting_runs')
    .select('rows_written, discrepancies, finished_at, error')
    .eq('workspace_id', workspaceId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`getLastRollupRun failed: ${error.message}`)
  if (!data) return null

  return {
    finishedAt: data.finished_at,
    rowsWritten: data.rows_written,
    discrepancies: data.discrepancies,
    error: data.error,
  }
}
