import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Unauthenticated page shell.
 *
 * Mirrors the Hubble product material without exposing authenticated chrome.
 * Every auth step uses this shell, so security and recovery screens cannot
 * drift into a second visual system.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <main className="auth-clay min-h-screen bg-clay-bg px-4 py-6 text-ink sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col sm:min-h-[calc(100vh-4rem)]">
        <header className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-3 rounded-xl focus-visible:outline-offset-4"
          >
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-ink shadow-[var(--shadow-button)]">
              <Image
                src="/icon.png"
                alt=""
                width={40}
                height={40}
                priority
              />
            </span>
            <span className="font-heading text-lg font-semibold tracking-[-0.03em]">
              Outlio
            </span>
          </Link>
          <span className="rounded-full bg-clay-sunken px-3 py-1.5 text-[11px] font-semibold text-muted shadow-[var(--neo-shadow-inset)]">
            Secure workspace
          </span>
        </header>

        <div className="my-auto grid items-center gap-8 py-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1fr)] lg:gap-16">
          <section className="max-w-lg">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
              Outlio Lead Engine
            </p>
            <h2 className="mt-4 max-w-md font-heading text-[clamp(2.25rem,5vw,3.6rem)] font-semibold leading-[1.0] tracking-[-0.05em] text-ink">
              Your prospect list, researched and sourced.
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-7 text-muted">
              Upload a saved Sales Navigator page. Outlio researches the companies
              and people behind it across public sources, and Hubble answers your
              questions — with a source on every fact.
            </p>

            {/*
             * ⚠️ CONCRETE, NOT ASPIRATIONAL. The previous panel read
             * "Capture / Understand / Act", which is true of almost any B2B
             * tool and told a returning user nothing. These are the three
             * things this product does that most alternatives do not.
             */}
            <ol className="mt-8 hidden space-y-3 lg:block" aria-label="What Outlio does">
              <AuthBenefit
                number="01"
                title="60+ researched fields"
                detail="Registries, filings, funding, tech stack, hiring signals and public contacts."
              />
              <AuthBenefit
                number="02"
                title="A source on every fact"
                detail="Each value links to the page it came from. Nothing is inferred or guessed."
              />
              <AuthBenefit
                number="03"
                title="Ask Hubble anything"
                detail="Plain-English answers about a lead, quoting the passages behind them."
              />
            </ol>

            <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                  Deduplicated
                </dt>
                <dd className="mt-0.5 text-sm text-ink">Across every upload</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                  Exports
                </dt>
                <dd className="mt-0.5 text-sm text-ink">CSV and XLSX</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                  LinkedIn login
                </dt>
                <dd className="mt-0.5 text-sm text-ink">Never requested</dd>
              </div>
            </dl>
          </section>

          <section className="clay-raised w-full p-6 sm:p-8" aria-labelledby="auth-title">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
              Outlio workspace
            </p>
            <h1
              id="auth-title"
              className="mt-2 font-heading text-[30px] font-semibold leading-tight tracking-[-0.04em] text-ink"
            >
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-2 text-sm leading-6 text-muted">{subtitle}</p>
            ) : null}

            <div className="mt-7">{children}</div>

            {footer ? (
              <div className="mt-7 border-t border-border pt-5 text-center text-sm text-muted">
                {footer}
              </div>
            ) : null}
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pb-2 text-center text-[11px] text-muted lg:justify-between">
          <span>Encrypted sessions · MFA ready · No LinkedIn credentials stored</span>
          <span>© {new Date().getFullYear()} Outlio</span>
        </footer>
      </div>
    </main>
  )
}

function AuthBenefit({
  number,
  title,
  detail,
}: {
  number: string
  title: string
  detail: string
}) {
  return (
    <li className="flex items-center gap-4 rounded-[var(--radius-lg)] bg-clay-sunken px-4 py-3 shadow-[var(--neo-shadow-inset)]">
      <span className="font-mono text-[11px] font-semibold text-accent">{number}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted">{detail}</span>
      </span>
    </li>
  )
}
