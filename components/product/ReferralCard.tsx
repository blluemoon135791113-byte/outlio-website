'use client'

import { useState } from 'react'

import { REFERRAL_REWARD_CREDITS } from '@/lib/referrals/constants'

/**
 * Share-your-link card.
 *
 * The link is built on the server and passed in, so this never has to guess the
 * origin. Copy state is local and resets itself; there is no server round trip.
 */
export function ReferralCard({
  link,
  rewarded,
  creditsEarned,
}: {
  link: string
  rewarded: number
  creditsEarned: number
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be denied. The input is selectable either way.
      setCopied(false)
    }
  }

  return (
    <section className="credits-gradient rounded-[var(--radius-xl)] border border-accent/15 p-5 shadow-[var(--shadow-sm)]">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
        Refer a colleague
      </p>

      <p className="mt-3 text-sm leading-6 text-muted">
        You both get{' '}
        <strong className="font-semibold text-ink">
          {REFERRAL_REWARD_CREDITS} bonus credits
        </strong>{' '}
        when someone you refer is approved.
      </p>

      <div className="mt-4 flex gap-2">
        <input
          readOnly
          value={link}
          aria-label="Your referral link"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-border bg-panel px-3 py-2 text-xs text-muted"
        />
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-[var(--radius-md)] bg-accent px-3.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-accent-deep"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Announced to screen readers without stealing focus. */}
      <p aria-live="polite" className="sr-only">
        {copied ? 'Referral link copied to clipboard' : ''}
      </p>

      {rewarded > 0 ? (
        <p className="mt-4 border-t border-accent/10 pt-3 text-[11px] leading-4 text-muted">
          {rewarded} referral{rewarded === 1 ? '' : 's'} approved ·{' '}
          <strong className="font-semibold text-ink">{creditsEarned} credits</strong> earned
        </p>
      ) : (
        <p className="mt-4 border-t border-accent/10 pt-3 text-[11px] leading-4 text-muted">
          Credits arrive once we approve the person you referred.
        </p>
      )}
    </section>
  )
}
