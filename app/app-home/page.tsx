import type { Metadata } from 'next'
import Link from 'next/link'

import Footer from '@/app/components/Footer'
import Nav from '@/app/components/Nav'
import { DashboardPreview } from '@/components/leadengine/DashboardPreview'
import { LeadEngineHero } from '@/components/leadengine/LeadEngineHero'
import { Pricing } from '@/components/leadengine/Pricing'
import { appUrl } from '@/lib/site'

/**
 * ⚠️ THIS ROUTE IS AN INTERNAL REWRITE TARGET, NOT A PUBLIC URL.
 *
 * `app.outlio.io/` IS the Lead Engine homepage. One deployment serves two
 * domains, so `app/page.tsx` is already taken by the agency marketing site and
 * cannot also render this. `proxy.ts` therefore rewrites `/` on the app host
 * to `/app-home`, and permanently redirects any direct request for
 * `/app-home` back to `/` so the path never surfaces publicly.
 *
 * The canonical below is the address visitors actually see.
 */
export const metadata: Metadata = {
  title: 'Lead Research & Enrichment Software | Outlio Lead Engine',
  description:
    'Turn a saved Sales Navigator page into a researched lead database. Outlio enriches companies from public registries, filings, funding and tech signals, finds public contacts, and answers questions in plain English with a source on every fact.',
  alternates: { canonical: appUrl('/') },
  openGraph: {
    type: 'website',
    url: appUrl('/'),
    siteName: 'Outlio',
    title: 'Lead Research & Enrichment Software | Outlio Lead Engine',
    description:
      'Turn a saved Sales Navigator page into a researched lead database, with a source link on every fact and no LinkedIn credentials required.',
  },
}

export default function LeadEnginePage() {
  return (
    /*
     * ⚠️ THE PALETTE IS SCOPED HERE, ON THE WHOLE PAGE.
     *
     * `.leadengine-surface` repoints `--coral` and `--accent` at dune orange.
     * Every widget below inherits it through the tokens it already uses, so
     * this one class is the entire colour change — and nothing outside this
     * page moves. See globals.css.
     */
    <div className="leadengine-surface">
      <Nav surface="leadengine" variant="heroGlass" />

      <LeadEngineHero />

      <section className="bg-paper px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
            Software access only
          </p>
          <h2 className="mt-4 max-w-3xl text-3xl font-bold uppercase leading-tight tracking-tight sm:text-4xl">
            Research infrastructure, not an outreach service
          </h2>
          <p className="mt-5 max-w-3xl text-base leading-relaxed text-muted sm:text-lg">
            Lead Engine extracts, enriches, de-duplicates, organizes, scores, and
            exports B2B data. It does not send cold emails, automatically send
            LinkedIn messages, perform outreach for customers, or include agency
            or appointment-setting services. FastSpring payments on this application
            purchase access to the software only.
          </p>
        </div>
      </section>

      <DashboardPreview />

      <Pricing />

      {/* ---- Final CTA ------------------------------------------------------ */}
      <section className="bg-cream px-4 py-20 sm:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
            Start with your next search
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
            Try the complete workflow — capture, research, Hubble and export —
            with 10 credits for three days. A payment method is required, but
            there is no charge until the trial ends, and your LinkedIn
            credentials are never requested.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/pricing"
              className="rounded-full bg-ink px-8 py-4 text-base font-semibold text-cream transition-colors duration-150 hover:bg-accent"
            >
              Start 3-day trial
            </Link>
            <Link
              href="/sign-in"
              className="rounded-full border border-ink px-8 py-4 text-base font-semibold transition-colors duration-150 hover:bg-paper"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <Footer surface="leadengine" />
    </div>
  )
}
