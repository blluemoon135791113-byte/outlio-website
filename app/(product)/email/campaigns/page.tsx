import type { Metadata } from 'next'
import Link from 'next/link'

import { CreateCampaign } from '@/components/email/CreateCampaign'
import { listEmailAccounts } from '@/lib/email/accounts'
import { policyFor, type CampaignType } from '@/lib/email/campaign-policy'
import { createAdminClient } from '@/lib/supabase/admin'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Campaigns | Outlio',
  robots: { index: false, follow: false },
}

/**
 * Campaigns.
 *
 * ⚠️ A CAMPAIGN CANNOT BE CREATED WITHOUT A MAILBOX, and the empty state says
 * so rather than offering a form that will fail on submit. Sending is the whole
 * point; a campaign with nowhere to send from is a draft nobody can finish.
 */
export default async function CampaignsPage() {
  const ctx = await workspaceContextIfPermitted('email.campaign.view')
  // The layout renders the reason; this only stops the page computing and
  // serialising its result into the RSC payload.
  if (!ctx) return null
  const policy = { role: ctx.role, modules: ctx.modules }
  const canCreate = can(policy, 'email.campaign.create')

  const db = createAdminClient()

  const [accounts, { data: campaigns }] = await Promise.all([
    listEmailAccounts(ctx.workspace.id),
    db
      .from('email_campaigns')
      .select('id, name, type, status, created_at, account_id')
      .eq('workspace_id', ctx.workspace.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
  ])

  // Enrolment counts, so a draft with nobody in it is visible before launch.
  const counts = new Map<string, number>()
  for (const campaign of campaigns ?? []) {
    const { count } = await db
      .from('email_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id)
      .in('status', ['active', 'paused'])
    counts.set(campaign.id, count ?? 0)
  }

  const sendable = accounts.filter((a) => a.status !== 'disconnected')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">Campaigns</h2>
          <p className="mt-0.5 text-xs text-muted">
            Sequences stop when someone replies. Broadcasts do not.
          </p>
        </div>
        {canCreate && sendable.length > 0 ? (
          <CreateCampaign
            accounts={sendable.map((a) => ({
              id: a.id,
              label: `${a.displayName} — ${a.fromEmail}`,
            }))}
          />
        ) : null}
      </div>

      {sendable.length === 0 ? (
        <div className="clay p-8 text-center">
          <h3 className="text-sm font-semibold text-ink">Connect a mailbox first</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
            A campaign needs somewhere to send from. Connect a mailbox and it will appear here as
            an option.
          </p>
          <Link
            href="/email"
            className="mt-4 inline-block rounded-[var(--radius-md)] bg-accent px-4 py-2 text-sm font-semibold text-cream transition-colors duration-150 hover:opacity-90"
          >
            Go to mailboxes
          </Link>
        </div>
      ) : (campaigns ?? []).length === 0 ? (
        <div className="clay p-8 text-center">
          <h3 className="text-sm font-semibold text-ink">No campaigns yet</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
            A sales sequence sends several steps and stops the moment someone replies. A broadcast
            sends one message and keeps going — a reply to a newsletter is a conversation, not an
            objection.
          </p>
        </div>
      ) : (
        <div className="clay overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted">
                <th scope="col" className="px-4 py-3 font-semibold">Campaign</th>
                <th scope="col" className="px-4 py-3 font-semibold">Type</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                <th scope="col" className="px-4 py-3 font-semibold">Recipients</th>
              </tr>
            </thead>
            <tbody>
              {(campaigns ?? []).map((campaign) => (
                <tr key={campaign.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/email/campaigns/${campaign.id}`}
                      className="font-semibold text-ink underline-offset-2 hover:underline"
                    >
                      {campaign.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {TYPE_LABEL[campaign.type as CampaignType]}
                    {/*
                      The defining difference is stated inline, because choosing
                      the wrong type is not obvious until mail has gone out.
                    */}
                    <span className="block text-xs text-muted">
                      {policyFor(campaign.type as CampaignType).stopsOnReply
                        ? 'stops on reply'
                        : 'does not stop on reply'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={campaign.status} />
                  </td>
                  <td className="px-4 py-3 text-muted">{counts.get(campaign.id) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const TYPE_LABEL: Record<CampaignType, string> = {
  sales_sequence: 'Sales sequence',
  marketing_broadcast: 'Broadcast',
  flow_driven: 'Flow-driven',
  manual: 'Manual',
}

function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    draft: 'bg-surface-muted text-muted',
    running: 'bg-success-soft text-success',
    paused: 'bg-warning-soft text-warning',
    stopped: 'bg-danger-soft text-danger',
    completed: 'bg-accent-soft text-accent',
    scheduled: 'bg-accent-soft text-accent',
  }

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        tone[status] ?? 'bg-surface-muted text-muted'
      }`}
    >
      {status}
    </span>
  )
}
