import type { Metadata } from 'next'
import Link from 'next/link'

import { IntelligenceConsole } from '@/components/intelligence/IntelligenceConsole'
import { requireAccess } from '@/lib/auth/access'
import { listProfiles } from '@/lib/qualification/repository'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = {
  title: 'Intelligence | Outlio',
  robots: { index: false, follow: false },
}

// Counts and run state change in the background; never serve them from a cache.
export const dynamic = 'force-dynamic'

export default async function IntelligencePage() {
  const ctx = await requireAccess()
  const userId = ctx.userId!
  const supabase = createAdminClient()

  const [leadCount, companyCount, jobs, profiles] = await Promise.all([
    supabase
      .from('extracted_leads')
      .select('id', { count: 'exact', head: true })
      // Service role bypasses RLS — scoping by user_id is mandatory.
      .eq('user_id', userId),
    supabase.from('companies').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase
      .from('extraction_jobs')
      .select('id, leads_kept, created_at')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(10),
    listProfiles(userId),
  ])

  const totalLeads = leadCount.count ?? 0
  const totalCompanies = companyCount.count ?? 0

  const recentJobs = (jobs.data ?? []).map((job) => ({
    id: job.id,
    label: `${new Date(job.created_at).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
    })} — ${job.leads_kept.toLocaleString()} leads`,
    leadCount: job.leads_kept,
  }))

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          Lead Engine
        </p>
        <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-[30px]">
          Intelligence
        </h1>
        <p className="mt-1 text-sm text-muted">
          Ask a question about your leads. Outlio checks what it already knows,
          researches only what is missing, and returns just the columns you asked for.
        </p>
      </header>

      {totalLeads === 0 ? (
        <section className="rounded-[var(--radius-xl)] border border-dashed border-border bg-surface-muted/40 p-10 text-center">
          <h2 className="text-base font-semibold text-ink">No leads to research yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Extract a list first — research runs against the leads already in Outlio.
          </p>
          <Link
            href="/dashboard/extract/new"
            className="product-gradient mt-5 inline-flex h-10 items-center rounded-[var(--radius-md)] px-4 text-sm font-semibold text-white hover:brightness-95"
          >
            Start an extraction
          </Link>
        </section>
      ) : (
        <>
          {totalCompanies === 0 ? (
            /*
             * Company identity is what makes research affordable — one lookup
             * per company rather than one per lead. Without it the console
             * would still work, but every lead would be researched separately.
             */
            <p className="rounded-[var(--radius-lg)] border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
              Your leads are not linked to companies yet, so research cannot be shared
              between colleagues at the same company. An admin can run the company
              backfill from the admin panel.
            </p>
          ) : null}

          <IntelligenceConsole
            totalLeads={totalLeads}
            totalCompanies={totalCompanies}
            recentJobs={recentJobs}
            profiles={profiles.map((profile) => ({ id: profile.id, name: profile.name }))}
          />
        </>
      )}
    </div>
  )
}
