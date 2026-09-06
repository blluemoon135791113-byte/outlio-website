import type { Metadata } from 'next'
import Link from 'next/link'

import Footer from '@/app/components/Footer'
import Nav from '@/app/components/Nav'
import { HowItWorks } from '@/components/leadengine/HowItWorks'
import { appUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'How Lead Engine Works | Outlio',
  description:
    'Save a Sales Navigator lead search page yourself, upload it, and Outlio turns it into a researched, exportable lead database. No LinkedIn credentials, no browser automation.',
  alternates: { canonical: appUrl('/how-it-works') },
  openGraph: {
    type: 'website',
    url: appUrl('/how-it-works'),
    siteName: 'Outlio',
    title: 'How Lead Engine Works | Outlio',
    description:
      'Bring a page you saved yourself, choose what to research, then ask, score and export. Three steps, no setup.',
  },
  robots: { index: true, follow: true },
}

export default function HowItWorksPage() {
  return (
    <div className="leadengine-surface">
      <Nav surface="leadengine" />

      <main>
        <section className="bg-paper px-4 pb-4 pt-20 sm:pt-28">
          <div className="mx-auto max-w-5xl">
            <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
              How it works
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
              You bring the page. Outlio does the research.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
              Lead Engine is a file processor, not a crawler. It reads a Sales
              Navigator lead search-results page that you opened and saved
              yourself, and turns it into a de-duplicated, researched, exportable
              database. It never asks for your LinkedIn password, never stores a
              session cookie, and never navigates LinkedIn on your behalf.
            </p>
          </div>
        </section>

        <HowItWorks />

        <section className="bg-cream px-4 py-20 sm:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
              Start with your next search
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              Try the complete workflow — capture, research, Hubble and export —
              with 10 credits for three days.
            </p>
            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href="/pricing"
                className="rounded-full bg-ink px-8 py-4 text-base font-semibold text-cream transition-colors duration-150 hover:bg-accent"
              >
                See pricing
              </Link>
              <Link
                href="/product"
                className="rounded-full border border-ink px-8 py-4 text-base font-semibold transition-colors duration-150 hover:bg-paper"
              >
                What you get back
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer surface="leadengine" />
    </div>
  )
}
