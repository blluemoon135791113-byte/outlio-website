import type { Metadata } from 'next'

import { AvatarSettings, ProfileSettings } from '@/components/settings/SettingsForms'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { requireUser } from '@/lib/auth/access'
import { signedAvatarUrl } from '@/lib/profile/avatar'

export const metadata: Metadata = { title: 'Profile settings | Outlio', robots: { index: false, follow: false } }

export default async function ProfileSettingsPage() {
  const ctx = await requireUser()
  /*
   * Only the avatar is fetched here. The single-page version ran seven loads —
   * MFA factors, subscription, devices and three integration lookups — to
   * render a display-name field.
   */
  const avatarUrl = await signedAvatarUrl(ctx.userId!, ctx.profile?.avatar_path)
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
      </div>
    </SettingsShell>
  )
}
