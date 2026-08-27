'use client'

import Link from 'next/link'

/**
 * Lead Engine hero.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WHY THIS WAS REWRITTEN.                                                 ║
 * ║                                                                          ║
 * ║  The previous hero sold a CSV converter: "Turn Sales Navigator results   ║
 * ║  into a clean CSV." That was true in the first month and has been        ║
 * ║  badly wrong since. The product now researches 60+ sourced fields per    ║
 * ║  company, resolves identity before attaching a contact to a person,      ║
 * ║  scores confidence by independent corroboration, and answers questions   ║
 * ║  in plain English through Hubble. Selling the export step is like        ║
 * ║  advertising a database by its "Save" button.                            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Visually this now uses the CLAY surfaces the dashboard and Hubble use
 * (`--clay-bg`, `clay-raised`, `--neo-shadow`) rather than the flat paper cards
 * of the agency site. Someone arriving from this page should recognise the app
 * they land in.
 */

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

export function LeadEngineHero() {
  return (
    <section className="relative overflow-hidden bg-clay-bg px-4 pb-14 pt-10 sm:pb-20 sm:pt-14">
      <div aria-hidden className="hero-aurora pointer-events-none absolute inset-0" />

      <div className="relative mx-auto max-w-5xl">
        <div className="text-center">
          <p
            className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent"
            style={{ animation: `fade-in 0.6s ${EASE} both` }}
          >
            Outlio · Lead Engine
          </p>

          <h1
            className="mx-auto mt-4 max-w-4xl font-heading text-[clamp(2rem,5vw,3.9rem)] font-bold leading-[0.98] tracking-[-0.04em] text-ink"
            style={{ animation: `fade-in 0.7s ${EASE} 0.05s both` }}
          >
            Your prospect list,
            <br />
            <span className="text-accent">researched and sourced.</span>
          </h1>

          {/*
           * ⚠️ WHAT IT DOES, IN THREE CLAUSES. A visitor decides in one read.
           * Every claim here maps to shipped behaviour: the parser, the
           * research pipeline, and Hubble.
           */}
          <p
            className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg"
            style={{ animation: `fade-in 0.7s ${EASE} 0.12s both` }}
          >
            Upload the Sales Navigator page you already saved. Outlio turns it
            into a clean, de-duplicated lead database, researches the companies
            and people behind it across public sources, and lets you ask
            questions in plain English — with a source link on every answer.
          </p>

          <div
            className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
            style={{ animation: `fade-in 0.7s ${EASE} 0.18s both` }}
          >
            <Link
              href="/sign-up"
              className="rounded-full bg-ink px-8 py-3.5 text-base font-semibold text-cream shadow-[var(--neo-shadow-chip)] transition-colors duration-150 hover:bg-accent"
            >
              Get started free
            </Link>
            <Link
              href="#how-it-works"
              className="rounded-full border border-border-strong bg-clay-raised px-8 py-3.5 text-base font-semibold text-ink shadow-[var(--neo-shadow-chip)] transition-colors duration-150 hover:border-accent hover:text-accent"
            >
              See how it works
            </Link>
          </div>

          <p
            className="mt-4 text-sm text-muted"
            style={{ animation: `fade-in 0.7s ${EASE} 0.24s both` }}
          >
            3-day free trial · 10 credits · No charge until the trial ends
          </p>
        </div>

        {/*
         * Three cards, one per stage of the actual pipeline. The old set was
         * a before/after comparison about copy-pasting — a problem framing
         * that stopped being the point once research shipped.
         */}
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          <ClayCard delay="0.28s" step="01" title="Capture">
            <p className="text-sm leading-relaxed text-muted">
              Upload a saved results page, or capture one with the extension
              while you browse. Duplicates are caught against everything you
              have uploaded before.
            </p>
          </ClayCard>

          <ClayCard delay="0.34s" step="02" title="Research" accent>
            <p className="text-sm leading-relaxed text-muted">
              Company registries, filings, funding, tech stack, hiring signals
              and public contacts — gathered, de-conflicted and scored.
            </p>
            <p className="mt-3 font-heading text-2xl font-bold tracking-[-0.03em] text-ink">
              60+ sourced fields
            </p>
          </ClayCard>

          <ClayCard delay="0.4s" step="03" title="Ask">
            <p className="text-sm leading-relaxed text-muted">
              Hubble answers questions about a lead in plain English, quoting
              the page it read. Export to CSV or XLSX whenever you want.
            </p>
          </ClayCard>
        </div>
      </div>
    </section>
  )
}

function ClayCard({
  children,
  delay,
  step,
  title,
  accent = false,
}: {
  children: React.ReactNode
  delay: string
  step: string
  title: string
  accent?: boolean
}) {
  return (
    <div
      className={`clay-raised p-6 ${accent ? 'ring-1 ring-accent/25' : ''}`}
      style={{ animation: `fade-in 0.7s ${EASE} ${delay} both` }}
    >
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[11px] font-semibold text-accent">{step}</span>
        <h3 className="font-heading text-lg font-semibold tracking-[-0.03em] text-ink">
          {title}
        </h3>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  )
}
