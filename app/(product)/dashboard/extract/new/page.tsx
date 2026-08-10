import type { Metadata } from 'next'
import Link from 'next/link'

import { UploadForm } from '@/components/upload/UploadForm'
import { requireAccess } from '@/lib/auth/access'
import { EXPORT_CREDIT_COST, creditsForFiles } from '@/lib/limits/credits'
import { resolveUploadLimits } from '@/lib/upload/limits'

export const metadata: Metadata = {
  title: 'New extraction | Outlio',
  robots: { index: false, follow: false },
}

// The response returns immediately; after() may continue processing the batch.
export const maxDuration = 300

export default async function NewExtractionPage() {
  // The only access decision. Redirects when denied.
  const ctx = await requireAccess()
  const limits = resolveUploadLimits(ctx.plan?.limits ?? null)
  // Quote the effective ceiling, which may be tighter than the plan's.
  const maxCost = creditsForFiles(limits.maxFiles, limits.filesPerCredit)

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
            Lead Engine
          </p>
          <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-[30px]">
            New extraction
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            Upload saved lead-search pages. Processing happens securely on Outlio's servers.
          </p>
        </div>
        <Link
          href="/dashboard/jobs"
          className="inline-flex h-10 w-fit items-center justify-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-4 text-sm font-semibold text-ink transition-[border-color,background-color,transform] duration-150 ease-out hover:border-accent/35 hover:bg-accent-soft/40 active:scale-[0.97]"
        >
          View extractions
        </Link>
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
        <section className="rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-sm)] sm:p-6">
          <div className="mb-5 border-b border-border pb-4">
            <h2 className="text-base font-semibold tracking-[-0.015em] text-ink">
              Upload saved pages
            </h2>
            <p className="mt-1 text-sm text-muted">
              Add your HTML files, choose duplicate handling, then start the run.
            </p>
          </div>
          <UploadForm
            maxFiles={limits.maxFiles}
            maxFileBytes={limits.maxFileBytes}
            filesPerCredit={limits.filesPerCredit}
          />
        </section>

        <aside className="space-y-4 xl:sticky xl:top-24">
          <section className="rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-sm)]">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              Before you upload
            </p>
            <ol className="mt-4 space-y-4">
              <GuideStep number="1" title="Save the results page" body="Use your browser to save each lead-search results page as HTML." />
              <GuideStep number="2" title="Upload the files" body={`Add up to ${limits.maxFiles} saved pages to this extraction.`} />
              <GuideStep number="3" title="Review and export" body="Track every file live, then download the cleaned CSV." />
            </ol>
          </section>

          <section className="rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-sm)]">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              How credits are charged
            </p>
            <p className="mt-3 text-xs leading-5 text-muted">
              {limits.filesPerCredit
                ? `1 credit covers up to ${limits.filesPerCredit} files in a single run. A full ${limits.maxFiles}-file extraction costs ${maxCost} credits.`
                : `Each extraction costs 1 credit.`}{' '}
              {EXPORT_CREDIT_COST === 0
                ? 'Downloading the CSV is free.'
                : `Downloading the CSV costs ${EXPORT_CREDIT_COST} more.`}
            </p>
          </section>

          <section className="rounded-[var(--radius-xl)] border border-accent/15 bg-accent-soft/60 p-5">
            <h2 className="text-sm font-semibold text-ink">Your data stays private</h2>
            <p className="mt-1.5 text-xs leading-5 text-muted">
              Outlio processes only the files you submit. It does not fetch pages from a third-party platform.
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}

function GuideStep({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft font-heading text-xs font-semibold text-accent">
        {number}
      </span>
      <div>
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted">{body}</p>
      </div>
    </li>
  )
}
