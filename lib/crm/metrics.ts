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
  const emailed = totals.contacts_emailed?.count ?? 0
  if (emailed === 0) return null
  return (totals.replies?.count ?? 0) / emailed
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
