import type { ReactNode } from 'react'

import { getWorkspaceContext } from '@/lib/workspaces/context'
import { decidePermission } from '@/lib/workspaces/permissions'

/**
 * The LinkedIn surface.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS LAYOUT DID NOT EXIST, AND `page.tsx` ALREADY ASSUMED IT DID.     ║
 * ║                                                                           ║
 * ║  Its comment reads "The layout renders the reason; this only stops the     ║
 * ║  page computing" — copied from `/crm/reports`, where `crm/layout.tsx`      ║
 * ║  genuinely does. Twenty-two pages use that sentence. Every other one sits  ║
 * ║  under `crm/`, `email/`, `flows/` or `dashboard/settings/`, all of which   ║
 * ║  have a layout. LinkedIn was the only section without one.                ║
 * ║                                                                           ║
 * ║  So `if (!ctx) return null` fell through to NOTHING: a member without      ║
 * ║  `crm.contact.view` got the shell with an empty middle and no explanation. ║
 * ║  "Bouncing someone to /dashboard with no explanation is how support        ║
 * ║  tickets are made" — an empty panel is worse, because it looks broken.     ║
 * ║                                                                           ║
 * ║  ⚠️ IT ALSO CARRIED NO `<h1>`. Found by measuring the rendered page on a   ║
 * ║  phone: every other product section reported one and `/linkedin` reported  ║
 * ║  zero, because the heading comes from these layouts and this section had   ║
 * ║  none. Its document outline began at `<h2>`.                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ GATED ON `crm.contact.view`, THE SAME PERMISSION THE PAGE ASKS FOR.
 * `linkedin` is a MODULE with no permission of its own, so inventing a
 * `linkedin.view` here would put the layout and the page on two different
 * questions — and the page's answer is the one the server actions already
 * enforce.
 *
 * ⚠️ THE MODULE MESSAGE STAYS IN THE PAGE. It already renders a specific one
 * naming what LinkedIn does, and `decidePermission` checks the module first, so
 * the `module_unavailable` branch below is what a workspace without the module
 * sees — not a second copy of the page's sentence.
 */
export default async function LinkedInLayout({ children }: { children: ReactNode }) {
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
        title="LinkedIn is not included in your plan"
        body="Your plan does not include the LinkedIn channel yet. Once it is enabled, the actions waiting for you appear here."
      />
    ) : (
      <EmptyState
        title="You do not have access to LinkedIn tasks"
        body="Ask an admin in your workspace to give you access."
      />
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[30px] font-semibold tracking-[-0.035em] text-ink">LinkedIn</h1>
      </header>
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
