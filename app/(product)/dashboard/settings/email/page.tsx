import type { Metadata } from 'next'

import { EmailSettings } from '@/components/settings/SettingsForms'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { requireUser } from '@/lib/auth/access'

export const metadata: Metadata = { title: 'Email settings | Outlio', robots: { index: false, follow: false } }

export default async function EmailSettingsPage() {
  const ctx = await requireUser()

  return (
    <SettingsShell
      title="Email address"
      description="Where sign-in links, receipts, and extraction notices are sent."
    >
      <div className="max-w-md">
        <EmailSettings email={ctx.email ?? ''} />
      </div>
    </SettingsShell>
  )
}
