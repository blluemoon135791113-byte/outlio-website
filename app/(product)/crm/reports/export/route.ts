import { NextResponse } from 'next/server'

import { getSetterDashboard } from '@/lib/crm/metrics'
import {
  exportFilename,
  funnelsCsv,
  leaderboardCsv,
  myActivityCsv,
  ReportTooLargeError,
  type ReportKind,
} from '@/lib/crm/report-export'
import {
  getLeaderboard,
  getPipelineTotals,
  listBatchFunnels,
  resolveRange,
} from '@/lib/crm/reports'
import { toClientError } from '@/lib/errors/catalog'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

/**
 * Report download.
 *
 * ⚠️ THE PERMISSION IS CHECKED HERE, NOT ON THE BUTTON. A route handler is
 * reachable by typing a URL, so hiding the download link would be no control
 * at all (CLAUDE.md rule 8). `report.export` is denied to setters by default.
 *
 * ⚠️ `my_activity` is deliberately the ONE kind a person can always export:
 * it contains only their own numbers, which they can already see. The team
 * leaderboard and the batch funnels are the whole workspace's figures, and
 * exporting those is a separate act from reading your own dashboard.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const kind = (url.searchParams.get('kind') ?? 'my_activity') as ReportKind
  const range = resolveRange(url.searchParams.get('range') ?? undefined)

  try {
    const needed = kind === 'my_activity' ? 'report.own.view' : 'report.export'
    const ctx = await assertWorkspacePermission(needed)

    let csv: string

    if (kind === 'leaderboard') {
      csv = leaderboardCsv(await getLeaderboard(ctx.workspace.id, range.fromDay, range.toDay))
    } else if (kind === 'funnels') {
      csv = funnelsCsv(await listBatchFunnels(ctx.workspace.id))
    } else {
      const [dashboard, pipeline] = await Promise.all([
        getSetterDashboard(ctx.workspace.id, ctx.userId, range.fromDay, range.toDay),
        getPipelineTotals(ctx.workspace.id, ctx.userId),
      ])
      csv = myActivityCsv(dashboard, pipeline, ctx.email ?? 'You')
    }

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${exportFilename(kind, range.fromDay, range.toDay)}"`,
        // A report is a snapshot of a moment; a cached one is a wrong one.
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof ReportTooLargeError) {
      return NextResponse.json({ error: { message: error.message } }, { status: 413 })
    }
    // Never a stack trace, SQL or an internal id to the client.
    const { status, body } = toClientError(error)
    return NextResponse.json(body, { status })
  }
}
