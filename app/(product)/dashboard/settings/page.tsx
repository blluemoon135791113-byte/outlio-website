import type { Metadata } from 'next'
import Link from 'next/link'

import { ExtensionSettings } from '@/components/extension/ExtensionSettings'
import { ClaySettings } from '@/components/integrations/ClaySettings'
import { GoogleSettings } from '@/components/integrations/GoogleSettings'
import { GhlSettings } from '@/components/integrations/GhlSettings'
import { AvatarSettings, DeleteAccountSettings, EmailSettings, MfaSettings, PasswordSettings, ProfileSettings, SubscriptionSettings } from '@/components/settings/SettingsForms'
import { CHROME_EXTENSION_URL } from '@/app/lib/constants'
import { requireUser } from '@/lib/auth/access'
import { listDevices } from '@/lib/extension/devices'
import { signedAvatarUrl } from '@/lib/profile/avatar'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getClayConnectionMetadata } from '@/lib/integrations/repository'
import { getGoogleConnectionMetadata } from '@/lib/integrations/google-repository'
import { getGhlConnectionMetadata } from '@/lib/integrations/ghl-repository'

export const metadata: Metadata = { title: 'Settings | Outlio', robots: { index: false, follow: false } }

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ required_mfa?: string; google?: string }>
}) {
  const ctx = await requireUser()
  const params = await searchParams
  const adminMfaRequired = ctx.isAdmin && params.required_mfa === '1'
  const avatarUrl = await signedAvatarUrl(ctx.userId!, ctx.profile?.avatar_path)
  const { data: factors } = await (await createClient()).auth.mfa.listFactors()
  const initialFactorId = factors?.totp[0]?.id ?? null
  const { data: subscription } = await createAdminClient()
    .from('subscriptions')
    .select('status, provider, current_period_end, cancel_at')
    .eq('user_id', ctx.userId!)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const initials = (ctx.profile?.full_name ?? ctx.email ?? 'O').split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
  const [devices, clayConnection, googleConnection, ghlConnection] = await Promise.all([
    listDevices(ctx.userId!),
    getClayConnectionMetadata(ctx.userId!),
    getGoogleConnectionMetadata(ctx.userId!),
    getGhlConnectionMetadata(ctx.userId!),
  ])
  // Chrome is published, so its URL is a constant. Firefox and Safari stay
  // null until they have listings — the UI shows "coming soon" rather than a
  // dead link, so nobody is sent to a 404 on a store we have not shipped to.
  const stores = {
    chrome: process.env.NEXT_PUBLIC_EXT_STORE_CHROME ?? CHROME_EXTENSION_URL,
    firefox: process.env.NEXT_PUBLIC_EXT_STORE_FIREFOX ?? null,
    safari: process.env.NEXT_PUBLIC_EXT_STORE_SAFARI ?? null,
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Account</p>
        <h1 className="mt-1.5 text-[30px] font-semibold tracking-[-0.035em] text-ink">Settings</h1>
        <p className="mt-1 text-sm text-muted">Manage your profile, security, subscription, and billing.</p>
      </header>

      {adminMfaRequired ? (
        <div role="alert" className="rounded-[var(--radius-lg)] border border-accent/25 bg-accent-soft px-4 py-3 text-sm text-ink">
          <p className="font-semibold">Secure your admin account to continue</p>
          <p className="mt-1 text-muted">Admin access requires an authenticator app. Set it up below, verify the six-digit code, and you will return to User admin automatically.</p>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="h-fit rounded-[var(--radius-xl)] border border-border bg-panel p-2 shadow-[var(--shadow-sm)] lg:sticky lg:top-24">
          {['Profile', 'Email address', 'Security', 'Subscription and billing', 'Integrations', 'Browser extension', 'Delete account'].map((label) => (
            <a key={label} href={`#${label.toLowerCase().replaceAll(' ', '-')}`} className="flex h-10 items-center rounded-lg px-3 text-sm font-medium text-muted hover:bg-accent-soft/60 hover:text-accent">{label}</a>
          ))}
        </aside>

        <div className="space-y-5">
          <SettingsSection id="profile" title="Profile" description="Update how your account appears across Outlio.">
            <div className="grid gap-6 xl:grid-cols-2"><ProfileSettings fullName={ctx.profile?.full_name ?? ''} /><AvatarSettings avatarUrl={avatarUrl} initials={initials} /></div>
          </SettingsSection>
          <SettingsSection id="email-address" title="Email address" description="This is where sign-in links, receipts, and extraction notices are sent.">
            <div className="max-w-md"><EmailSettings email={ctx.email ?? ''} /></div>
          </SettingsSection>
          <SettingsSection id="security" title="Security" description="Use a strong password and require a second factor for new sessions.">
            <div className="space-y-7"><MfaSettings initialFactorId={initialFactorId} returnToAdmin={adminMfaRequired} /><div className="border-t border-border pt-6"><PasswordSettings /></div></div>
          </SettingsSection>
          <SettingsSection id="subscription-and-billing" title="Subscription and billing" description="Your plan data is live. Checkout controls will connect here when the billing API is ready.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Info label="Current plan" value={ctx.plan?.name ?? 'No active plan'} />
              <Info label="Subscription status" value={subscription?.status ?? 'Manual access'} />
              <Info label="Billing provider" value={subscription?.provider ?? 'Not connected'} />
              <Info label="Next billing date" value={subscription?.current_period_end ? new Date(subscription.current_period_end).toLocaleDateString('en-GB') : 'Available after checkout setup'} />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/dashboard/access?intent=upgrade" className="inline-flex h-10 items-center rounded-[var(--radius-md)] bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-deep">View upgrade options</Link>
              <button type="button" disabled title="Connect your billing API to enable this" className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-border px-4 text-sm font-semibold text-muted opacity-65">Manage billing</button>
            </div>
            <div className="mt-6 border-t border-border pt-6">
              <SubscriptionSettings
                planName={ctx.plan?.name ?? 'Your plan'}
                cancelAt={subscription?.cancel_at ?? null}
                hasActiveSubscription={subscription?.status === 'active'}
              />
            </div>
          </SettingsSection>
          <SettingsSection id="integrations" title="Integrations" description="Connect the tools where you want to send your leads.">
            <div className="space-y-4">
              <GoogleSettings status={googleConnection?.status ?? null} accountLabel={googleConnection?.externalAccountEmail ?? googleConnection?.externalAccountName ?? null} feedback={params.google ?? null} />
              <GhlSettings status={ghlConnection?.status ?? null} accountLabel={ghlConnection?.externalAccountName ?? null} />
              <ClaySettings status={clayConnection?.status ?? null} accountLabel={clayConnection?.externalAccountName ?? null} />
            </div>
          </SettingsSection>
          <SettingsSection id="browser-extension" title="Browser extension" description="Capture leads directly from your browser, and manage which browsers are connected.">
            <ExtensionSettings devices={devices} stores={stores} />
          </SettingsSection>
          <SettingsSection id="delete-account" title="Delete account" description="Permanently remove your account and personal data from Outlio.">
            <DeleteAccountSettings isAdmin={ctx.isAdmin} />
          </SettingsSection>
        </div>
      </div>
    </div>
  )
}

function SettingsSection({ id, title, description, children }: { id: string; title: string; description: string; children: React.ReactNode }) {
  return <section id={id} className="scroll-mt-24 rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-sm)] sm:p-6"><h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">{title}</h2><p className="mt-1 text-sm text-muted">{description}</p><div className="mt-6">{children}</div></section>
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-app/70 p-4"><p className="text-xs font-medium text-muted">{label}</p><p className="mt-1.5 text-sm font-semibold capitalize text-ink">{value}</p></div>
}
