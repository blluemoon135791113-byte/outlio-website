import type { Metadata } from 'next'

import { ActionInbox } from '@/components/linkedin/ActionInbox'
import { BulkEnroll } from '@/components/linkedin/BulkEnroll'
import { loadAudienceCatalogue } from '@/lib/crm/audience-catalogue'
import { listWorkspaceSenders } from '@/lib/linkedin/senders'
import { listInbox } from '@/lib/linkedin/tasks'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'
import { can, dataScope } from '@/lib/workspaces/permissions'

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

  /*
   * ⚠️ THE BULK PANEL IS GATED ON `crm.contact.edit`, which is what
   * `bulkEnrollContactsAction` itself enforces — not on the view permission
   * that gates this page. Offering it more widely renders a form that always
   * refuses.
   */
  const canEnrol = can({ role: ctx.role, modules: ctx.modules }, 'crm.contact.edit')

  const [tasks, senders, catalogue] = await Promise.all([
    listInbox(ctx.workspace.id),
    canEnrol
      ? listWorkspaceSenders(ctx.workspace.id).then((rows) =>
          rows.map((sender) => ({ id: sender.senderId, label: sender.displayLabel })),
        )
      : Promise.resolve([]),
    canEnrol
      ? loadAudienceCatalogue(ctx.workspace.id, {
          // A setter enrols their own records only.
          ownerUserId: dataScope(ctx.role) === 'assigned' ? ctx.userId : null,
        })
      : Promise.resolve({ lists: [], stages: [], pipelines: [], batches: [] }),
  ])

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">LinkedIn tasks</h2>
        <p className="mt-0.5 text-xs text-muted">
          Outlio prepares each one. You perform it in LinkedIn and record what happened.
        </p>
      </div>

      {/*
        ⚠️ THE ONLY BULK ENTRANCE THE CHANNEL HAS. `enrollContactAction` takes
        one contact and lives on that contact's detail page, so a sequence of
        two hundred people meant opening two hundred pages.
      */}
      {canEnrol ? <BulkEnroll catalogue={catalogue} senders={senders} /> : null}

      <ActionInbox tasks={tasks} />
    </div>
  )
}
