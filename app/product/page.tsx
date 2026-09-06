import type { Metadata } from 'next'
import Link from 'next/link'

import Footer from '@/app/components/Footer'
import Nav from '@/app/components/Nav'
import { DashboardPreview } from '@/components/leadengine/DashboardPreview'
import { ProductOverview } from '@/components/leadengine/ProductOverview'
import { appUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'The Product | Outlio Lead Engine',
  description:
    'What Lead Engine returns: 60+ researched company and contact fields gathered from public sources, each recorded with the page it came from, plus everything captured from the saved page itself.',
  alternates: { canonical: appUrl('/product') },
  openGraph: {
    type: 'website',
    url: appUrl('/product'),
    siteName: 'Outlio',
    title: 'The Product | Outlio Lead Engine',
    description:
      '60+ researched fields, each with a source. See what Lead Engine hands back.',
  },
  robots: { index: true, follow: true },
}

export default function ProductPage() {
  return (
    <div className="leadengine-surface">
      <Nav surface="leadengine" />

      <main>
        <section className="bg-paper px-4 pb-4 pt-20 sm:pt-28">
          <div className="mx-auto max-w-5xl">
            <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
              The product
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
              A lead database you can actually check
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
              Lead Engine is self-serve software. It converts files you choose to
              provide into structured data, records the source of every value it
              gathers, and says so when it cannot fill a cell. A subscription
              does not include advertising, managed outreach, appointment
              setting, consulting, or any other human-delivered service.
            </p>
          </div>
        </section>

        <DashboardPreview />

        <ProductOverview />

        <section className="bg-cream px-4 py-20 sm:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
              See it on your own list
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              Three days, 10 credits, the complete workflow. No LinkedIn
              credentials are ever requested.
            </p>
            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href="/pricing"
                className="rounded-full bg-ink px-8 py-4 text-base font-semibold text-cream transition-colors duration-150 hover:bg-accent"
              >
                See pricing
              </Link>
              <Link
                href="/how-it-works"
                className="rounded-full border border-ink px-8 py-4 text-base font-semibold transition-colors duration-150 hover:bg-paper"
              >
                How it works
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer surface="leadengine" />
    </div>
  )
}
