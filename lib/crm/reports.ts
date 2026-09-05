import 'server-only'

/**
 * Report reads for the dashboards (M4 Phase 10).
 *
 * ⚠️ SCOPE IS THE CALLER'S DECISION AND THE CALLER'S RESPONSIBILITY. RLS grants
 * a member the whole workspace, so a setter is narrowed by `dataScope()`
 * applied to what is PASSED here. Nothing in this file second-guesses that —
 * but nothing in it silently widens either.
 */
import { getSetterDashboard, type SetterDashboard } from '@/lib/crm/metrics'
import { createAdminClient } from '@/lib/supabase/admin'

export type PipelineTotals = {
  openDeals: number
  openValue: number
  weightedValue: number
  wonDeals: number
  wonValue: number
}

/**
 * Open pipeline, the weighted forecast, and won revenue.
 *
 * ⚠️ Every number is summed in Postgres (Ledger D25). What arrives here is
 * already a total; JavaScript never adds two money values together.
 */
export async function getPipelineTotals(
  workspaceId: string,
  ownerUserId: string | null,
): Promise<PipelineTotals> {
  const { data, error } = await createAdminClient().rpc('crm_pipeline_totals', {
    p_workspace_id: workspaceId,
    ...(ownerUserId ? { p_owner_user_id: ownerUserId } : {}),
  })

  if (error) throw new Error(`getPipelineTotals failed: ${error.message}`)

  const row = data?.[0]
  return {
    openDeals: Number(row?.open_deals ?? 0),
    openValue: Number(row?.open_value ?? 0),
    weightedValue: Number(row?.weighted_value ?? 0),
    wonDeals: Number(row?.won_deals ?? 0),
    wonValue: Number(row?.won_value ?? 0),
  }
}

export type FunnelStep = {
  label: string
  value: number
  /**
   * ⚠️ TRUE for a step that is a PROPERTY of the batch rather than a stage
   * people move through.
   *
   * "With an email" sits between "Canonical" and "Assigned" because the M4
   * brief orders it there, but it is not a gate: a contact can be assigned and
   * worked without an address. On this workspace's real data that shows as
   * 25 → 25 → 0 → 25, which reads as a rendering bug unless the step says what
   * it is. Coverage steps are rendered distinctly for exactly that reason.
   */
  isCoverage?: boolean
}

export type BatchFunnel = {
  batchId: string
  name: string
  createdAt: string
  steps: FunnelStep[]
  wonRevenue: number
}

/**
 * One batch's funnel, extracted through to revenue.
 *
 * The steps are returned in order and already labelled, so a caller cannot
 * accidentally render them out of sequence — a funnel whose steps are shuffled
 * is worse than no funnel, because it still looks authoritative.
 */
export async function getBatchFunnel(
  workspaceId: string,
  batchId: string,
): Promise<Omit<BatchFunnel, 'name' | 'createdAt'> | null> {
  const { data, error } = await createAdminClient().rpc('crm_batch_funnel', {
    p_workspace_id: workspaceId,
    p_batch_id: batchId,
  })

  if (error) throw new Error(`getBatchFunnel failed: ${error.message}`)
  const row = data?.[0]
  if (!row) return null

  return {
    batchId,
    steps: [
      { label: 'Extracted', value: Number(row.extracted) },
      { label: 'Canonical contacts', value: Number(row.canonical) },
      { label: 'With an email', value: Number(row.with_email), isCoverage: true },
      { label: 'Assigned', value: Number(row.assigned) },
      { label: 'Emailed or engaged', value: Number(row.engaged) },
      { label: 'Replied', value: Number(row.replied) },
      { label: 'Qualified', value: Number(row.qualified) },
      { label: 'Call booked', value: Number(row.call_booked) },
      { label: 'Opportunity', value: Number(row.opportunities) },
      { label: 'Won', value: Number(row.won_deals) },
    ],
    wonRevenue: Number(row.won_revenue),
  }
}

/** Every batch in the workspace with its funnel, newest first. */
export async function listBatchFunnels(
  workspaceId: string,
  limit = 10,
): Promise<BatchFunnel[]> {
  const { data, error } = await createAdminClient()
    .from('crm_lead_batches')
    .select('id, name, created_at')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 25))

  if (error) throw new Error(`listBatchFunnels failed: ${error.message}`)

  const funnels: BatchFunnel[] = []
  for (const batch of data ?? []) {
    const funnel = await getBatchFunnel(workspaceId, batch.id)
    if (!funnel) continue
    funnels.push({ ...funnel, name: batch.name, createdAt: batch.created_at })
  }

  return funnels
}

export type LeaderboardRow = SetterDashboard & { name: string }

/**
 * The team leaderboard.
 *
 * ⚠️ MANAGERS ONLY. It reads every member's numbers by definition, so the
 * caller must have checked `report.team.view` before getting here — this
 * function has no way to know who is asking.
 */
export async function getLeaderboard(
  workspaceId: string,
  fromDay: string,
  toDay: string,
): Promise<LeaderboardRow[]> {
  const db = createAdminClient()

  const { data: memberships, error } = await db
    .from('workspace_memberships')
    .select('user_id')
    .eq('workspace_id', workspaceId)

  if (error) throw new Error(`getLeaderboard failed: ${error.message}`)
  const ids = (memberships ?? []).map((m) => m.user_id)
  if (ids.length === 0) return []

  const { data: profiles } = await db
    .from('profiles')
    .select('id, full_name, email')
    .in('id', ids)

  const nameOf = new Map<string, string>(
    (profiles ?? []).map((p) => [p.id, p.full_name?.trim() || p.email || 'Unknown']),
  )

  const rows = await Promise.all(
    ids.map(async (userId) => ({
      ...(await getSetterDashboard(workspaceId, userId, fromDay, toDay)),
      name: nameOf.get(userId) ?? 'Unknown',
    })),
  )

  // Ordered by contacts emailed rather than emails sent: a leaderboard that
  // ranks on volume rewards blasting the same person repeatedly.
  return rows.sort((a, b) => b.contactsEmailed - a.contactsEmailed || b.replies - a.replies)
}

/** Tasks past their due date, for the manager view. */
export async function countOverdueTasks(
  workspaceId: string,
  assignedToUserId: string | null,
): Promise<number> {
  let query = createAdminClient()
    .from('crm_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'open')
    .is('deleted_at', null)
    .lt('due_at', new Date().toISOString())

  if (assignedToUserId) query = query.eq('assigned_to_user_id', assignedToUserId)

  const { count, error } = await query
  if (error) throw new Error(`countOverdueTasks failed: ${error.message}`)
  return count ?? 0
}

// ---------------------------------------------------------------------------
// Forecasting (Phase 10.5)
// ---------------------------------------------------------------------------

export type ForecastPeriod = {
  /** ISO date of the first of the month, or `null` for the undated bucket. */
  period: string | null
  openDeals: number
  openValue: number
  weightedValue: number
}

/**
 * Weighted pipeline by expected close month.
 *
 * ⚠️ THE UNDATED BUCKET IS REAL PIPELINE, returned with `period: null` rather
 * than dropped. A rep with a large undated pipeline has a forecasting problem
 * the report should show, and hiding it would make the forecast look tidier
 * than the business is.
 */
export async function getForecast(
  workspaceId: string,
  ownerUserId: string | null,
): Promise<ForecastPeriod[]> {
  const { data, error } = await createAdminClient().rpc('crm_forecast_by_period', {
    p_workspace_id: workspaceId,
    ...(ownerUserId ? { p_owner_user_id: ownerUserId } : {}),
  })

  if (error) throw new Error(`getForecast failed: ${error.message}`)

  return (data ?? []).map((row) => ({
    period: row.period,
    openDeals: Number(row.open_deals),
    openValue: Number(row.open_value),
    weightedValue: Number(row.weighted_value),
  }))
}

export type WinRate = {
  ownerUserId: string | null
  name: string
  wonDeals: number
  lostDeals: number
  wonValue: number
  /** `null` when nothing closed — a rep who closed nothing has no rate. */
  winRate: number | null
}

/** Historical win rate per owner, over deals CLOSED in the period. */
export async function getWinRates(
  workspaceId: string,
  fromDay: string,
  toDay: string,
): Promise<WinRate[]> {
  const db = createAdminClient()

  const { data, error } = await db.rpc('crm_win_rates', {
    p_workspace_id: workspaceId,
    p_from_day: fromDay,
    p_to_day: toDay,
  })

  if (error) throw new Error(`getWinRates failed: ${error.message}`)

  const ids = (data ?? []).map((r) => r.owner_user_id).filter((id): id is string => Boolean(id))
  const names = new Map<string, string>()
  if (ids.length > 0) {
    const { data: profiles } = await db
      .from('profiles')
      .select('id, full_name, email')
      .in('id', ids)
    for (const p of profiles ?? []) {
      names.set(p.id, p.full_name?.trim() || p.email || 'Unknown')
    }
  }

  return (data ?? []).map((row) => ({
    ownerUserId: row.owner_user_id,
    name: row.owner_user_id ? (names.get(row.owner_user_id) ?? 'Unknown') : 'Unassigned',
    wonDeals: Number(row.won_deals),
    lostDeals: Number(row.lost_deals),
    wonValue: Number(row.won_value),
    winRate: row.win_rate === null ? null : Number(row.win_rate),
  }))
}

/** The date-range presets the dashboard offers. */
export const RANGES = {
  '7d': { label: 'Last 7 days', days: 7 },
  '30d': { label: 'Last 30 days', days: 30 },
  '90d': { label: 'Last 90 days', days: 90 },
} as const

export type RangeKey = keyof typeof RANGES

export function resolveRange(key: string | undefined): {
  key: RangeKey
  fromDay: string
  toDay: string
} {
  const resolved: RangeKey = key === '7d' || key === '30d' || key === '90d' ? key : '30d'
  const days = RANGES[resolved].days
  const day = (d: Date) => d.toISOString().slice(0, 10)

  return {
    key: resolved,
    // Inclusive of today, so "last 7 days" is today plus six.
    fromDay: day(new Date(Date.now() - (days - 1) * 86_400_000)),
    toDay: day(new Date()),
  }
}

/**
 * The window immediately BEFORE the selected one, same length, no overlap.
 *
 * ⚠️ THE PREVIOUS PERIOD ENDS THE DAY BEFORE THIS ONE STARTS. Overlapping the
 * two windows by even a day would let the same activity count on both sides of
 * a comparison, which flatters or flattens every trend depending on where the
 * good day fell.
 */
export function previousRange(range: { fromDay: string; toDay: string }): {
  fromDay: string
  toDay: string
} {
  const day = (d: Date) => d.toISOString().slice(0, 10)
  const from = new Date(`${range.fromDay}T00:00:00Z`)
  const to = new Date(`${range.toDay}T00:00:00Z`)
  const span = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1

  return {
    fromDay: day(new Date(from.getTime() - span * 86_400_000)),
    toDay: day(new Date(from.getTime() - 86_400_000)),
  }
}

/**
 * Percentage change, or `null` when there is nothing to compare against.
 *
 * ⚠️ NULL WHEN THE PREVIOUS PERIOD WAS ZERO. Going from 0 to 5 is not "+500%"
 * and not "+100%" — it is a start, and any percentage there is invented. The
 * caller shows the raw previous value instead.
 */
export function trend(current: number, previous: number): number | null {
  if (previous === 0) return null
  return (current - previous) / previous
}
