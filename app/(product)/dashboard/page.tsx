import type { Metadata } from 'next'
import Link from 'next/link'

import { requireAccess } from '@/lib/auth/access'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = {
  title: 'Dashboard | Outlio',
  robots: { index: false, follow: false },
}

export default async function DashboardPage() {
  const ctx = await requireAccess()

  const { data: balanceRows } = await createAdminClient().rpc('credit_balance', {
    p_user_id: ctx.userId!,
  })
  const balance = Array.isArray(balanceRows) ? balanceRows[0] : null
  const limits = ctx.plan?.limits
  const usage = ctx.usage

  const metrics = [
    {
      label: 'Credits remaining',
      value: balance?.remaining ?? 0,
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
            Your usage, account, and next extraction in one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/jobs"
            className="inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-4 text-sm font-semibold text-ink transition-[border-color,background-color,transform] duration-150 ease-out hover:border-accent/35 hover:bg-accent-soft/40 active:scale-[0.97]"
          >
            View extractions
          </Link>
          <Link
            href="/dashboard/extract/new"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-accent-deep active:scale-[0.97]"
          >
            <span aria-hidden className="text-base leading-none">+</span>
            New extraction
          </Link>
        </div>
      </header>

      <section aria-label="Usage this period" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <UsageCard key={metric.label} {...metric} />
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <section className="relative overflow-hidden rounded-[var(--radius-xl)] border border-border bg-panel p-6 shadow-[var(--shadow-sm)] sm:p-7">
          <div className="relative z-10 max-w-xl">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-lg font-semibold text-accent">
              ↗
            </span>
            <h2 className="mt-6 text-xl font-semibold tracking-[-0.025em] text-ink">
              Build your next lead list
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-muted">
              Upload the lead-search pages you already saved. Outlio parses them on
              our servers, removes duplicates, and prepares a clean CSV.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                href="/dashboard/extract/new"
                className="inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] bg-ink px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-accent active:scale-[0.97]"
              >
                Start an extraction
              </Link>
              <Link
                href="/dashboard/jobs"
                className="inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] border border-border bg-panel px-4 text-sm font-semibold text-ink transition-[border-color,transform] duration-150 ease-out hover:border-border-strong active:scale-[0.97]"
              >
                Open workspace
              </Link>
            </div>
          </div>
          <div
            aria-hidden
            className="absolute -bottom-24 -right-20 h-72 w-72 rounded-full border-[42px] border-accent-soft/70"
          />
          <div
            aria-hidden
            className="absolute -bottom-10 right-16 h-32 w-32 rounded-full border border-accent/15"
          />
        </section>

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
  value: number
  limit: number | null
  featured?: boolean
}) {
  const percent = limit && limit > 0 ? Math.min((value / limit) * 100, 100) : null

  return (
    <article
      className={
        featured
          ? 'min-h-36 rounded-[var(--radius-lg)] border border-accent bg-accent p-4 text-white shadow-[var(--shadow-md)]'
          : 'min-h-36 rounded-[var(--radius-lg)] border border-border bg-panel p-4 shadow-[var(--shadow-sm)]'
      }
    >
      <div className="flex items-start justify-between gap-2">
        <p className={featured ? 'text-xs font-medium text-white/75' : 'text-xs font-medium text-muted'}>
          {label}
        </p>
        <span
          aria-hidden
          className={
            featured
              ? 'flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs text-accent'
              : 'flex h-6 w-6 items-center justify-center rounded-full border border-border text-xs text-muted'
          }
        >
          ↗
        </span>
      </div>
      <p className="mt-4 font-heading text-[30px] font-semibold leading-none tracking-[-0.045em] tabular-nums">
        {value.toLocaleString()}
      </p>
      <div className="mt-4">
        <div className={featured ? 'h-1 overflow-hidden rounded-full bg-white/20' : 'h-1 overflow-hidden rounded-full bg-surface-muted'}>
          <div
            className={featured ? 'h-full rounded-full bg-white' : 'h-full rounded-full bg-accent'}
            style={{ width: percent === null ? '28%' : `${Math.max(percent, 3)}%` }}
          />
        </div>
        <p className={featured ? 'mt-2 text-[11px] text-white/70' : 'mt-2 text-[11px] text-muted'}>
          {limit === null ? 'Unlimited allowance' : `${limit.toLocaleString()} included`}
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
