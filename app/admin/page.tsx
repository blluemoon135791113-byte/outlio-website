import type { Metadata } from 'next'

import { CompanyBackfill } from '@/components/admin/CompanyBackfill'
import { RunWorkers } from '@/components/admin/RunWorkers'
import { UserRow, type AdminUser } from '@/components/admin/UserRow'
import { requireAdmin } from '@/lib/auth/access'
import { listActivePlans } from '@/lib/limits/plans'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ProfileRow, UserRole } from '@/types/database'

export const metadata: Metadata = {
  title: 'Admin | Outlio',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  // Repeated deliberately — see the note in app/admin/layout.tsx.
  const ctx = await requireAdmin()
  const supabase = createAdminClient()

  const [{ data: profiles }, { data: requests }, { data: audit }, plans] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, email, full_name, phone, linkedin_url, role, plan_id, access_expires_at, suspended_at, created_at',
      )
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('access_requests')
      .select('user_id, request_type, message, created_at')
      .eq('status', 'pending'),
    supabase
      .from('admin_audit_logs')
      .select('id, action, reason, created_at')
      .order('created_at', { ascending: false })
      .limit(15),
    listActivePlans(),
  ])

  const planNames = new Map(plans.map((p) => [p.id, p.name]))
  const pendingByUser = new Map(
    (requests ?? []).map((r) => [
      r.user_id,
      { type: r.request_type, message: r.message, createdAt: r.created_at },
    ]),
  )

  const users: AdminUser[] = ((profiles ?? []) as ProfileRow[]).map((p) => ({
    id: p.id,
    email: p.email,
    fullName: p.full_name,
    phone: p.phone,
    linkedinUrl: p.linkedin_url,
    role: p.role as UserRole,
    planName: p.plan_id ? (planNames.get(p.plan_id) ?? null) : null,
    accessExpiresAt: p.access_expires_at,
    suspendedAt: p.suspended_at,
    createdAt: p.created_at,
    pendingRequest: pendingByUser.get(p.id) ?? null,
  }))

  const awaiting = users.filter((u) => u.pendingRequest)
  const others = users.filter((u) => !u.pendingRequest)

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
            Administration
          </p>
          <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-[30px]">
            Users
          </h1>
          <p className="mt-1 text-sm text-muted">
            Review access requests and manage existing Outlio accounts.
          </p>
        </div>
        <span className="inline-flex w-fit rounded-full border border-accent/15 bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent">
          Admin access
        </span>
      </header>

      <section aria-label="Account totals" className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <AdminMetric label="Total accounts" value={users.length} featured />
        <AdminMetric label="Awaiting approval" value={awaiting.length} />
      </section>

      {awaiting.length > 0 ? (
        <section className="space-y-3 rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-sm)]">
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">
            Awaiting approval
          </h2>
          <ul className="space-y-3">
            {awaiting.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                plans={plans.map((p) => ({ id: p.id, name: p.name }))}
                isSelf={u.id === ctx.userId}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3 rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-sm)]">
        <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">All accounts</h2>
        {others.length === 0 ? (
          <p className="rounded-[var(--radius-lg)] border border-dashed border-border bg-surface-muted/40 p-8 text-center text-sm text-muted">
            No other accounts yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {others.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                plans={plans.map((p) => ({ id: p.id, name: p.name }))}
                isSelf={u.id === ctx.userId}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-sm)]">
        <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">Maintenance</h2>
        <p className="text-sm text-muted">
          Resolve leads to companies so company-level research runs once per
          company instead of once per lead. Safe to run repeatedly — leads that
          already have a company are skipped.
        </p>
        <CompanyBackfill />
      </section>

      <section className="space-y-3 rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-sm)]">
        <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">Background workers</h2>
        <p className="text-sm text-muted">
          Runs the same pass the scheduled job runs at 06:00 UTC — due email,
          reply sync, flows, webhooks and the evidence bridge. It changes no
          schedule: a message that is not yet due stays queued, and send windows,
          sending days and ramp limits are enforced where they always were.
        </p>
        <RunWorkers />
      </section>

      <section className="space-y-3 rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-sm)]">
        <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">Recent activity</h2>
        <p className="text-sm text-muted">
          Audit log entries are append-only and cannot be edited or deleted.
        </p>
        {(audit ?? []).length === 0 ? (
          <p className="text-sm text-muted">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-lg)] border border-border bg-panel">
            {(audit ?? []).map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5">
                <code className="text-sm font-medium text-ink">{a.action}</code>
                <span className="min-w-0 flex-1 truncate text-sm text-muted">
                  {a.reason ?? ''}
                </span>
                <time dateTime={a.created_at} className="text-xs text-muted">
                  {new Date(a.created_at).toLocaleString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function AdminMetric({ label, value, featured = false }: { label: string; value: number; featured?: boolean }) {
  return (
    <article className={featured ? 'rounded-[var(--radius-lg)] border border-accent bg-accent p-4 text-white shadow-[var(--shadow-md)]' : 'rounded-[var(--radius-lg)] border border-border bg-panel p-4 shadow-[var(--shadow-sm)]'}>
      <p className={featured ? 'text-xs font-medium text-white/84' : 'text-xs font-medium text-muted'}>{label}</p>
      <p className="mt-3 font-heading text-[30px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
        {value.toLocaleString()}
      </p>
    </article>
  )
}
