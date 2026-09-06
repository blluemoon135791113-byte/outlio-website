import type { ReactNode } from 'react'

import { EmailNav } from '@/components/email/EmailNav'
import { getWorkspaceContext } from '@/lib/workspaces/context'
import { decidePermission } from '@/lib/workspaces/permissions'

/**
 * The Email surface.
 *
 * ⚠️ THE ACCESS BOUNDARY, not the hidden nav item — same shape as the CRM
 * layout. `decidePermission` checks the MODULE before the role, so a workspace
 * whose plan excludes email gets an accurate message rather than a misleading
 * "you lack permission" (CLAUDE.md rule 8, Ledger D11).
 */
export default async function EmailLayout({ children }: { children: ReactNode }) {
  const ctx = await getWorkspaceContext()

  if (!ctx) {
    return (
      <EmptyState
        title="No workspace"
        body="Your account is not attached to a workspace yet. Contact support and we will sort it out."
      />
    )
  }

  const decision = decidePermission(
    { role: ctx.role, modules: ctx.modules },
    'email.campaign.view',
  )

  if (!decision.allowed) {
    return decision.reason === 'module_unavailable' ? (
      <EmptyState
        title="Email is not included in your plan"
        body="Your plan does not include the email module yet. Once it is enabled, your mailboxes and campaigns appear here."
      />
    ) : (
      <EmptyState
        title="You do not have access to email"
        body="Ask an admin in your workspace to give you access."
      />
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          {ctx.workspace.name}
        </p>
        <h1 className="mt-1.5 text-[30px] font-semibold tracking-[-0.035em] text-ink">Email</h1>
      </header>

      <EmailNav />

      {children}
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="clay mx-auto max-w-lg p-8 text-center">
      <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  )
}
