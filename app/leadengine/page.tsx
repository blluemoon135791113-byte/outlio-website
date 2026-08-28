import type { Metadata } from 'next'
import Link from 'next/link'

import Footer from '@/app/components/Footer'
import Nav from '@/app/components/Nav'
import { HubbleLogo } from '@/components/brand/HubbleLogo'
import { DashboardPreview } from '@/components/leadengine/DashboardPreview'
import { LeadEngineHero } from '@/components/leadengine/LeadEngineHero'
import { Pricing } from '@/components/leadengine/Pricing'

export const metadata: Metadata = {
  title: 'Lead Research & Enrichment Software | Outlio Lead Engine',
  description:
    'Turn a saved Sales Navigator page into a researched lead database. Outlio enriches companies from public registries, filings, funding and tech signals, finds public contacts, and answers questions in plain English with a source on every fact.',
  alternates: { canonical: 'https://app.outlio.io/leadengine' },
  openGraph: {
    type: 'website',
    url: 'https://app.outlio.io/leadengine',
    siteName: 'Outlio',
    title: 'Lead Research & Enrichment Software | Outlio Lead Engine',
    description:
      'Turn a saved Sales Navigator page into a researched lead database, with a source link on every fact and no LinkedIn credentials required.',
  },
}

const PAINS = [
  {
    title: 'A list of names is not a reason to call',
    body: 'A name, a title and a company tell you who someone is. They do not tell you whether the company just raised, is hiring against your use case, or runs the stack you integrate with.',
  },
  {
    title: 'Research does not survive the spreadsheet',
    body: 'Someone checks a company, learns something useful, and it lives in their head or a Slack thread. Next quarter the same company gets researched again from scratch.',
  },
  {
    title: 'Enriched data you cannot check is a liability',
    body: 'Most tools hand you a value with no source. If it is wrong you find out when a prospect tells you. Every fact in Outlio carries the page it came from.',
  },
]

const STEPS = [
  {
    n: '01',
    title: 'Bring in the list',
    body: 'Open a Sales Navigator lead search, press Cmd+S (Ctrl+S on Windows) and save the page — or capture it with the extension while you browse. Upload one file or a batch. Duplicates are caught against every list you have uploaded before.',
  },
  {
    n: '02',
    title: 'Research it',
    body: 'Pick what you want to know and Outlio gathers it from public sources: registries and filings, funding rounds, technology in use, hiring signals, recent news, and publicly published contact details. Nothing is guessed.',
  },
  {
    n: '03',
    title: 'Ask, score and export',
    body: 'Ask Hubble a question about any lead and read the answer with its sources. Score the list against your ideal-customer profile. Export to CSV or XLSX when you are ready.',
  },
]

/**
 * ⚠️ CATEGORIES, NOT A PROMISE PER LEAD. Availability depends on the company
 * and what is public. A cell we could not fill says so, with a reason.
 */
const RESEARCH = [
  ['Company profile', 'Domain, industry, headcount, headquarters, description and specialties'],
  ['Registries & filings', 'Companies House, SEC EDGAR and GLEIF: status, type, incorporation, officers, filing history'],
  ['Funding', 'Round, amount, date and named investors'],
  ['Technology', 'Stack detected from the public site, plus churn and website signals'],
  ['Momentum', 'Hiring signals, recent news, product launches, employee growth, competitors'],
  ['Public contacts', 'Work email and phone where a company or person has published them'],
  ['Reviews & presence', 'Review platforms, ratings, counts and public GitHub activity'],
  ['Public funding', 'US federal award totals, counts and types where they exist'],
]

const CAPTURED = [
  ['Full name', 'Exactly as shown on the profile'],
  ['LinkedIn profile', 'A direct link to the person'],
  ['Job title', 'Their actual role, not their tenure'],
  ['Company', 'Plus a company link where one exists'],
  ['Location', 'City, region, country'],
  ['Summary', 'The short bio line under their name'],
  ['Time in role', 'How long in this position'],
  ['Time at company', 'How long at this employer'],
]

const HONEST = [
  {
    title: 'It never logs in as you',
    body: 'No password, no cookie, no session token. Outlio has no way to sign in to LinkedIn and never asks you for credentials.',
  },
  {
    title: 'It never browses LinkedIn',
    body: 'There is no bot. Lead Engine only ever reads a page you opened yourself — either a file you upload, or a page you capture with our extension while you browse. It never navigates for you.',
  },
  {
    title: 'You decide what is kept',
    body: 'Download the CSV, then clear the data. All we keep is a one-way fingerprint so future uploads can still spot a duplicate. No names, companies or profile links remain.',
  },
]

export default function LeadEnginePage() {
  return (
    <>
      <Nav surface="leadengine" />

      <LeadEngineHero />

      <DashboardPreview />

      <section className="bg-paper px-4 pb-8 pt-10">
        <div className="clay mx-auto max-w-5xl p-6 sm:p-8">
          <p className="text-[13px] font-semibold uppercase tracking-[0.2em] text-accent">
            Software subscription only
          </p>
          <p className="mt-3 max-w-3xl text-base leading-7 text-muted">
            Lead Engine is self-serve software that converts files you choose to provide into
            structured data. A subscription does not include advertising, managed outreach,
            appointment setting, consulting, or any other human-delivered marketing service.
          </p>
        </div>
      </section>

      {/* ---- The problem --------------------------------------------------- */}
      <section className="bg-lilac-soft px-4 py-20 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <div className="max-w-2xl">
            <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
              The problem
            </p>
            <h2 className="mt-4 text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
              Exporting the list was never the hard part
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted sm:text-lg">
              Your search already found the right companies. What it cannot tell
              you is which of them are worth a conversation this week, and why.
            </p>
          </div>

          <div className="mt-14 grid gap-8 md:grid-cols-3">
            {PAINS.map((p) => (
              <div key={p.title}>
                <h3 className="text-xl font-bold tracking-tight">{p.title}</h3>
                <p className="mt-2.5 text-base leading-relaxed text-muted">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- The solution -------------------------------------------------- */}
      <section className="bg-paper px-4 py-20 sm:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
            The fix
          </p>
          <h2 className="mt-4 text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
            One workspace, from list to answer
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            Outlio keeps the list, the research and the reasoning in one place.
            The work you do on a company today is still there the next time it
            appears in a search. It never logs in to LinkedIn, controls your
            browser, or browses on your behalf.
          </p>
        </div>
      </section>

      {/* ---- How it works --------------------------------------------------- */}
      <section id="how-it-works" className="scroll-mt-20 bg-sage-soft px-4 py-20 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <h2 className="max-w-2xl text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
            Three steps. No setup.
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            No credentials, no browser automation, no scraping bot. You bring the
            page; Outlio does the research.
          </p>

          <div className="mt-14 grid gap-8 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n}>
                <span className="text-[13px] font-bold uppercase tracking-[0.22em] text-accent">
                  {s.n}
                </span>
                <h3 className="mt-3 text-2xl font-bold tracking-tight">{s.title}</h3>
                <p className="mt-2.5 text-base leading-relaxed text-muted">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- What research returns ------------------------------------------ */}
      <section id="product-preview" className="scroll-mt-20 bg-paper px-4 py-20 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <div className="max-w-2xl">
            <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
              The intelligence
            </p>
            <h2 className="mt-4 text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
              60+ researched fields, each with a source
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted sm:text-lg">
              Choose the columns you actually need. Outlio gathers them from
              public sources and records where each one came from, so any value
              can be checked in one click.
            </p>
          </div>

          <dl className="mt-12 grid gap-x-10 gap-y-6 sm:grid-cols-2">
            {RESEARCH.map(([name, note]) => (
              <div key={name} className="border-t border-border pt-4">
                <dt className="text-base font-semibold text-ink">{name}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-muted">{note}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-12 border-t border-border pt-10">
            <h3 className="text-xl font-bold tracking-tight">
              Plus everything captured from the page itself
            </h3>
            <dl className="mt-6 grid gap-x-10 gap-y-4 sm:grid-cols-2">
              {CAPTURED.map(([name, note]) => (
                <div key={name} className="flex flex-wrap items-baseline gap-x-2">
                  <dt className="text-sm font-semibold text-ink">{name}</dt>
                  <dd className="text-sm text-muted">— {note}</dd>
                </div>
              ))}
            </dl>
          </div>

          <p className="clay mt-10 max-w-2xl p-5 text-sm leading-relaxed text-muted">
            <strong className="font-semibold text-ink">Sales Navigator only.</strong>{' '}
            Lead Engine reads saved <em>Sales Navigator lead search-results</em>{' '}
            pages. A regular linkedin.com search page, a company page, or a file
            from anywhere else will be rejected rather than silently mis-parsed.
          </p>
        </div>
      </section>

      {/* ---- Hubble ---------------------------------------------------------- */}
      <section className="bg-clay-bg px-4 py-20 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2.5">
              <HubbleLogo size="sm" />
              <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
                Hubble
              </p>
            </div>
            <h2 className="mt-4 text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
              Ask about a lead in plain English
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted sm:text-lg">
              &ldquo;What does this company sell, and who would buy it?&rdquo;
              &ldquo;Have they raised recently?&rdquo; Hubble reads public pages,
              answers in a few lines, and quotes the passages it used.
            </p>
            {/*
             * ⚠️ SAY WHAT IT COSTS, WHERE IT IS SOLD. Hubble is gated by
             * `requireHubbleAccess()` to the Pro + Hubble plan. Describing it
             * as a general capability sends someone to the $28 tier expecting
             * a feature that redirects them to an upgrade page.
             */}
            <p className="mt-4 text-sm font-semibold text-ink">
              Included on the{' '}
              <Link href="/leadengine/pricing" className="text-accent underline-offset-2 hover:underline">
                Pro + Hubble
              </Link>{' '}
              plan.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            <div className="clay-raised p-6">
              <h3 className="font-heading text-lg font-semibold tracking-[-0.03em] text-ink">
                It cites, or it says nothing
              </h3>
              <p className="mt-2.5 text-sm leading-relaxed text-muted">
                Answers are built from pages Hubble actually fetched. Where it
                cannot find support, it reports that instead of filling the gap.
              </p>
            </div>
            <div className="clay-raised p-6">
              <h3 className="font-heading text-lg font-semibold tracking-[-0.03em] text-ink">
                Agreement is measured
              </h3>
              <p className="mt-2.5 text-sm leading-relaxed text-muted">
                When independent sources reach the same value, confidence rises
                and the table says so. When they disagree, it says that too.
              </p>
            </div>
            <div className="clay-raised p-6">
              <h3 className="font-heading text-lg font-semibold tracking-[-0.03em] text-ink">
                The right person, not the right name
              </h3>
              <p className="mt-2.5 text-sm leading-relaxed text-muted">
                A contact is only attached to a lead when the evidence ties it to
                them specifically — not to somebody who shares their name.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Honesty -------------------------------------------------------- */}
      <section className="bg-cream px-4 py-20 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <h2 className="max-w-2xl text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
            What it is not
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            Some tools automate your LinkedIn account in the background. Outlio
            deliberately does not. You stay in control of what is saved and what
            is uploaded.
          </p>

          <div className="mt-14 grid gap-8 md:grid-cols-3">
            {HONEST.map((h) => (
              <div
                key={h.title}
                className="rounded-[var(--radius-lg)] border border-border bg-panel p-6"
              >
                <h3 className="text-lg font-bold tracking-tight">{h.title}</h3>
                <p className="mt-2.5 text-base leading-relaxed text-muted">{h.body}</p>
              </div>
            ))}
          </div>

          <p className="mt-10 max-w-2xl text-sm leading-relaxed text-muted">
            You are responsible for having the right to process the information in
            the files you upload, and for complying with LinkedIn&apos;s user
            agreement and applicable privacy law.
          </p>
        </div>
      </section>

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
              href="/leadengine/pricing"
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
    </>
  )
}
