'use client'

/**
 * The designed error state for every authenticated screen.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THERE WAS NO ERROR BOUNDARY ANYWHERE IN THE APP. NOT ONE.                ║
 * ║                                                                           ║
 * ║  38 product pages, no `error.tsx` at any level and none at the root. Every ║
 * ║  throw in a Server Component therefore rendered Next's own fallback: a     ║
 * ║  bare "Application error: a server-side exception has occurred", with no   ║
 * ║  navigation, no branding and no way back except the browser's back button. ║
 * ║                                                                           ║
 * ║  CLAUDE.md's design rules require every screen to ship a designed loading, ║
 * ║  empty and error state. Empty states exist throughout; the other two did   ║
 * ║  not exist at all.                                                        ║
 * ║                                                                           ║
 * ║  ⚠️ AND THE THROWS ARE REAL, NOT HYPOTHETICAL. `getPlanById` throws on a   ║
 * ║  malformed `limits` blob — production's inactive `agency` plan is missing  ║
 * ║  `credits_per_month` right now, and `lib/limits/plans.ts` records that     ║
 * ║  activating it "would have taken /admin and /dashboard/access down for     ║
 * ║  every user". Without a boundary, "down" meant that bare grey page.       ║
 * ║  `getMetricTotals` and `gatherFacts` throw by design too.                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { useEffect } from 'react'
import Link from 'next/link'

export default function ProductError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    /*
     * ⚠️ THE DIGEST, NEVER THE MESSAGE. In production Next replaces the message
     * with a generic string and keeps a `digest` hash — logging the message
     * here would be a no-op there and, in development, would put whatever the
     * error contained into the browser console. CLAUDE.md: never a stack trace,
     * SQL, a storage path or an internal id to the client.
     */
    console.error('[product] render failed', { digest: error.digest ?? 'none' })
  }, [error.digest])

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <section
        role="alert"
        className="clay w-full max-w-md space-y-4 p-6 text-center"
      >
        <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink">
          This screen did not load
        </h1>

        {/*
          ⚠️ NO BLAME AND NO JARGON. The person reading this did nothing wrong
          and cannot act on "an exception occurred". What they can do is retry,
          leave, or quote a reference — so those are the three things offered.
        */}
        <p className="text-sm leading-relaxed text-muted">
          Something went wrong on our side, not yours. Your data is safe and
          nothing was changed. Trying again often works — the problem is usually
          momentary.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-[var(--radius-md)] bg-accent px-4 py-2 text-sm font-semibold text-cream shadow-[var(--shadow-button)] transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.98]"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-semibold text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink"
          >
            Back to dashboard
          </Link>
        </div>

        {/*
          ⚠️ THE DIGEST IS SHOWN ON PURPOSE, and it is safe: Next generates it
          as a hash so that a customer and a log can be matched without the
          customer being shown the error. "It broke" is unsupportable; "it broke,
          reference 1878898592" is a ticket someone can actually answer.
        */}
        {error.digest ? (
          <p className="text-xs text-muted">
            Reference <code className="font-mono">{error.digest}</code> — quote this if you contact us.
          </p>
        ) : null}
      </section>
    </div>
  )
}
