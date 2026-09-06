'use server'

/**
 * Dashboard editing — R7.
 *
 * ⚠️ THE METRIC KEY IS VALIDATED AGAINST THE CATALOGUE, AND SO IS THE
 * PERMISSION BEHIND IT. A key arriving from a form is a claim: without the
 * second check, a setter could add a widget naming a metric they are not
 * allowed to see, and the dashboard would happily compute it for them.
 */
import { revalidatePath } from 'next/cache'

import { renumberWidgets, writeWidgetOrder } from '@/lib/reports/dashboards'
import { metric } from '@/lib/reports/metrics'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission, requireWorkspace } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export type DashboardState =
  | { ok: true; message: string; dashboardId?: string }
  | { ok: false; error: string }
  | null

const PATH = '/crm/reports/dashboards'

export async function createDashboard(
  _previous: DashboardState,
  formData: FormData,
): Promise<DashboardState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.export')
  } catch {
    return { ok: false, error: 'You do not have permission to build dashboards.' }
  }

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { ok: false, error: 'Give the dashboard a name.' }

  const db = createAdminClient()

  // The first dashboard in a workspace opens by default, or nothing does.
  const { count } = await db
    .from('dashboards')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', ctx.workspace.id)
    .is('deleted_at', null)

  const { data, error } = await db
    .from('dashboards')
    .insert({
      workspace_id: ctx.workspace.id,
      name,
      description: String(formData.get('description') ?? '').trim() || null,
      is_default: (count ?? 0) === 0,
      created_by: ctx.userId,
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false, error: 'Could not create that dashboard.' }

  revalidatePath(PATH)
  return { ok: true, message: `${name} created.`, dashboardId: data.id }
}

export async function addWidget(
  _previous: DashboardState,
  formData: FormData,
): Promise<DashboardState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.export')
  } catch {
    return { ok: false, error: 'You do not have permission to edit dashboards.' }
  }

  const dashboardId = String(formData.get('dashboardId') ?? '')
  const metricKey = String(formData.get('metricKey') ?? '')

  const definition = metric(metricKey)
  if (!definition) return { ok: false, error: 'That metric does not exist.' }

  /*
   * ⚠️ THE SECOND CHECK, AND THE ONE THAT MATTERS. Editing dashboards and
   * seeing a given metric are different permissions. Without this a setter
   * could add a pipeline-value widget they may not view, and the renderer
   * would compute it for them — a dashboard is not a way around the policy
   * layer.
   */
  if (!can({ role: ctx.role, modules: ctx.modules }, definition.permission)) {
    return { ok: false, error: `You do not have access to “${definition.label}”.` }
  }

  const db = createAdminClient()

  const { data: dashboard } = await db
    .from('dashboards')
    .select('id')
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', dashboardId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!dashboard) return { ok: false, error: 'That dashboard no longer exists.' }

  /*
   * ⚠️ THE POSITION IS DERIVED, NOT SUPPLIED. Unique on
   * (dashboard_id, position); a value from the form would collide the moment
   * two people added a widget at once.
   */
  const { data: last } = await db
    .from('dashboard_widgets')
    .select('position')
    .eq('dashboard_id', dashboardId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const visual = String(formData.get('visual') ?? definition.visuals[0])

  const { error } = await db.from('dashboard_widgets').insert({
    workspace_id: ctx.workspace.id,
    dashboard_id: dashboardId,
    metric_key: metricKey,
    // Only a visual the metric actually offers — a rate drawn as a list, or a
    // currency total drawn as a bullet with nothing to fill against, is noise.
    visual: definition.visuals.includes(visual as never) ? visual : definition.visuals[0]!,
    position: last ? last.position + 1 : 0,
    width: Number(formData.get('width') ?? 1),
  })

  if (error) return { ok: false, error: 'Could not add that widget.' }

  revalidatePath(`${PATH}/${dashboardId}`)
  return { ok: true, message: `${definition.label} added.` }
}

export async function removeWidget(
  _previous: DashboardState,
  formData: FormData,
): Promise<DashboardState> {
  try {
    const ctx = await assertWorkspacePermission('crm.export')
    const dashboardId = String(formData.get('dashboardId') ?? '')

    const { error } = await createAdminClient()
      .from('dashboard_widgets')
      .delete()
      .eq('workspace_id', ctx.workspace.id)
      .eq('dashboard_id', dashboardId)
      .eq('id', String(formData.get('widgetId') ?? ''))

    if (error) return { ok: false, error: 'Could not remove that widget.' }

    // The gap must close, or the next insert collides with the old top.
    await renumberWidgets(ctx.workspace.id, dashboardId)

    revalidatePath(`${PATH}/${dashboardId}`)
    return { ok: true, message: 'Widget removed.' }
  } catch {
    return { ok: false, error: 'Could not remove that widget.' }
  }
}

export async function moveWidget(
  _previous: DashboardState,
  formData: FormData,
): Promise<DashboardState> {
  try {
    const ctx = await requireWorkspace()
    if (!can({ role: ctx.role, modules: ctx.modules }, 'crm.export')) {
      return { ok: false, error: 'You do not have permission to edit dashboards.' }
    }

    const dashboardId = String(formData.get('dashboardId') ?? '')
    const widgetId = String(formData.get('widgetId') ?? '')
    const direction = String(formData.get('direction') ?? '')

    const { data: widgets } = await createAdminClient()
      .from('dashboard_widgets')
      .select('id')
      .eq('workspace_id', ctx.workspace.id)
      .eq('dashboard_id', dashboardId)
      .order('position')

    const ids = (widgets ?? []).map((w) => w.id)
    const at = ids.indexOf(widgetId)
    const target = direction === 'up' ? at - 1 : at + 1

    if (at < 0 || target < 0 || target >= ids.length) {
      return { ok: false, error: 'That widget cannot move any further.' }
    }

    ;[ids[at], ids[target]] = [ids[target]!, ids[at]!]
    await writeWidgetOrder(ctx.workspace.id, ids)

    revalidatePath(`${PATH}/${dashboardId}`)
    return { ok: true, message: 'Moved.' }
  } catch {
    return { ok: false, error: 'Could not move that widget.' }
  }
}
