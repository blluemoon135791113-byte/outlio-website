'use client'

import { useState } from 'react'

import { ProductIcon } from '@/components/product/ProductNav'
import { REFERRAL_REWARD_CREDITS } from '@/lib/referrals/constants'

/**
 * Minimal sidebar referral shortcut.
 *
 * One tap copies the link — the sidebar is narrow, so showing the URL there
 * would truncate it into something unreadable. The full link with a visible
 * field lives on the dashboard card; this is the shortcut.
 *
 * It deliberately looks like the other navigation utilities rather than a
 * promotional card; the full referral explanation lives on the dashboard.
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
      <div className="rounded-lg bg-surface-muted p-3">
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
      className="group flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-muted transition-[background-color,color,transform] duration-150 ease-out hover:bg-surface-muted hover:text-ink active:scale-[0.98]"
    >
      <span aria-hidden className="flex h-[17px] w-[17px] shrink-0 items-center justify-center">
        <ProductIcon name="gift" className="h-[17px] w-[17px]" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
        {copied ? 'Referral link copied' : `Refer & get ${REFERRAL_REWARD_CREDITS} credits`}
      </span>

      <span aria-live="polite" className="sr-only">
        {copied ? 'Referral link copied to clipboard' : ''}
      </span>
    </button>
  )
}
