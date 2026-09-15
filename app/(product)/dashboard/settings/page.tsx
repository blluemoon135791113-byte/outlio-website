import type { Metadata } from 'next'

import { AvailabilitySettings } from '@/components/settings/AvailabilitySettings'
import { AvatarSettings, ProfileSettings } from '@/components/settings/SettingsForms'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { requireUser } from '@/lib/auth/access'
import { snoozeBounds } from '@/lib/crm/my-work'
import { getMyAvailability } from '@/lib/crm/routing-rules'
import { signedAvatarUrl } from '@/lib/profile/avatar'
import { getWorkspaceContext } from '@/lib/workspaces/context'

export const metadata: Metadata = { title: 'Profile settings | Outlio', robots: { index: false, follow: false } }

export default async function ProfileSettingsPage() {
  const ctx = await requireUser()
  /*
   * Only the avatar and your own availability are fetched here. The single-page
   * version ran seven loads — MFA factors, subscription, devices and three
   * integration lookups — to render a display-name field.
   *
   * Availability is per workspace, so it is shown for the workspace you are in,
   * and not at all if you belong to none.
   */
  const [avatarUrl, workspace] = await Promise.all([
    signedAvatarUrl(ctx.userId!, ctx.profile?.avatar_path),
    getWorkspaceContext(),
  ])
  const now = new Date()
  const availability = workspace ? await getMyAvailability(workspace.workspace.id, workspace.userId, now) : null
  const { minSnoozeDate: minAwayDate } = snoozeBounds(now)

  const initials = (ctx.profile?.full_name ?? ctx.email ?? 'O')
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <SettingsShell title="Profile" description="Update how your account appears across Outlio.">
      <div className="grid gap-6 xl:grid-cols-2">
        <ProfileSettings fullName={ctx.profile?.full_name ?? ''} />
        <AvatarSettings avatarUrl={avatarUrl} initials={initials} />
        {workspace && availability ? (
          <AvailabilitySettings
            workspaceName={workspace.workspace.name}
            awayUntil={availability.awayUntil}
            minAwayDate={minAwayDate}
          />
        ) : null}
      </div>
    </SettingsShell>
  )
}
