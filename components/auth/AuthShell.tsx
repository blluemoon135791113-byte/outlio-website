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
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-ink shadow-[var(--neo-shadow-chip)]">
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
              Lead intelligence, connected
            </p>
            <h2 className="mt-4 max-w-md font-heading text-[clamp(2.25rem,5vw,4rem)] font-semibold leading-[0.98] tracking-[-0.055em] text-ink">
              Turn lead data into your next best action.
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-7 text-muted">
              Capture clean records, enrich the companies behind them, and ask Hubble what matters before your team reaches out.
            </p>

            <ol className="mt-8 hidden space-y-3 lg:block" aria-label="How Outlio works">
              <AuthBenefit number="01" title="Capture" detail="Bring in the lead pages you already saved." />
              <AuthBenefit number="02" title="Understand" detail="Turn scattered evidence into verified context." />
              <AuthBenefit number="03" title="Act" detail="Export clean data or research it with Hubble." />
            </ol>
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
