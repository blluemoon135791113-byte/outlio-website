'use client'

import { useState } from 'react'

import { ProductIcon } from '@/components/product/ProductNav'
import { REFERRAL_REWARD_CREDITS } from '@/lib/referrals/constants'

/**
 * Sidebar referral prompt.
 *
 * One tap copies the link — the sidebar is 232px wide, so showing the URL there
 * would truncate it into something unreadable. The full link with a visible
 * field lives on the dashboard card; this is the shortcut.
 *
 * The glow is built from --accent so it tracks the theme, and it is a static
 * shadow rather than a pulsing animation: this sits on screen the whole session
 * and anything that moves forever becomes noise.
 */
export function SidebarReferral({
  link,
  onNavigate,
}: {
  link: string
  onNavigate?: () => void
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const copied = state === 'copied'

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setState('copied')
      window.setTimeout(() => setState('idle'), 2400)
    } catch {
      // Clipboard access can be refused — insecure context, a permissions
      // policy, an unfocused document. Reveal the link so the user is never
      // left with a button that appears to do nothing.
      setState('manual')
    }
    onNavigate?.()
  }

  if (state === 'manual') {
    return (
      <div className="rounded-[var(--radius-lg)] border border-accent/20 bg-accent-soft/55 p-3">
        <p className="text-[11px] font-semibold leading-4 text-ink">
          Copy your referral link
        </p>
        <input
          readOnly
          autoFocus
          value={link}
          aria-label="Your referral link"
          onFocus={(e) => e.currentTarget.select()}
          className="mt-2 w-full rounded-[var(--radius-md)] border border-border bg-panel px-2 py-1.5 text-[11px] text-muted"
        />
        <button
          type="button"
          onClick={() => setState('idle')}
          className="mt-2 text-[11px] font-semibold text-accent"
        >
          Done
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="group w-full rounded-[var(--radius-lg)] border border-accent/20 bg-accent-soft/55 p-3 text-left transition-[border-color,background-color,transform] duration-150 ease-out hover:border-accent/40 hover:bg-accent-soft active:scale-[0.98]"
    >
      <span className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-white shadow-[0_0_0_3px_var(--accent-soft),0_0_12px_-1px_var(--accent)] transition-shadow duration-150 group-hover:shadow-[0_0_0_3px_var(--accent-soft),0_0_18px_0_var(--accent)]"
        >
          <ProductIcon name="gift" className="h-[15px] w-[15px]" />
        </span>

        <span className="min-w-0">
          <span className="block text-[12.5px] font-semibold leading-4 text-ink">
            Refer &amp; Get {REFERRAL_REWARD_CREDITS} Extra Credits
          </span>
          <span className="mt-1 block text-[11px] leading-4 text-muted">
            {copied
              ? 'Link copied — go share it'
              : `Your friend gets ${REFERRAL_REWARD_CREDITS} free credits too`}
          </span>
          <span className="mt-1.5 block text-[11px] font-semibold text-accent">
            {copied ? 'Copied' : 'Copy your link'}
          </span>
        </span>
      </span>

      <span aria-live="polite" className="sr-only">
        {copied ? 'Referral link copied to clipboard' : ''}
      </span>
    </button>
  )
}
