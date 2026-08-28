import type { Metadata } from 'next'
import Link from 'next/link'

import { requireUser } from '@/lib/auth/access'

export const metadata: Metadata = {
  title: 'Welcome to Outlio Lead Engine',
  robots: { index: false, follow: false },
}

export default async function WelcomePage() {
  const user = await requireUser()

  return (
    <main className="flex min-h-screen items-center justify-center bg-app px-5 py-16">
      <section className="w-full max-w-xl rounded-[var(--radius-xl)] bg-panel p-8 text-center shadow-[var(--shadow-lg)] ring-1 ring-border sm:p-12">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-accent text-2xl font-bold text-white" aria-hidden>
          ✓
        </span>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          Checkout complete
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          Welcome to Outlio.
        </h1>
        <p className="mt-4 text-base leading-7 text-muted">
          Paddle is confirming your subscription for {user.email}. Access is granted only from the
          verified webhook, so it may take a few seconds to appear in your account.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/dashboard" className="rounded-[var(--radius-md)] bg-accent px-6 py-3 font-semibold text-white hover:bg-accent-deep">
            Open dashboard
          </Link>
          <Link href="/dashboard/settings/billing" className="rounded-[var(--radius-md)] bg-cream px-6 py-3 font-semibold text-ink ring-1 ring-border hover:ring-accent/40">
            View billing
          </Link>
        </div>
      </section>
    </main>
  )
}

