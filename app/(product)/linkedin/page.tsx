import type { Metadata } from 'next'

import { ActionInbox } from '@/components/linkedin/ActionInbox'
import { listInbox } from '@/lib/linkedin/tasks'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'

export const metadata: Metadata = {
  title: 'LinkedIn tasks | Outlio',
  robots: { index: false, follow: false },
}

/**
 * The Action Inbox — §4.13.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS IS A LIST OF THINGS FOR A PERSON TO DO IN LINKEDIN THEMSELVES.   ║
 * ║                                                                           ║
 * ║  CLAUDE.md rule 1: Outlio never opens linkedin.com. It prepares the work   ║
 * ║  — who, which account, what to say — and the human performs it and comes   ║
 * ║  back to record what happened. Every verb on this screen is about Outlio's ║
 * ║  own records.                                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export default async function LinkedInInboxPage() {
  const ctx = await workspaceContextIfPermitted('crm.contact.view')
  // The layout renders the reason; this only stops the page computing.
  if (!ctx) return null

  /*
   * ⚠️ THE MODULE GATE IS CHECKED HERE AND AGAIN IN EVERY ACTION. Hiding a
   * screen is not access control (CLAUDE.md rule 8) — this only keeps a page
   * nobody can use off the nav.
   */
  if (!ctx.modules.has('linkedin')) {
    return (
      <div className="clay p-6">
        <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">LinkedIn tasks</h2>
        <p className="mt-1 text-sm text-muted">
          The LinkedIn channel is not enabled on your plan.
        </p>
      </div>
    )
  }

  const tasks = await listInbox(ctx.workspace.id)

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">LinkedIn tasks</h2>
        <p className="mt-0.5 text-xs text-muted">
          Outlio prepares each one. You perform it in LinkedIn and record what happened.
        </p>
      </div>

      <ActionInbox tasks={tasks} />
    </div>
  )
}
