'use client'

import { useEffect, useRef } from 'react'

import type { ActionState } from '@/lib/auth/actions'

/**
 * Error and success banners. Uses the status tokens added in globals.css —
 * no hardcoded colors.
 *
 * role="alert" so screen readers announce the result without a focus jump.
 *
 * ⚠️ FOCUS MOVES AFTER A FAILED SUBMIT, AND ONLY THEN. A server action returns
 * a rejection with the page scrolled to the submit button, so without this the
 * message can sit off-screen above the fold and the form looks like it did
 * nothing. Where the action named a field, focus goes to that input — the
 * place the user has to act. Where it did not (sign-in credentials, rate
 * limits), focus goes to the banner itself, which is why it is focusable.
 */
export function FormFeedback({ state }: { state: ActionState }) {
  const banner = useRef<HTMLDivElement>(null)
  const isError = state.status === 'error'
  const field = isError ? state.field : undefined

  useEffect(() => {
    if (!isError) return

    /*
     * Queried from the banner's own form rather than the document, so a page
     * that ever shows two forms cannot focus the wrong one's input. Escaped
     * because `field` is a name we control, and building a selector from an
     * unescaped string is a habit worth not having.
     */
    const form = banner.current?.closest('form')
    const target = field
      ? form?.querySelector<HTMLElement>(`[name="${CSS.escape(field)}"]`)
      : null

    ;(target ?? banner.current)?.focus()
    // `state` identity changes on every submit, so a second failure with the
    // same message still re-focuses.
  }, [state, isError, field])

  if (state.status === 'idle') return null

  return (
    <div
      ref={banner}
      role="alert"
      // -1 so it can receive focus programmatically without entering the tab
      // order, where an announcement is not a stop the user wants.
      tabIndex={-1}
      className={
        isError
          ? 'rounded-[var(--radius-md)] border-0 bg-danger-soft px-3 py-2.5 text-sm leading-relaxed text-danger shadow-[var(--neo-shadow-inset)]'
          : 'rounded-[var(--radius-md)] border-0 bg-success-soft px-3 py-2.5 text-sm leading-relaxed text-success shadow-[var(--neo-shadow-inset)]'
      }
    >
      {state.message}
    </div>
  )
}
