import type { Metadata } from 'next'

import { MfaSettings, PasswordSettings } from '@/components/settings/SettingsForms'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { requireUser } from '@/lib/auth/access'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Security settings | Outlio', robots: { index: false, follow: false } }

export default async function SecuritySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ required_mfa?: string }>
}) {
  const ctx = await requireUser()
  const params = await searchParams
  const adminMfaRequired = ctx.isAdmin && params.required_mfa === '1'

  const authClient = await createClient()
  const { data: factors } = await authClient.auth.mfa.listFactors()

  return (
    <SettingsShell
      title="Security"
      description="Use a strong password and require a second factor for new sessions."
    >
      {/*
        The admin MFA gate redirects here with `?required_mfa=1`, so the notice
        belongs on this page rather than on the settings index it used to sit on.
      */}
      {adminMfaRequired ? (
        <div
          role="alert"
          className="mb-6 rounded-[var(--radius-lg)] border border-accent/25 bg-accent-soft px-4 py-3 text-sm text-ink"
        >
          <p className="font-semibold">Secure your admin account to continue</p>
          <p className="mt-1 text-muted">
            Admin access requires an authenticator app. Set it up below and verify the six-digit
            code to return to User admin.
          </p>
        </div>
      ) : null}

      <div className="space-y-7">
        <MfaSettings initialFactorId={factors?.totp[0]?.id ?? null} returnToAdmin={adminMfaRequired} />
        <div className="border-t border-clay-sunken pt-6">
          <PasswordSettings />
        </div>
      </div>
    </SettingsShell>
  )
}
