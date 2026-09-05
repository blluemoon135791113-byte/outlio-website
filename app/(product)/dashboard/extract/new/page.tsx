import type { Metadata } from 'next'
import Link from 'next/link'

import { UploadForm } from '@/components/upload/UploadForm'
import { requireAccess } from '@/lib/auth/access'
import { resolveUploadLimits } from '@/lib/upload/limits'

export const metadata: Metadata = {
  title: 'Find leads | Outlio',
  robots: { index: false, follow: false },
}

// The response returns immediately; after() may continue processing the batch.
export const maxDuration = 300

export default async function NewExtractionPage() {
  // The only access decision. Redirects when denied.
  const ctx = await requireAccess()
  const limits = resolveUploadLimits(ctx.plan?.limits ?? null)

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
            Lead Engine
          </p>
          <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-[30px]">
            Find leads
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            Upload the pages you saved.
          </p>
        </div>
        <Link
          href="/dashboard/jobs"
          className="inline-flex h-10 w-fit items-center justify-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-4 text-sm font-semibold text-ink transition-[border-color,background-color,transform] duration-150 ease-out hover:border-accent/35 hover:bg-accent-soft/40 active:scale-[0.97]"
        >
          View lead sources
        </Link>
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
        <section className="clay p-5 sm:p-6">
          {/* The subtitle restated the dropzone directly beneath it. */}
          <h2 className="mb-5 border-b border-clay-sunken pb-4 text-base font-semibold tracking-[-0.015em] text-ink">
            Upload saved pages
          </h2>
          <UploadForm
            maxFiles={limits.maxFiles}
            maxFileBytes={limits.maxFileBytes}
            leadsPerCredit={limits.leadsPerCredit}
          />
        </section>

        {/*
         * ⚠️ WAS THREE WIDGETS; NOW ONE.
         *
         * A "before you upload" guide, a credits explainer and a privacy card
         * stacked beside a form whose dropzone already states the file type,
         * the limit and the credit cost — and whose consent checkbox already
         * states the privacy position. Three panels restating the control they
         * sit next to is noise, and it pushed the actual form into a narrow
         * column. The steps survive because they are the one thing the form
         * cannot say: what to do BEFORE arriving here.
         */}
        {/* ⚠️ LILAC, BECAUSE THIS IS THE ONLY INFORMATIONAL PANEL HERE.
            Lilac had no token at all until recently and still appeared
            nowhere. Guidance — not a warning, not a success — is exactly the
            register it should own. One lilac surface per page, no more. */}
        <aside className="clay bg-lilac-soft p-5 ring-1 ring-lilac/40 xl:sticky xl:top-24">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Before you upload
          </p>
          <ol className="mt-4 space-y-4">
            <GuideStep number="1" title="Save the results page" body="Save each lead-search results page as HTML from your browser." />
            <GuideStep number="2" title="Upload the files" body={`Add up to ${limits.maxFiles} saved pages.`} />
            <GuideStep number="3" title="Review and export" body="Track each file, then download the CSV." />
          </ol>
          <p className="mt-5 border-t border-clay-sunken pt-4 text-xs leading-5 text-muted">
            1 credit per run, covering {limits.leadsPerCredit} leads. CSV downloads are free.
          </p>
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
