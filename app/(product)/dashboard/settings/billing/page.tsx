import type { Metadata } from 'next'
import Link from 'next/link'

import { SubscriptionSettings } from '@/components/settings/SettingsForms'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { requireUser } from '@/lib/auth/access'
import { openPaddleCustomerPortal } from '@/lib/paddle/portal'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = { title: 'Billing settings | Outlio', robots: { index: false, follow: false } }

export default async function BillingSettingsPage() {
  const ctx = await requireUser()
  const admin = createAdminClient()

  // Service role bypasses RLS, so scoping by user_id is mandatory.
  const { data: subscription } = await admin
    .from('subscriptions')
    .select('status, provider, provider_ref, current_period_end, cancel_at')
    .eq('user_id', ctx.userId!)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (
    <SettingsShell
      title="Subscription and billing"
      description="Review your plan or open Paddle's secure billing portal."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Info label="Current plan" value={ctx.plan?.name ?? 'No active plan'} />
        <Info label="Subscription status" value={subscription?.status ?? 'Manual access'} />
        <Info label="Billing provider" value={subscription?.provider ?? 'Not connected'} />
        <Info
          label="Next billing date"
          value={
            subscription?.current_period_end
              ? new Date(subscription.current_period_end).toLocaleDateString('en-GB')
              : 'Available after checkout setup'
          }
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href="/leadengine/pricing"
          className="inline-flex h-10 items-center rounded-[var(--radius-md)] bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-deep"
        >
          View plans
        </Link>
        {subscription?.provider === 'paddle' && subscription.provider_ref ? (
          <form action={openPaddleCustomerPortal}>
            <button
              type="submit"
              className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-border px-4 text-sm font-semibold text-ink hover:border-accent/40"
            >
              Manage billing
            </button>
          </form>
        ) : null}
      </div>

      {subscription?.provider === 'paddle' ? (
        <p className="mt-6 border-t border-clay-sunken pt-6 text-sm leading-6 text-muted">
          Paddle handles payment methods, invoices, and cancellations. A scheduled cancellation
          does not remove access before your current paid period ends.
        </p>
      ) : (
        <div className="mt-6 border-t border-clay-sunken pt-6">
          <SubscriptionSettings
            planName={ctx.plan?.name ?? 'Your plan'}
            cancelAt={subscription?.cancel_at ?? null}
            hasActiveSubscription={subscription?.status === 'active'}
          />
        </div>
      )}
    </SettingsShell>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="skeuo-inset p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1.5 text-sm font-semibold capitalize text-ink">{value}</p>
    </div>
  )
}
