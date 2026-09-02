import type { Metadata } from 'next'

import { ConnectMailbox } from '@/components/email/ConnectMailbox'
import { MailboxCard } from '@/components/email/MailboxCard'
import { listEmailAccounts } from '@/lib/email/accounts'
import { getDomainHealth } from '@/lib/email/readiness-runner'
import { SCORE_CAVEAT, SCORE_LABEL } from '@/lib/email/readiness'
import { requireWorkspace } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = {
  title: 'Mailboxes | Outlio',
  robots: { index: false, follow: false },
}

/**
 * Mailboxes.
 *
 * ⚠️ THE DOMAIN ROLLUP LEADS WITH THE WORST MAILBOX, not the average.
 * Reputation is shared: one mailbox at a 12% bounce rate damages every other
 * one on that domain, and an average would hide exactly the one that needs
 * stopping (Ledger D42).
 */
export default async function MailboxesPage() {
  const ctx = await requireWorkspace()
  const canConnect = can({ role: ctx.role, modules: ctx.modules }, 'email.account.connect')

  const [accounts, domains] = await Promise.all([
    listEmailAccounts(ctx.workspace.id),
    getDomainHealth(ctx.workspace.id),
  ])

  // The latest assessment per mailbox, for the explained checks.
  const { data: checks } = await createAdminClient()
    .from('email_readiness_checks')
    .select('account_id, score, state, checks, checked_at')
    .eq('workspace_id', ctx.workspace.id)
    .order('checked_at', { ascending: false })

  /*
   * Only the MOST RECENT assessment per mailbox. The query is ordered newest
   * first, so the first row seen for an account wins — history is kept in the
   * table but a card showing last week's checks would be worse than none.
   */
  type ReadinessCheck = { id: string; label: string; status: string; detail: string }
  const latestByAccount = new Map<string, ReadinessCheck[]>()

  for (const row of checks ?? []) {
    if (latestByAccount.has(row.account_id)) continue
    latestByAccount.set(row.account_id, Array.isArray(row.checks) ? (row.checks as ReadinessCheck[]) : [])
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">Mailboxes</h2>
          <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-muted">
            {SCORE_LABEL} is shown per mailbox. {SCORE_CAVEAT}
          </p>
        </div>
        {canConnect ? <ConnectMailbox /> : null}
      </div>

      {accounts.length === 0 ? (
        <div className="clay p-8 text-center">
          <h3 className="text-sm font-semibold text-ink">No mailboxes yet</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
            Connect one to start sending. Outlio sends from your own mailbox rather than a shared
            pool, so your domain builds its own reputation — and nothing goes out until the
            mailbox passes its checks.
          </p>
          {!canConnect ? (
            <p className="mt-3 text-xs text-muted">
              Ask an admin in your workspace to connect one.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          {domains.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-ink">Domains</h3>
              <div className="clay overflow-x-auto p-0">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted">
                      <th scope="col" className="px-4 py-3 font-semibold">Domain</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Mailboxes</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Worst</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Average</th>
                    </tr>
                  </thead>
                  <tbody>
                    {domains.map((domain) => (
                      <tr key={domain.domain} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-3 font-semibold text-ink">{domain.domain}</td>
                        <td className="px-4 py-3 text-muted">
                          {domain.mailboxes}
                          {domain.blocked > 0 ? (
                            <span className="ml-2 rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger">
                              {domain.blocked} blocked
                            </span>
                          ) : null}
                        </td>
                        {/*
                          The worst score is the headline, because it is the one
                          that damages every other mailbox on the domain.
                        */}
                        <td className="px-4 py-3 font-semibold text-ink">{domain.worstScore}</td>
                        <td className="px-4 py-3 text-muted">{domain.averageScore}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted">
                The worst mailbox is shown alongside the average because reputation is shared —
                one bad mailbox affects every other one on the same domain.
              </p>
            </section>
          ) : null}

          <section className="space-y-3">
            {accounts.map((account) => (
              <MailboxCard
                key={account.id}
                account={{
                  id: account.id,
                  displayName: account.displayName,
                  fromEmail: account.fromEmail,
                  fromDomain: account.fromDomain,
                  status: account.status,
                  healthScore: account.healthScore,
                  provider: account.provider,
                  repliesSupported: account.capabilities.replies === 'supported',
                  repliesReason:
                    account.capabilities.replies === 'supported'
                      ? null
                      : 'Add IMAP settings so Outlio can see replies.',
                  lastSendAt: account.lastSendAt,
                }}
                checks={latestByAccount.get(account.id) ?? []}
                canManage={can({ role: ctx.role, modules: ctx.modules }, 'email.account.manage')}
                /*
                  ⚠️ R13. Every one of these has been ENFORCED on each enqueue
                  since M5 and editable by nobody — so a customer in Karachi
                  sent on London hours, and a warmed-up domain stayed capped at
                  its starting allowance forever.
                */
                schedule={
                  can({ role: ctx.role, modules: ctx.modules }, 'email.account.manage')
                    ? {
                        id: account.id,
                        displayName: account.displayName,
                        timezone: account.timezone,
                        sendWindowStart: account.sendWindowStart,
                        sendWindowEnd: account.sendWindowEnd,
                        sendDays: account.sendDays,
                        dailySendLimit: account.dailySendLimit,
                        minDelaySeconds: account.minDelaySeconds,
                        rampEnabled: account.rampEnabled,
                      }
                    : null
                }
              />
            ))}
          </section>
        </>
      )}
    </div>
  )
}
