import type { Metadata } from 'next'

import { ClaySettings } from '@/components/integrations/ClaySettings'
import { GhlSettings } from '@/components/integrations/GhlSettings'
import { GoogleSettings } from '@/components/integrations/GoogleSettings'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { requireUser } from '@/lib/auth/access'
import { getClayConnectionMetadata } from '@/lib/integrations/repository'
import { getGhlConnectionMetadata } from '@/lib/integrations/ghl-repository'
import { getGoogleConnectionMetadata } from '@/lib/integrations/google-repository'

export const metadata: Metadata = { title: 'Integrations | Outlio', robots: { index: false, follow: false } }

export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>
}) {
  const ctx = await requireUser()
  const params = await searchParams

  // The three lookups still run together, but only when this page is opened.
  const [clayConnection, googleConnection, ghlConnection] = await Promise.all([
    getClayConnectionMetadata(ctx.userId!),
    getGoogleConnectionMetadata(ctx.userId!),
    getGhlConnectionMetadata(ctx.userId!),
  ])

  return (
    <SettingsShell
      title="Integrations"
      description="Connect the tools where you want to send your leads."
    >
      <div className="space-y-4">
        <GoogleSettings
          status={googleConnection?.status ?? null}
          accountLabel={
            googleConnection?.externalAccountEmail ?? googleConnection?.externalAccountName ?? null
          }
          feedback={params.google ?? null}
        />
        <GhlSettings
          status={ghlConnection?.status ?? null}
          accountLabel={ghlConnection?.externalAccountName ?? null}
        />
        <ClaySettings
          status={clayConnection?.status ?? null}
          accountLabel={clayConnection?.externalAccountName ?? null}
        />
      </div>
    </SettingsShell>
  )
}
