import type { Metadata } from 'next'
import Link from 'next/link'

import { CreateDashboard } from '@/components/reports/DashboardEditor'
import { listDashboards } from '@/lib/reports/dashboards'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Dashboards | Outlio',
  robots: { index: false, follow: false },
}

/**
 * Custom dashboards — R7.
 *
 * The fixed reports assume one sales motion. This is where a workspace builds
 * the one it actually runs.
 */
export default async function DashboardsPage() {
  const ctx = await workspaceContextIfPermitted('crm.contact.view')
  // The layout renders the reason; this only stops the page computing and
  // serialising its result into the RSC payload.
  if (!ctx) return null
  const canEdit = can({ role: ctx.role, modules: ctx.modules }, 'crm.export')
  const dashboards = await listDashboards(ctx.workspace.id)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">Dashboards</h2>
          <p className="mt-0.5 text-sm text-muted">
            Build the numbers your team actually works to.
          </p>
        </div>
        {canEdit ? <CreateDashboard /> : null}
      </div>

      {dashboards.length === 0 ? (
        /*
          ⚠️ AN EMPTY STATE WITH THE REASON AND THE ACTION. The fixed reports
          still exist and still work — someone landing here needs to know this
          is an addition, not a replacement they have to configure before
          anything works.
        */
        <div className="clay p-10 text-center">
          <p className="text-sm font-medium text-ink">No dashboards yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted">
            The standard reports keep working without this. A dashboard is for the numbers
            that are particular to how you sell — calls booked, trials started, expected
            MRR — rather than the ones every team shares.
          </p>
          {!canEdit ? (
            <p className="mt-2 text-xs text-muted">Ask a manager to set one up.</p>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {dashboards.map((dashboard) => (
            <li key={dashboard.id}>
              <Link href={`/crm/reports/dashboards/${dashboard.id}`} className="clay block p-4">
                <p className="text-sm font-medium text-ink">
                  {dashboard.name}
                  {dashboard.isDefault ? (
                    <span className="ml-2 text-xs font-normal text-muted">Opens first</span>
                  ) : null}
                </p>
                {dashboard.description ? (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted">
                    {dashboard.description}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-muted">
                  {dashboard.widgetCount}{' '}
                  {dashboard.widgetCount === 1 ? 'widget' : 'widgets'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
