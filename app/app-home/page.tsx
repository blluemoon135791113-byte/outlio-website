import type { Metadata } from 'next'

import Footer from '@/app/components/Footer'
import Nav from '@/app/components/Nav'
import { CrmEnrichmentExperience } from '@/components/leadengine/CrmEnrichmentExperience'
import { DashboardPreview } from '@/components/leadengine/DashboardPreview'
import { ExtractionJourney } from '@/components/leadengine/ExtractionJourney'
import { HubbleIntelligence } from '@/components/leadengine/HubbleIntelligence'
import { LeadEngineHero } from '@/components/leadengine/LeadEngineHero'
import { LeadLibrary } from '@/components/leadengine/LeadLibrary'
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

      <main className="leadengine-story">
        <LeadEngineHero />

        <div className="leadengine-story-flow">
          <div className="leadengine-story-panel leadengine-story-panel-immersive">
            <CrmEnrichmentExperience />
          </div>

          <div className="leadengine-story-panel leadengine-story-panel-extraction">
            <ExtractionJourney />
          </div>

          <div className="leadengine-story-panel leadengine-story-panel-inner-only">
            <HubbleIntelligence />
          </div>

          <aside className="leadengine-story-note" aria-labelledby="software-access-title">
            <p className="leadengine-story-kicker">Software access only</p>
            <div>
              <h2 id="software-access-title" className="leadengine-story-note-title">
                Research infrastructure, not an outreach service
              </h2>
              <p className="leadengine-story-note-copy">
                Lead Engine extracts, enriches, de-duplicates, organizes, scores, and
                exports B2B data. It does not send cold emails, automatically send
                LinkedIn messages, perform outreach for customers, or include agency
                or appointment-setting services. FastSpring payments on this application
                purchase access to the software only.
              </p>
            </div>
          </aside>

          <div className="leadengine-story-panel">
            <DashboardPreview />
          </div>

          <div className="leadengine-story-panel">
            <Pricing />
          </div>

          <LeadLibrary />
        </div>
      </main>

      <Footer surface="leadengine" />
    </div>
  )
}
