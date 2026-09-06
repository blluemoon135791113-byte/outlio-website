import type { Metadata } from 'next'

import { DeleteAccountSettings } from '@/components/settings/SettingsForms'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { requireUser } from '@/lib/auth/access'

export const metadata: Metadata = { title: 'Delete account | Outlio', robots: { index: false, follow: false } }

export default async function DeleteAccountPage() {
  const ctx = await requireUser()

  return (
    <SettingsShell
      title="Delete account"
      description="Permanently remove your account and personal data from Outlio."
    >
      <DeleteAccountSettings isAdmin={ctx.isAdmin} />
    </SettingsShell>
  )
}
