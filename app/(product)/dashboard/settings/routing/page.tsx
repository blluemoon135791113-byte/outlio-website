import type { Metadata } from 'next'

import { RoutingSettings } from '@/components/settings/RoutingSettings'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { snoozeBounds } from '@/lib/crm/my-work'
import { listAvailability, listRules, listUnassignedQueue } from '@/lib/crm/routing-rules'
import { requireWorkspace } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Lead routing | Outlio',
  robots: { index: false, follow: false },
}

/**
 * Lead routing — the rules that place imported and extracted leads, who is
 * available to receive them, and what could not be placed.
 *
 * ⚠️ MANAGERS SEE IT; ADMINS CHANGE IT. A manager assigns leads by hand and
 * needs to know why one is waiting (`crm.contact.assign`). Changing the rules
 * changes who receives every future lead in the workspace, which is
 * configuration (`crm.routing.manage`). Hiding the controls is not the check —
 * every action asserts the permission itself.
 */
export default async function RoutingSettingsPage() {
  const ctx = await requireWorkspace()
  const policy = { role: ctx.role, modules: ctx.modules }
  const canView = can(policy, 'crm.contact.assign')
  const canManage = can(policy, 'crm.routing.manage')

  if (!canView) {
    return (
      <SettingsShell
        title="Lead routing"
        description="How imported and extracted leads are given an owner."
      >
        <div className="clay p-8 text-center">
          <p className="text-sm font-medium text-ink">Lead routing is managed by your workspace’s managers and admins.</p>
          <p className="mt-1 text-sm text-muted">
            Leads routed to you appear in your contacts and in My Work.
          </p>
        </div>
      </SettingsShell>
    )
  }

  const [rules, people, queue] = await Promise.all([
    listRules(ctx.workspace.id),
    listAvailability(ctx.workspace.id),
    listUnassignedQueue(ctx.workspace.id),
  ])

  // Bounds for the "away until" picker, computed with the render's instant.
  const { minSnoozeDate: minAwayDate } = snoozeBounds(new Date())

  return (
    <SettingsShell
      title="Lead routing"
      description="Leads from CSV imports and the Lead Engine are given an owner by the first live rule that has someone available. Contacts added by hand always stay with whoever added them."
    >
      <RoutingSettings
        rules={rules}
        people={people}
        queue={queue}
        canManage={canManage}
        minAwayDate={minAwayDate}
      />
    </SettingsShell>
  )
}
