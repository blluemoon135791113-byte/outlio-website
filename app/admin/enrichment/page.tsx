import type { Metadata } from 'next'
import Link from 'next/link'

import { LocalTime } from '@/components/ui/LocalTime'
import {
  loadEnrichmentFunnels,
  type JobFunnel,
  type Outcome,
  type Tally,
} from '@/lib/admin/enrichment-funnel'
import { requireAdmin } from '@/lib/auth/access'

export const metadata: Metadata = {
  title: 'Enrichment | Admin | Outlio',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

/** What each outcome means, in the words someone deciding the next fix needs. */
const OUTCOME_LABEL: Record<Outcome, string> = {
  found: 'Found',
  no_website: 'No website found for the company',
  site_unreachable: 'Website did not answer',
  site_refused: 'Website refused us (blocked or bot check)',
  site_js_rendered: 'Website is built by JavaScript — no text to read',
  site_no_contact: 'Website read — no email or phone published',
  site_off_domain_only: 'Website read — only other companies’ emails',
  search_empty: 'Search returned no results',
  not_named: 'Search results were about other people',
  named_no_contact: 'Person found online — no contact shown',
  masked_only: 'Only a partly hidden value was shown',
  unrecorded: 'Not found — reason not recorded (enriched before reasons existed)',
  timed_out: 'Ran out of time',
  failed: 'Lookup failed',
  not_attempted: 'Not attempted',
}

const ORDER = Object.keys(OUTCOME_LABEL) as Outcome[]

function percent(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`
}

function Breakdown({ title, tally, total }: { title: string; tally: Tally; total: number }) {
  const rows = ORDER.filter((outcome) => outcome !== 'found' && (tally[outcome] ?? 0) > 0)
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing missed.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((outcome) => (
            <li key={outcome} className="flex justify-between gap-4 text-sm">
              <span className="text-muted">{OUTCOME_LABEL[outcome]}</span>
              <span className="tabular-nums text-ink">
                {tally[outcome]} <span className="text-muted">({percent(tally[outcome] ?? 0, total)})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Stat({ label, value, of }: { label: string; value: number; of: number }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-base font-semibold tabular-nums text-ink">
        {value}/{of} <span className="text-sm font-normal text-muted">{percent(value, of)}</span>
      </p>
    </div>
  )
}

function JobCard({ job }: { job: JobFunnel }) {
  return (
    <section className="space-y-4 rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">
          {job.leads} leads · {job.companies} companies
        </h2>
        <p className="text-xs text-muted">
          Uploaded <LocalTime iso={job.createdAt} /> · job {job.jobId.slice(0, 8)}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Company website" value={job.companiesWithWebsite} of={job.companies} />
        <Stat label="Company email" value={job.companyEmails} of={job.companies} />
        <Stat label="Company phone" value={job.companyPhones} of={job.companies} />
        <Stat label="Work email" value={job.personEmails} of={job.leads} />
        <Stat label="Mobile phone" value={job.personPhones} of={job.leads} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Breakdown title="Companies with no contact" tally={job.company} total={job.companies} />
        <Breakdown title="People with no work email" tally={job.personEmail} total={job.leads} />
        <Breakdown title="People with no mobile phone" tally={job.personPhone} total={job.leads} />
      </div>
    </section>
  )
}

/**
 * Where automatic enrichment stops, per upload.
 *
 * ⚠️ `requireAdmin()` IS CALLED HERE, NOT INHERITED FROM THE LAYOUT — see
 * `tests/unit/admin-page-guard.test.ts`. The data is counts only; no lead's
 * name or contact reaches this page.
 */
export default async function AdminEnrichmentPage() {
  await requireAdmin()

  let funnels: JobFunnel[] | null = null
  try {
    funnels = await loadEnrichmentFunnels(10)
  } catch (error) {
    console.error('[admin/enrichment] load failed', {
      message: error instanceof Error ? error.message : 'unknown',
    })
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <Link href="/admin" className="text-sm font-medium text-accent">
          ← Admin
        </Link>
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.035em] text-ink">
          Enrichment
        </h1>
        <p className="max-w-2xl text-sm text-muted">
          The last ten finished uploads: how many companies and people got each contact, and,
          for the rest, where the search stopped. Counts only.
        </p>
      </header>

      {funnels === null ? (
        <p className="rounded-[var(--radius-lg)] border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          The report could not be loaded. Reload to try again; the server log has the reason.
        </p>
      ) : funnels.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-border bg-panel p-4 text-sm text-muted">
          No finished uploads yet. The report fills in once a job has been processed and enriched.
        </p>
      ) : (
        funnels.map((job) => <JobCard key={job.jobId} job={job} />)
      )}
    </div>
  )
}
