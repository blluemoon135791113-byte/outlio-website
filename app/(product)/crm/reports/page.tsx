import type { Metadata } from 'next'
import Link from 'next/link'

import { getLastRollupRun } from '@/lib/crm/metrics'
import { getSetterDashboard } from '@/lib/crm/metrics'
import {
  countOverdueTasks,
  getLeaderboard,
  getPipelineTotals,
  listBatchFunnels,
  RANGES,
  resolveRange,
  type RangeKey,
} from '@/lib/crm/reports'
import { requireWorkspace } from '@/lib/workspaces/context'
import { can, dataScope } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Reports | Outlio',
  robots: { index: false, follow: false },
}

/**
 * Reports.
 *
 * ⚠️ EVERYONE SEES THEIR OWN NUMBERS; ONLY A MANAGER SEES THE TEAM'S. The
 * leaderboard and the workspace totals are behind `report.team.view`, checked
 * here — `getLeaderboard` reads every member's figures by definition and has
 * no way to know who is asking.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const ctx = await requireWorkspace()
  const params = await searchParams
  const range = resolveRange(params.range)

  const policy = { role: ctx.role, modules: ctx.modules }
  const canSeeTeam = can(policy, 'report.team.view')
  // ⚠️ The button follows the permission; the ROUTE enforces it. A download
  // handler is reachable by typing a URL (CLAUDE.md rule 8).
  const canExport = can(policy, 'report.export')
  const scopedToSelf = dataScope(ctx.role) === 'assigned'

  const [mine, myPipeline, lastRun] = await Promise.all([
    getSetterDashboard(ctx.workspace.id, ctx.userId, range.fromDay, range.toDay),
    getPipelineTotals(ctx.workspace.id, ctx.userId),
    getLastRollupRun(ctx.workspace.id),
  ])

  const [leaderboard, teamPipeline, overdue, funnels] = canSeeTeam
    ? await Promise.all([
        getLeaderboard(ctx.workspace.id, range.fromDay, range.toDay),
        getPipelineTotals(ctx.workspace.id, null),
        countOverdueTasks(ctx.workspace.id, null),
        listBatchFunnels(ctx.workspace.id),
      ])
    : [[], null, await countOverdueTasks(ctx.workspace.id, ctx.userId), []]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">Reports</h2>
          <p className="mt-0.5 text-xs text-muted">
            {RANGES[range.key].label}
            {scopedToSelf ? ' · your activity' : ''}
          </p>
        </div>
        <nav aria-label="Date range" className="flex gap-1">
          {(Object.keys(RANGES) as RangeKey[]).map((key) => (
            <Link
              key={key}
              href={`/crm/reports?range=${key}`}
              aria-current={key === range.key ? 'page' : undefined}
              className={
                key === range.key
                  ? 'rounded-[var(--radius-md)] bg-surface-muted px-3 py-1.5 text-xs font-semibold text-ink'
                  : 'rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink'
              }
            >
              {RANGES[key].label}
            </Link>
          ))}
        </nav>
      </div>

      {/*
        Staleness is stated, not hidden. A dashboard that never says when it
        was computed is one nobody can tell has stopped updating.
      */}
      {lastRun?.finishedAt ? (
        <p className="text-xs text-muted">
          Figures computed {new Date(lastRun.finishedAt).toLocaleString()}
          {lastRun.discrepancies && lastRun.discrepancies > 0 ? (
            <span className="ml-2 rounded-full bg-warning-soft px-2 py-0.5 font-semibold text-warning">
              {lastRun.discrepancies} unreconciled
            </span>
          ) : null}
        </p>
      ) : (
        <p className="text-xs text-muted">
          These figures have not been computed yet. They appear after the first rollup.
        </p>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">Your activity</h3>
          {/* Always available: it contains only numbers this person can
              already see on this page. */}
          <ExportLink kind="my_activity" range={range.key} label="Export mine" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Contacts created" value={mine.contactsCreated} />
          <Stat label="Contacts emailed" value={mine.contactsEmailed} />
          <Stat label="Emails sent" value={mine.emailsSent} />
          <Stat label="Replies" value={mine.replies} />
          <Stat
            label="Reply rate"
            // null, not 0%: a person who has emailed nobody has no rate, and
            // 0% reads as failure rather than absence.
            value={mine.replyRate === null ? '—' : `${Math.round(mine.replyRate * 100)}%`}
          />
          <Stat label="Engagements" value={mine.engagements} />
          <Stat label="Openers sent" value={mine.openersSent} />
          <Stat label="Calls booked" value={mine.callsBooked} />
          <Stat label="Tasks completed" value={mine.tasksCompleted} />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink">Your pipeline</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Open deals" value={myPipeline.openDeals} />
          <Stat label="Open value" value={money(myPipeline.openValue)} />
          <Stat label="Weighted forecast" value={money(myPipeline.weightedValue)} />
          <Stat label="Won revenue" value={money(myPipeline.wonValue)} />
        </div>
        <p className="text-xs text-muted">
          Overdue tasks: <span className="font-semibold text-ink">{overdue}</span>
        </p>
      </section>

      {canSeeTeam && teamPipeline ? (
        <>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">Workspace</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Open deals" value={teamPipeline.openDeals} />
              <Stat label="Open value" value={money(teamPipeline.openValue)} />
              <Stat label="Weighted forecast" value={money(teamPipeline.weightedValue)} />
              <Stat label="Won revenue" value={money(teamPipeline.wonValue)} />
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">Team</h3>
              {canExport ? (
                <ExportLink kind="leaderboard" range={range.key} label="Export team" />
              ) : null}
            </div>
            {leaderboard.length === 0 ? (
              <p className="text-sm text-muted">No members yet.</p>
            ) : (
              <div className="clay overflow-x-auto p-0">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted">
                      <th scope="col" className="px-4 py-3 font-semibold">Person</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Contacts emailed</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Replies</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Reply rate</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Calls booked</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Won revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((row) => (
                      <tr key={row.userId} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-3 font-semibold text-ink">{row.name}</td>
                        <td className="px-4 py-3 text-muted">{row.contactsEmailed}</td>
                        <td className="px-4 py-3 text-muted">{row.replies}</td>
                        <td className="px-4 py-3 text-muted">
                          {row.replyRate === null ? '—' : `${Math.round(row.replyRate * 100)}%`}
                        </td>
                        <td className="px-4 py-3 text-muted">{row.callsBooked}</td>
                        <td className="px-4 py-3 text-muted">{money(row.wonRevenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">Lead batches</h3>
              {canExport ? (
                <ExportLink kind="funnels" range={range.key} label="Export funnels" />
              ) : null}
            </div>
            {funnels.length === 0 ? (
              <p className="text-sm text-muted">
                No batches yet. A funnel appears once an extraction or an import has run.
              </p>
            ) : (
              <div className="space-y-3">
                {funnels.map((funnel) => {
                  const top = funnel.steps[0]?.value || 1
                  return (
                    <div key={funnel.batchId} className="clay space-y-2 p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h4 className="text-sm font-semibold text-ink">{funnel.name}</h4>
                        <span className="text-xs text-muted">
                          {money(funnel.wonRevenue)} won
                        </span>
                      </div>
                      <ol className="space-y-1">
                        {funnel.steps.map((step) => (
                          <li key={step.label} className="flex items-center gap-3">
                            <span className="w-40 shrink-0 text-xs text-muted">
                              {step.label}
                              {step.isCoverage ? (
                                <span
                                  className="ml-1 text-[10px] uppercase tracking-wide text-muted"
                                  title="How many of these contacts have an address — not a stage they pass through"
                                >
                                  coverage
                                </span>
                              ) : null}
                            </span>
                            {/*
                              Width is relative to the FIRST step, so the bars
                              show attrition. A funnel scaled to its own
                              maximum would always look full at the top.
                            */}
                            <span
                              className={`h-2 rounded-full ${step.isCoverage ? 'bg-muted/40' : 'bg-accent'}`}
                              style={{ width: `${Math.max((step.value / top) * 100, step.value > 0 ? 2 : 0)}%` }}
                            />
                            <span className="text-xs font-semibold text-ink">{step.value}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}

/**
 * A plain link, not a fetch. The browser's own download handling gets the
 * filename from Content-Disposition and streams straight to disk, and it keeps
 * working with JavaScript disabled.
 */
function ExportLink({
  kind,
  range,
  label,
}: {
  kind: 'leaderboard' | 'funnels' | 'my_activity'
  range: string
  label: string
}) {
  return (
    <a
      href={`/crm/reports/export?kind=${kind}&range=${range}`}
      className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-semibold text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink"
    >
      {label}
    </a>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="clay p-4">
      <p className="text-xs uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-[-0.02em] text-ink">{value}</p>
    </div>
  )
}

/**
 * ⚠️ FORMATS ONE ALREADY-TOTALLED VALUE. Every sum reaching this page was
 * computed in Postgres (Ledger D25); nothing here adds two money values.
 */
function money(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}
