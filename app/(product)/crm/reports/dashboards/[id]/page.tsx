import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AddWidget, WidgetControls } from '@/components/reports/DashboardEditor'
import { Widget } from '@/components/reports/Widget'
import { getDashboard } from '@/lib/reports/dashboards'
import { METRICS, metric } from '@/lib/reports/metrics'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'
import { can, dataScope } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Dashboard | Outlio',
  robots: { index: false, follow: false },
}

const SINCE_DAYS = 30

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const ctx = await workspaceContextIfPermitted('crm.contact.view')
  // The layout renders the reason; this only stops the page computing and
  // serialising its result into the RSC payload.
  if (!ctx) return null
  const { id } = await params

  const dashboard = await getDashboard(ctx.workspace.id, id)
  if (!dashboard) notFound()

  const policy = { role: ctx.role, modules: ctx.modules }
  const canEdit = can(policy, 'crm.export')

  /*
   * ⚠️ THE VIEWER'S SCOPE, NOT THE AUTHOR'S. A setter opening a dashboard a
   * manager built sees THEIR numbers — the widget names a metric, and the
   * metric applies `dataScope` when it runs. A dashboard is not a way around
   * the permission layer.
   */
  const ownerUserId = dataScope(ctx.role) === 'assigned' ? ctx.userId : null

  const rendered = await Promise.all(
    dashboard.widgets.map(async (widget) => {
      const definition = metric(widget.metricKey)

      /*
       * A metric can be retired while a widget still names it. Saying so is
       * far better than rendering a blank card nobody can explain.
       */
      if (!definition) {
        return { widget, definition: null, value: null, denied: false }
      }

      // Re-checked at RENDER time, not only when the widget was added: a
      // person's role can change after a dashboard is built.
      if (!can(policy, definition.permission)) {
        return { widget, definition, value: null, denied: true }
      }

      const value = await definition.compute({
        workspaceId: ctx.workspace.id,
        ownerUserId,
        sinceDays: SINCE_DAYS,
      })

      return { widget, definition, value, denied: false }
    }),
  )

  const available = METRICS.filter((m) => can(policy, m.permission)).map((m) => ({
    key: m.key,
    label: m.label,
    description: m.description,
    source: m.source,
    visuals: m.visuals as string[],
  }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/crm/reports/dashboards" className="text-xs text-muted hover:text-ink">
            ← Dashboards
          </Link>
          <h2 className="mt-1 text-base font-semibold tracking-[-0.02em] text-ink">
            {dashboard.name}
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Last {SINCE_DAYS} days
            {ownerUserId ? ' · your records only' : ''}
          </p>
        </div>
      </div>

      {canEdit ? <AddWidget dashboardId={dashboard.id} metrics={available} /> : null}

      {rendered.length === 0 ? (
        <div className="clay p-10 text-center">
          <p className="text-sm font-medium text-ink">This dashboard is empty</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
            {canEdit
              ? 'Add a widget above to start measuring something.'
              : 'Ask a manager to add the numbers your team works to.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {rendered.map((entry, index) => (
            <div key={entry.widget.id} className={entry.widget.width === 4 ? 'sm:col-span-2 xl:col-span-4' : entry.widget.width === 2 ? 'sm:col-span-2' : ''}>
              {entry.definition === null ? (
                <article className="clay p-4">
                  <h3 className="text-xs text-muted">Unknown metric</h3>
                  <p className="mt-1 text-sm text-ink">
                    “{entry.widget.metricKey}” is no longer available.
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Remove this widget, or pick a different metric.
                  </p>
                </article>
              ) : entry.denied ? (
                /*
                  ⚠️ NAMED, NOT HIDDEN. Silently dropping the widget would make
                  a setter think the dashboard is broken. Saying they cannot
                  see this one is honest and explains the gap in the grid.
                */
                <article className="clay p-4">
                  <h3 className="text-xs text-muted">{entry.definition.label}</h3>
                  <p className="mt-1 text-sm text-muted">Not visible to you</p>
                </article>
              ) : (
                <Widget
                  title={entry.widget.title ?? entry.definition.label}
                  description={entry.definition.description}
                  visual={entry.widget.visual}
                  value={entry.value}
                  width={1}
                />
              )}

              {canEdit ? (
                <div className="mt-1 flex justify-end">
                  <WidgetControls
                    dashboardId={dashboard.id}
                    widgetId={entry.widget.id}
                    isFirst={index === 0}
                    isLast={index === rendered.length - 1}
                    label={entry.definition?.label ?? 'widget'}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
