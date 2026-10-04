import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { AuthHero } from '@/components/auth/AuthHero'

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
    <main id="main-content" tabIndex={-1} className="auth-clay min-h-screen bg-void px-4 py-6 text-ivory sm:px-6 sm:py-8 lg:px-8">
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
        </header>

        <div className="my-auto grid items-center gap-6 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.95fr)] lg:gap-8">
          {/*
            ⚠️ SECOND ON A PHONE, FIRST ON A DESKTOP. Measured at 375×812 before
            this: the email field started at y=726 and the SIGN IN BUTTON SAT AT
            920 — below the fold on a 1142px page. A returning user on a phone
            landed on the pitch and had to scroll past it to submit, every time.

            The brand panel still belongs here: someone arriving at /sign-up has
            not decided yet. But it is the second thing they need, and stacking
            order is the only thing that was deciding otherwise.

            The brand artwork stands alone now (see AuthHero): the image fills
            the whole panel with no copy, on the page's black background. The
            form is the only text surface.
          */}
          <div className="order-2 lg:order-1">
            <AuthHero />
          </div>

          <section
            className="auth-formdark order-1 flex w-full flex-col justify-center lg:order-2 lg:py-4"
            aria-labelledby="auth-title"
          >
            <h1
              id="auth-title"
              className="font-heading text-[30px] font-semibold leading-tight tracking-[-0.04em] text-ink"
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

        <footer className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pb-2 text-center text-[11px] text-ivory/55 lg:justify-between">
          <span>Encrypted sessions · MFA ready · No LinkedIn credentials stored</span>
          <span>© {new Date().getFullYear()} Outlio</span>
        </footer>
      </div>
    </main>
  )
}
