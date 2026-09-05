import 'server-only'

/**
 * Reading and writing dashboards — R7.
 *
 * ⚠️ WIDGET POSITIONS ARE 0-BASED AND CONTIGUOUS, with a unique index on
 * `(dashboard_id, position)`. Same constraint shape as email sequence steps,
 * and the same two-pass reorder for the same reason: assigning position 0 to
 * the widget currently at 1 collides with the widget still sitting at 0.
 */
import { createAdminClient } from '@/lib/supabase/admin'

export type DashboardSummary = {
  id: string
  name: string
  description: string | null
  isDefault: boolean
  widgetCount: number
}

export type StoredWidget = {
  id: string
  metricKey: string
  title: string | null
  visual: 'stat' | 'bar' | 'bullet' | 'list'
  position: number
  width: 1 | 2 | 4
}

export async function listDashboards(workspaceId: string): Promise<DashboardSummary[]> {
  const db = createAdminClient()

  // Scoped by workspace in code — the service role bypasses RLS.
  const { data } = await db
    .from('dashboards')
    .select('id, name, description, is_default')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('is_default', { ascending: false })
    .order('created_at')

  const rows = data ?? []
  if (rows.length === 0) return []

  // One batched count rather than a query per dashboard.
  const { data: widgets } = await db
    .from('dashboard_widgets')
    .select('dashboard_id')
    .eq('workspace_id', workspaceId)
    .in('dashboard_id', rows.map((d) => d.id))

  const counts = new Map<string, number>()
  for (const w of widgets ?? []) {
    counts.set(w.dashboard_id, (counts.get(w.dashboard_id) ?? 0) + 1)
  }

  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    isDefault: d.is_default,
    widgetCount: counts.get(d.id) ?? 0,
  }))
}

export async function getDashboard(
  workspaceId: string,
  dashboardId: string,
): Promise<{ id: string; name: string; widgets: StoredWidget[] } | null> {
  const db = createAdminClient()

  const { data: dashboard } = await db
    .from('dashboards')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .eq('id', dashboardId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!dashboard) return null

  const { data: widgets } = await db
    .from('dashboard_widgets')
    .select('id, metric_key, title, visual, position, width')
    .eq('workspace_id', workspaceId)
    .eq('dashboard_id', dashboardId)
    .order('position')

  return {
    id: dashboard.id,
    name: dashboard.name,
    widgets: (widgets ?? []).map((w) => ({
      id: w.id,
      metricKey: w.metric_key,
      title: w.title,
      visual: w.visual as StoredWidget['visual'],
      position: w.position,
      width: w.width as StoredWidget['width'],
    })),
  }
}

/**
 * Rewrites positions as 0..n-1 in the order given.
 *
 * ⚠️ TWO PASSES. The unique index on `(dashboard_id, position)` makes a single
 * pass impossible — everything is parked above the live range first, then
 * settled. Identical to `writeStepOrder` in `lib/email/sequence.ts`, and for an
 * identical reason.
 */
export async function writeWidgetOrder(
  workspaceId: string,
  idsInOrder: string[],
): Promise<void> {
  const db = createAdminClient()
  const PARK = 1000

  for (let i = 0; i < idsInOrder.length; i += 1) {
    const { error } = await db
      .from('dashboard_widgets')
      .update({ position: PARK + i })
      .eq('workspace_id', workspaceId)
      .eq('id', idsInOrder[i]!)
    if (error) throw new Error(`writeWidgetOrder (park) failed: ${error.message}`)
  }

  for (let i = 0; i < idsInOrder.length; i += 1) {
    const { error } = await db
      .from('dashboard_widgets')
      .update({ position: i })
      .eq('workspace_id', workspaceId)
      .eq('id', idsInOrder[i]!)
    if (error) throw new Error(`writeWidgetOrder (settle) failed: ${error.message}`)
  }
}

/** Closes the gap a removal leaves. */
export async function renumberWidgets(
  workspaceId: string,
  dashboardId: string,
): Promise<void> {
  const { data } = await createAdminClient()
    .from('dashboard_widgets')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('dashboard_id', dashboardId)
    .order('position')

  await writeWidgetOrder(workspaceId, (data ?? []).map((w) => w.id))
}
