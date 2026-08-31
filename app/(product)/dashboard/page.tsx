import type { Metadata } from 'next'
import Link from 'next/link'

import { ExtensionCard } from '@/components/extension/ExtensionCard'
import { FirstRun } from '@/components/onboarding/FirstRun'
import { LiveCapture } from '@/components/extension/LiveCapture'
import { CreditsSummary } from '@/components/product/CreditsSummary'
import { ReferralCard } from '@/components/product/ReferralCard'
import { requireAccess } from '@/lib/auth/access'
import { getActiveSession } from '@/lib/extension/capture'
import { countDevices } from '@/lib/extension/devices'
import { appOrigin } from '@/lib/auth/redirects'
import { loadFirstRun, shouldShowFirstRun } from '@/lib/onboarding/steps'
import { referralLink } from '@/lib/referrals/constants'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveUploadLimits } from '@/lib/upload/limits'
import { getWorkspaceContext } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Dashboard | Outlio',
  robots: { index: false, follow: false },
}

export default async function DashboardPage() {
  const ctx = await requireAccess()
  const admin = createAdminClient()

  // Rendered server-side so the widget is correct on first paint; Realtime
  // takes over from there.
  const [
    activeCapture,
    connectedDevices,
    { data: balanceRows },
    { data: referralRows },
    { data: subscription },
  ] = await Promise.all([
    getActiveSession(ctx.userId!),
    countDevices(ctx.userId!),
    admin.rpc('credit_balance', { p_user_id: ctx.userId! }),
    admin.rpc('referral_summary', { p_user_id: ctx.userId! }),
    admin
      .from('subscriptions')
      .select('status, provider')
      .eq('user_id', ctx.userId!)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  /*
   * ⚠️ THE CHECKLIST IS LOADED SEPARATELY AND FAILS SOFT. A workspace context
   * that cannot be resolved -- a Lead Engine account with no workspace yet --
   * must not take the whole dashboard down with it. No workspace simply means
   * no checklist.
   */
  const workspace = await getWorkspaceContext()
  const firstRun = workspace
    ? await loadFirstRun(workspace.workspace.id, {
        role: workspace.role,
        modules: workspace.modules,
      })
    : null

  const referral = Array.isArray(referralRows) ? referralRows[0] : null
  const balance = Array.isArray(balanceRows) ? balanceRows[0] : null
  const limits = ctx.plan?.limits
  const uploadLimits = resolveUploadLimits(limits ?? null)
  const usage = ctx.usage
  const upgradeTarget = nextPlan(ctx.plan?.key)

  const metrics = [
    {
      label: 'Credits remaining',
      /*
       * ⚠️ null MEANS "WE DO NOT KNOW", AND 0 MEANS "NONE LEFT".
       *
       * This was `balance?.remaining ?? 0`, so a missing balance row rendered
       * as a hard zero — indistinguishable from an exhausted account. A user
       * who reads 0 concludes they cannot work and stops. Same failure shape
       * as the empty lead list documented in HubbleConsole.
       */
      value: balance?.remaining ?? null,
      limit: balance?.allowance ?? null,
      featured: true,
    },
    {
      label: 'Extractions today',
      value: usage?.extractionsToday ?? 0,
      limit: limits?.extractions_per_day ?? null,
    },
    {
      label: 'Extractions this month',
      value: usage?.extractionsThisMonth ?? 0,
      limit: limits?.extractions_per_month ?? null,
    },
    {
      label: 'Records this month',
      value: usage?.recordsThisMonth ?? 0,
      limit: limits?.records_per_month ?? null,
    },
    {
      label: 'Exports this month',
      value: usage?.exportsThisMonth ?? 0,
      limit: limits?.exports_per_month ?? null,
    },
  ]

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
            Lead Engine
          </p>
          <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-[30px]">
            Overview
          </h1>
          <p className="mt-1 text-sm text-muted">
            Usage this billing period.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/intelligence"
            className="inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-4 text-sm font-semibold text-ink transition-[border-color,background-color,transform] duration-150 ease-out hover:border-accent/35 hover:bg-accent-soft/40 active:scale-[0.97]"
          >
            Research with Hubble
          </Link>
          <Link
            href="/dashboard/extract/new"
            className="product-gradient inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 text-sm font-semibold text-white transition-[filter,transform] duration-150 ease-out hover:brightness-95 active:scale-[0.97]"
          >
            <span aria-hidden className="text-base leading-none">+</span>
            New extraction
          </Link>
        </div>
      </header>

      {/*
        ⚠️ ABOVE THE USAGE NUMBERS ON PURPOSE, and only until it is finished.
        Someone on their first day has no usage to read; a row of zeroes is a
        worse first screen than a list of what to do next. It disappears on its
        own once every step is done -- see `shouldShowFirstRun`.
      */}
      {firstRun && shouldShowFirstRun(firstRun) && workspace ? (
        <FirstRun
          data={firstRun}
          canDismiss={can(
            { role: workspace.role, modules: workspace.modules },
            'workspace.settings.manage',
          )}
        />
      ) : null}

      <section aria-label="Usage this period" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <UsageCard key={metric.label} {...metric} />
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <div className="space-y-4">
        <section className="relative overflow-hidden rounded-[var(--radius-clay)] bg-charcoal p-6 shadow-[var(--neo-shadow)] sm:p-7">
          <div className="relative z-10 max-w-xl">
            {/* Ivory on charcoal: the logo's own pairing, ~13:1. */}
            <h2 className="text-xl font-semibold tracking-[-0.025em] text-ivory">
              Build your next lead list
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-ivory/75">
              Upload the lead-search pages you already saved. Outlio parses them on
              our servers, removes duplicates, and prepares a clean CSV.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                href="/dashboard/extract/new"
                className="product-gradient inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] px-4 text-sm font-semibold text-white transition-[filter,transform] duration-150 ease-out hover:brightness-95 active:scale-[0.97]"
              >
                Start an extraction
              </Link>
              <Link
                href="/dashboard/jobs"
                className="inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] border border-ivory/35 px-4 text-sm font-semibold text-ivory transition-[border-color,transform] duration-150 ease-out hover:border-ivory active:scale-[0.97]"
              >
                Open workspace
              </Link>
            </div>
          </div>
          <div
            aria-hidden
            className="absolute -bottom-24 -right-20 h-72 w-72 rounded-full border-[42px] border-ivory/[0.06]"
          />
          <div
            aria-hidden
            className="absolute -bottom-10 right-16 h-32 w-32 rounded-full border border-ivory/15"
          />
        </section>
        <ExtensionCard connectedDevices={connectedDevices} />
        </div>

        <div className="space-y-4">
        <section className="rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-sm)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                Account
              </p>
              <h2 className="mt-1.5 text-base font-semibold tracking-[-0.02em] text-ink">
                Current access
              </h2>
            </div>
            <span className="rounded-full border border-accent/15 bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent">
              Active
            </span>
          </div>
          <dl className="mt-5 divide-y divide-border">
            <AccountRow label="Plan" value={ctx.plan?.name ?? 'Current plan'} />
            <AccountRow label="Account" value={ctx.email ?? ''} />
            <AccountRow
              label="Access until"
              value={
                ctx.accessExpiresAt
                  ? new Date(ctx.accessExpiresAt).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })
                  : 'No expiry'
              }
            />
          </dl>
        </section>
        <section className="credits-gradient relative overflow-hidden rounded-[var(--radius-xl)] border border-accent/15 p-5 shadow-[var(--shadow-sm)]">
          <div className="relative z-10">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Subscription</p>
            <div className="mt-2 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.025em] text-ink">{ctx.plan?.name ?? 'Current access'}</h2>
                <p className="mt-1 text-xs capitalize text-muted">{subscription?.status ?? 'Manual access'} · {subscription?.provider ?? 'Billing not connected'}</p>
              </div>
              <span className="rounded-full bg-white/75 px-2.5 py-1 text-[11px] font-semibold text-accent ring-1 ring-accent/10">Active</span>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted">{upgradeTarget ? `Move to ${upgradeTarget} when you need more credits, files, and exports.` : 'Talk to us for a custom plan built around your workflow.'}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/dashboard/access?intent=upgrade" className="product-gradient inline-flex h-9 items-center rounded-[var(--radius-md)] px-3.5 text-xs font-semibold text-white hover:brightness-95">{upgradeTarget ? `Upgrade to ${upgradeTarget}` : 'Request a custom plan'}</Link>
              <Link href="/dashboard/settings/billing" className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-white/80 bg-white/60 px-3.5 text-xs font-semibold text-ink hover:bg-white">Billing details</Link>
            </div>
          </div>
          <div aria-hidden className="absolute -bottom-12 -right-10 h-36 w-36 rounded-full bg-accent/10 blur-2xl" />
        </section>

        <LiveCapture userId={ctx.userId!} initialSession={activeCapture} />

        <CreditsSummary
          leadsPerCredit={uploadLimits.leadsPerCredit}
          maxFiles={uploadLimits.maxFiles}
        />

        {referral?.code ? (
          <ReferralCard
            link={referralLink(appOrigin(), referral.code)}
            rewarded={referral.rewarded}
            creditsEarned={referral.credits_earned}
          />
        ) : null}
        </div>
      </div>
    </div>
  )
}

function UsageCard({
  label,
  value,
  limit,
  featured = false,
}: {
  label: string
  /** `null` is "unknown", which is not the same fact as `0`. */
  value: number | null
  limit: number | null
  featured?: boolean
}) {
  const unknown = value === null
  const percent =
    !unknown && limit && limit > 0 ? Math.min((value / limit) * 100, 100) : null

  return (
    <article
      className={
        featured
          ? 'product-gradient min-h-36 rounded-[var(--radius-clay)] p-4 text-white shadow-[var(--neo-shadow)]'
          : 'clay min-h-36 p-4'
      }
    >
      <div className="flex items-start justify-between gap-2">
        <p className={featured ? 'text-xs font-medium text-white/75' : 'text-xs font-medium text-muted'}>
          {label}
        </p>
        {/*
          ⚠️ REMOVED, NOT RE-STYLED. This was a decorative ↗ in a 24px circle;
          swapping the glyph for the word "Open" overflowed the circle and,
          worse, labelled a control that never existed — the badge is
          `aria-hidden` and the card is not a link. A card that looks clickable
          and is not is a worse defect than a symbol nobody decodes.
        */}
      </div>
      <p className="mt-4 font-heading text-[30px] font-semibold leading-none tracking-[-0.045em] tabular-nums">
        {unknown ? '—' : value.toLocaleString()}
      </p>
      <div className="mt-4">
        <div className={featured ? 'h-1 overflow-hidden rounded-full bg-white/20' : 'h-1 overflow-hidden rounded-full bg-surface-muted'}>
          <div
            className={featured ? 'h-full rounded-full bg-white' : 'h-full rounded-full bg-accent'}
            style={{ width: unknown ? '0%' : percent === null ? '28%' : `${Math.max(percent, 3)}%` }}
          />
        </div>
        <p className={featured ? 'mt-2 text-[11px] text-white/70' : 'mt-2 text-[11px] text-muted'}>
          {unknown
            ? 'Balance unavailable — refresh to retry'
            : limit === null
              ? 'Unlimited allowance'
              : `${limit.toLocaleString()} included`}
        </p>
      </div>
    </article>
  )
}

function AccountRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-3 first:pt-0 last:pb-0">
      <dt className="text-[11px] font-medium text-muted">{label}</dt>
      <dd className="truncate text-sm font-semibold text-ink" title={value}>
        {value}
      </dd>
    </div>
  )
}

function nextPlan(key: string | undefined): string | null {
  if (!key || key === 'trial') return 'Lead Engine'
  if (key === 'starter') return 'Professional'
  if (key === 'professional') return 'Agency'
  return null
}
