import type { Metadata } from 'next'
import Link from 'next/link'

import { AvatarSettings, MfaSettings, PasswordSettings, ProfileSettings } from '@/components/settings/SettingsForms'
import { requireUser } from '@/lib/auth/access'
import { signedAvatarUrl } from '@/lib/profile/avatar'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Settings | Outlio', robots: { index: false, follow: false } }

export default async function SettingsPage() {
  const ctx = await requireUser()
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

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Account</p>
        <h1 className="mt-1.5 text-[30px] font-semibold tracking-[-0.035em] text-ink">Settings</h1>
        <p className="mt-1 text-sm text-muted">Manage your profile, security, subscription, and billing.</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="h-fit rounded-[var(--radius-xl)] border border-border bg-panel p-2 shadow-[var(--shadow-sm)] lg:sticky lg:top-24">
          {['Profile', 'Security', 'Subscription and billing'].map((label) => (
            <a key={label} href={`#${label.toLowerCase().replaceAll(' ', '-')}`} className="flex h-10 items-center rounded-lg px-3 text-sm font-medium text-muted hover:bg-accent-soft/60 hover:text-accent">{label}</a>
          ))}
        </aside>

        <div className="space-y-5">
          <SettingsSection id="profile" title="Profile" description="Update how your account appears across Outlio.">
            <div className="grid gap-6 xl:grid-cols-2"><ProfileSettings fullName={ctx.profile?.full_name ?? ''} /><AvatarSettings avatarUrl={avatarUrl} initials={initials} /></div>
          </SettingsSection>
          <SettingsSection id="security" title="Security" description="Use a strong password and require a second factor for new sessions.">
            <div className="space-y-7"><MfaSettings initialFactorId={initialFactorId} /><div className="border-t border-border pt-6"><PasswordSettings /></div></div>
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
