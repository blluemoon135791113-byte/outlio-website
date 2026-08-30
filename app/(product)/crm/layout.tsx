import type { ReactNode } from 'react'

import { CrmNav } from '@/components/crm/CrmNav'
import { getWorkspaceContext } from '@/lib/workspaces/context'
import { decidePermission } from '@/lib/workspaces/permissions'

/**
 * The CRM surface.
 *
 * ⚠️ THIS IS THE ACCESS BOUNDARY, not the hidden nav item. A workspace whose
 * plan does not include CRM is refused here even if it types the URL —
 * `decidePermission` checks the module before the role, so the message is
 * accurate rather than a misleading "you lack permission" (CLAUDE.md rule 8,
 * Ledger D11).
 *
 * Both refusal states are rendered rather than redirected: bouncing someone to
 * /dashboard with no explanation is how support tickets are made.
 */
export default async function CrmLayout({ children }: { children: ReactNode }) {
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
    'crm.contact.view',
  )

  if (!decision.allowed) {
    return decision.reason === 'module_unavailable' ? (
      <EmptyState
        title="CRM is not included in your plan"
        body="Your plan does not include the CRM module yet. Once it is enabled, your contacts, companies and pipeline appear here."
      />
    ) : (
      <EmptyState
        title="You do not have access to the CRM"
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
        <h1 className="mt-1.5 text-[30px] font-semibold tracking-[-0.035em] text-ink">CRM</h1>
      </header>

      <CrmNav />

      {children}
    </div>
  )
}

/** Designed refusal states — never a blank screen (CLAUDE.md design rules). */
function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <section className="clay mx-auto max-w-lg p-8 text-center">
      <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </section>
  )
}
