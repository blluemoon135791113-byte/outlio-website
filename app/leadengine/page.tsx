import type { Metadata } from 'next'
import Link from 'next/link'

import Footer from '@/app/components/Footer'
import Nav from '@/app/components/Nav'
import { LeadEngineHero } from '@/components/leadengine/LeadEngineHero'
import { Pricing } from '@/components/leadengine/Pricing'

export const metadata: Metadata = {
  title: 'Sales Navigator CSV Export | Outlio Lead Engine',
  description:
    'Turn a saved LinkedIn Sales Navigator results page into a clean CSV. Extract names, titles, companies and profile links without sharing your LinkedIn login or installing an extension.',
  alternates: { canonical: 'https://outlio.io/leadengine' },
  openGraph: {
    type: 'website',
    url: 'https://outlio.io/leadengine',
    siteName: 'Outlio',
    title: 'Sales Navigator CSV Export | Outlio Lead Engine',
    description:
      'Save a Sales Navigator results page and turn it into a clean, duplicate-free CSV without sharing your LinkedIn login.',
  },
}

const PAINS = [
  {
    title: 'Hours lost to copy and paste',
    body: 'One page can hold 25 prospects and hundreds of useful fields. Moving them into a spreadsheet by hand turns a good search into busywork.',
  },
  {
    title: 'Duplicate prospects slip through',
    body: 'Run a similar search next month and old prospects appear again. Outlio checks new uploads against your previous lists before you contact anyone twice.',
  },
  {
    title: 'Your LinkedIn account stays private',
    body: 'Outlio never asks for your LinkedIn password, cookies or session. There is no browser extension controlling your account.',
  },
]

const STEPS = [
  {
    n: '01',
    title: 'Save the results page',
    body: 'Open a Sales Navigator lead search, press Cmd+S (Ctrl+S on Windows), then choose "Webpage, Complete".',
  },
  {
    n: '02',
    title: 'Drop it into Outlio',
    body: 'Upload one saved page or a full batch. Outlio validates every file before processing it and rejects anything that is not a supported results page.',
  },
  {
    n: '03',
    title: 'Download the CSV',
    body: 'Download a structured CSV with duplicates removed across the current batch and your previous uploads. Clear stored lead data whenever you want.',
  },
]

const FIELDS = [
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
    body: 'There is no bot and no extension. The only thing Lead Engine ever reads is a file you chose to upload from your own machine.',
  },
  {
    title: 'You decide what is kept',
    body: 'Download the CSV, then clear the data. We keep only an anonymous fingerprint for future duplicate checks. No names, companies or profile links remain.',
  },
]

export default function LeadEnginePage() {
  return (
    <>
      <Nav homePrefix="/" />

      <LeadEngineHero />

      {/* ---- The problem --------------------------------------------------- */}
      <section className="bg-cream px-4 py-20 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <div className="max-w-2xl">
            <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
              The problem
            </p>
            <h2 className="mt-4 text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
              Sales Navigator won&apos;t let you export
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted sm:text-lg">
              Your search has the right prospects. The missing piece is a fast,
              reliable way to move that list into the tools where your team works.
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
            The page is already on your computer
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            Save the results page already loaded in your browser, then upload that
            file to Outlio. Lead Engine turns the information in the file into a
            structured CSV. It does not log in to LinkedIn, control your browser or
            browse on your behalf.
          </p>
        </div>
      </section>

      {/* ---- How it works --------------------------------------------------- */}
      <section id="how-it-works" className="scroll-mt-20 bg-cream px-4 py-20 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <h2 className="max-w-2xl text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
            Three steps. No setup.
          </h2>

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

      {/* ---- What you get --------------------------------------------------- */}
      <section className="bg-paper px-4 py-20 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <div className="max-w-2xl">
            <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
              Every column
            </p>
            <h2 className="mt-4 text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
              What lands in your CSV
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted sm:text-lg">
              Every value comes from the page you uploaded. Missing fields stay
              empty, so your team can trust the source of every column.
            </p>
          </div>

          <dl className="mt-12 grid gap-x-10 gap-y-6 sm:grid-cols-2">
            {FIELDS.map(([name, note]) => (
              <div key={name} className="border-t border-border pt-4">
                <dt className="text-base font-semibold text-ink">{name}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-muted">{note}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-10 max-w-2xl rounded-[var(--radius-lg)] border border-border bg-panel p-5 text-sm leading-relaxed text-muted">
            <strong className="font-semibold text-ink">Sales Navigator only.</strong>{' '}
            Lead Engine reads saved <em>Sales Navigator lead search-results</em>{' '}
            pages. A regular linkedin.com search page, a company page, or a file
            from anywhere else will be rejected rather than silently mis-parsed.
          </p>
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
            Your next list, in a spreadsheet
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
            Try the complete workflow with 10 credits for three days. No card is
            required, and your LinkedIn credentials are never requested.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className="rounded-full bg-ink px-8 py-4 text-base font-semibold text-cream transition-colors duration-150 hover:bg-accent"
            >
              Convert your first list free
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

      <Footer />
    </>
  )
}
