import type { Metadata } from 'next'
import Link from 'next/link'

import { createAdminClient } from '@/lib/supabase/admin'
import { requireWorkspace } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Email analytics | Outlio',
  robots: { index: false, follow: false },
}

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
] as const

/** A count, or an honest dash when the number does not exist yet. */
function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: number | string | null
  hint?: string
}) {
  return (
    <div className="clay p-4">
      <p className="text-xs text-muted">{label}</p>
      {/*
        ⚠️ NULL IS NOT ZERO. `email_campaign_report` returns a NULL reply rate
        when nothing has been sent, precisely because 0% would read as "nobody
        answered" when the truth is "nothing went out". The UI has to preserve
        that distinction or the function's care is wasted.
      */}
      <p className={value === null ? 'mt-1 text-lg text-muted' : 'mt-1 text-lg font-semibold text-ink'}>
        {value === null ? '—' : value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

/**
 * Email analytics — R14.
 *
 * ⚠️ `email_mailbox_report` HAD NO CALLER. It was written and tested in M7 and
 * nothing in the product read it, so nobody could see how their mailboxes were
 * performing — which is the number that decides whether outreach works at all.
 */
export default async function EmailAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const ctx = await requireWorkspace()
  const params = await searchParams

  if (!can({ role: ctx.role, modules: ctx.modules }, 'email.campaign.view')) {
    return (
      <div className="clay p-10 text-center">
        <p className="text-sm font-medium text-ink">You do not have access to email reporting</p>
      </div>
    )
  }

  const days = RANGES.some((r) => r.value === params.days) ? Number(params.days) : 30
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
  const day = (d: Date) => d.toISOString().slice(0, 10)

  const db = createAdminClient()

  // Scoped by workspace in code — the service role bypasses RLS.
  const { data: mailboxes } = await db.rpc('email_mailbox_report', {
    p_workspace_id: ctx.workspace.id,
    p_from_day: day(from),
    p_to_day: day(to),
  })

  const rows = mailboxes ?? []

  const totals = rows.reduce(
    (acc, r) => ({
      sent: acc.sent + Number(r.sent ?? 0),
      delivered: acc.delivered + Number(r.delivered ?? 0),
      replied: acc.replied + Number(r.replied ?? 0),
      bounced: acc.bounced + Number(r.bounced ?? 0),
      queued: acc.queued + Number(r.queued ?? 0),
      needsVerification: acc.needsVerification + Number(r.needs_verification ?? 0),
    }),
    { sent: 0, delivered: 0, replied: 0, bounced: 0, queued: 0, needsVerification: 0 },
  )

  /*
   * ⚠️ A RATE OVER ZERO SENDS IS UNKNOWN, NOT ZERO. Showing 0% before anything
   * has gone out tells someone their outreach is failing when in fact it has
   * not started.
   */
  const replyRate = totals.sent > 0 ? `${((totals.replied / totals.sent) * 100).toFixed(1)}%` : null
  const bounceRate = totals.sent > 0 ? `${((totals.bounced / totals.sent) * 100).toFixed(1)}%` : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">Email analytics</h2>
          <p className="mt-0.5 text-sm text-muted">
            Last {days} days, across every mailbox in this workspace.
          </p>
        </div>

        <nav aria-label="Date range" className="flex gap-1">
          {RANGES.map((range) => (
            <Link
              key={range.value}
              href={`/email/analytics?days=${range.value}`}
              aria-current={Number(range.value) === days ? 'page' : undefined}
              className={
                Number(range.value) === days
                  ? 'rounded-[var(--radius-md)] bg-accent px-2.5 py-1 text-xs font-semibold text-cream'
                  : 'rounded-[var(--radius-md)] px-2.5 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink'
              }
            >
              {range.label}
            </Link>
          ))}
        </nav>
      </div>

      <section aria-label="Totals" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Sent" value={totals.sent} />
        <Stat label="Delivered" value={totals.delivered} />
        <Stat label="Replies" value={totals.replied} />
        <Stat
          label="Reply rate"
          value={replyRate}
          hint={replyRate === null ? 'Nothing sent yet' : undefined}
        />
        <Stat
          label="Bounce rate"
          value={bounceRate}
          hint={bounceRate === null ? 'Nothing sent yet' : undefined}
        />
      </section>

      {/*
        ⚠️ QUEUED AND NEEDS-VERIFICATION ARE SURFACED, NOT BURIED. A queue that
        is not draining is the single most useful early warning this screen can
        give — it is what "the campaign launched and nothing happened" looks
        like from the inside.
      */}
      {totals.queued > 0 || totals.needsVerification > 0 ? (
        <section className="clay p-4">
          <h3 className="text-sm font-semibold text-ink">Waiting</h3>
          <p className="mt-1 text-sm text-muted">
            <strong className="text-ink">{totals.queued}</strong> queued and{' '}
            <strong className="text-ink">{totals.needsVerification}</strong> needing
            verification. Queued mail sends on the next scheduled run; anything needing
            verification is waiting on a mailbox problem.
          </p>
        </section>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">By mailbox</h3>

        {rows.length === 0 ? (
          <div className="clay p-8 text-center">
            <p className="text-sm font-medium text-ink">No mailbox activity in this period</p>
            <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
              Numbers appear here once a campaign has sent. Connect a mailbox and launch one
              to start.
            </p>
            <Link
              href="/email"
              className="mt-3 inline-block rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90"
            >
              Go to mailboxes
            </Link>
          </div>
        ) : (
          <div className="clay overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted">
                  <th scope="col" className="px-4 py-3 font-semibold">Mailbox</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Sent</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Replies</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Bounce rate</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Health</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.account_id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-medium text-ink">{row.display_name}</span>
                      <span className="ml-2 text-xs text-muted">{row.from_email}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{row.status}</td>
                    <td className="px-4 py-3 text-ink">{Number(row.sent ?? 0)}</td>
                    <td className="px-4 py-3 text-ink">{Number(row.replied ?? 0)}</td>
                    <td className="px-4 py-3 text-ink">
                      {/* NULL bounce rate means nothing was sent, not a clean record. */}
                      {row.bounce_rate === null
                        ? <span className="text-muted">—</span>
                        : `${(Number(row.bounce_rate) * 100).toFixed(1)}%`}
                    </td>
                    <td className="px-4 py-3 text-ink">{row.health_score ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
