import type { Metadata } from 'next'

import { CHROME_EXTENSION_URL } from '@/app/lib/constants'
import { ExtensionSettings } from '@/components/extension/ExtensionSettings'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { requireUser } from '@/lib/auth/access'
import { listDevices } from '@/lib/extension/devices'

export const metadata: Metadata = { title: 'Extension settings | Outlio', robots: { index: false, follow: false } }

export default async function ExtensionSettingsPage() {
  const ctx = await requireUser()
  const devices = await listDevices(ctx.userId!)

  // Chrome is published, so its URL is a constant. Firefox and Safari stay null
  // until they have listings — the UI shows "coming soon" rather than sending
  // anyone to a 404 on a store we have not shipped to.
  const stores = {
    chrome: process.env.NEXT_PUBLIC_EXT_STORE_CHROME ?? CHROME_EXTENSION_URL,
    firefox: process.env.NEXT_PUBLIC_EXT_STORE_FIREFOX ?? null,
    safari: process.env.NEXT_PUBLIC_EXT_STORE_SAFARI ?? null,
  }

  return (
    <SettingsShell
      title="Browser extension"
      description="Capture leads while you browse, and manage connected browsers."
    >
      <ExtensionSettings devices={devices} stores={stores} />
    </SettingsShell>
  )
}
