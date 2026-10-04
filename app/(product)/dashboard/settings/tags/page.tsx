import type { Metadata } from 'next'

import { SettingsShell } from '@/components/settings/SettingsShell'
import { TagSettings } from '@/components/settings/TagSettings'
import { accountAccessIfPermitted } from '@/lib/crm/account-access'
import { listTagGroups } from '@/lib/crm/tag-groups'

export const metadata: Metadata = {
  title: 'Tags | Outlio',
  robots: { index: false, follow: false },
}

/**
 * Settings → Tags: the workspace's own tag groups for accounts and leads
 * (0153). Nothing is preset — each workspace decides what it sorts by.
 *
 * ⚠️ HIDING THE CONTROLS IS NOT THE CHECK. Every action asserts
 * `config.manage` itself (lib/crm/tag-group-actions.ts, lib/crm/tag-groups.ts);
 * this page only avoids offering what would be refused.
 */
export default async function TagSettingsPage() {
  const access = await accountAccessIfPermitted()

  if (!access || !access.can('config.manage')) {
    return (
      <SettingsShell title="Tags" description="The groups your workspace uses to sort accounts and leads.">
        <div className="clay p-8 text-center">
          <p className="text-sm font-medium text-ink">Tags are managed by your workspace’s admins.</p>
          <p className="mt-1 text-sm text-muted">You can still apply them to the accounts and leads you work on.</p>
        </div>
      </SettingsShell>
    )
  }

  const workspaceId = access.ctx.workspace.id
  const [accountGroups, leadGroups] = await Promise.all([
    listTagGroups(workspaceId, 'company'),
    listTagGroups(workspaceId, 'contact'),
  ])

  return (
    <SettingsShell
      title="Tags"
      description="Create the groups your team sorts by. Renaming a value relabels it everywhere at once; disabling hides it from lists and pickers but keeps it on every account that has it."
    >
      <TagSettings accountGroups={accountGroups} leadGroups={leadGroups} />
    </SettingsShell>
  )
}
