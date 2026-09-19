'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'

/** Typing pause before a search re-queries. Long enough not to fire per keystroke. */
const TYPING_SETTLE_MS = 350

/**
 * Makes the contact filter bar apply itself.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ AN ENHANCEMENT TO THE GET FORM, NOT A REPLACEMENT FOR IT.            ║
 * ║                                                                           ║
 * ║  `ContactFilters` is a plain `<form method="get">` on purpose, and the    ║
 * ║  reasons in its header still hold: the filters live in the URL, so they   ║
 * ║  survive a reload, can be shared, are what a saved view stores, and keep  ║
 * ║  the back button meaningful.                                             ║
 * ║                                                                           ║
 * ║  So this component adds NO inputs and owns NO filter state. It listens on ║
 * ║  the form it is rendered inside, reads the values the BROWSER already     ║
 * ║  holds via `FormData`, and navigates to the URL the Apply button would    ║
 * ║  have produced. Every field stays uncontrolled and server-rendered: with  ║
 * ║  JavaScript off, or before hydration, the Apply button still works and    ║
 * ║  nothing here has run.                                                    ║
 * ║                                                                           ║
 * ║  That also means no field list is duplicated here. A filter added to the  ║
 * ║  form is picked up automatically, rather than silently failing to apply   ║
 * ║  until someone remembers to add it in a second place.                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function AutoApplyFilters({
  action,
  children,
}: {
  action: string
  /** The Apply button. Shown only while this component is not yet listening. */
  children: ReactNode
}) {
  const router = useRouter()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [pending, startTransition] = useTransition()
  /*
   * Hydration-gated so the Apply button is only hidden once this is actually
   * listening. Rendering the "auto" state on the server would hide the button
   * on a page whose JavaScript never arrives — which this project has seen —
   * leaving a filter bar with no way at all to apply a filter.
   */
  const [enhanced, setEnhanced] = useState(false)

  useEffect(() => {
    const form = anchorRef.current?.closest('form')
    if (!form) return

    setEnhanced(true)

    let timer: ReturnType<typeof setTimeout> | undefined

    const navigate = (replace: boolean) => {
      const query = new URLSearchParams()
      for (const [key, value] of new FormData(form).entries()) {
        // Empty means "Any". Carrying it through would put `?company=&source=`
        // in every URL and make `activeFilterCount` and saved views disagree
        // with what the page is showing.
        if (typeof value === 'string' && value !== '') query.append(key, value)
      }

      const target = query.size > 0 ? `${action}?${query}` : action
      startTransition(() => {
        if (replace) router.replace(target, { scroll: false })
        else router.push(target, { scroll: false })
      })
    }

    /*
     * ⚠️ `replace` WHILE TYPING, `push` FOR A DELIBERATE CHOICE. Pushing per
     * search keystroke buries the previous screen under a dozen history
     * entries, so Back stops being an undo and becomes a chore. Picking a
     * company or a date is one decision and earns one entry.
     */
    const onInput = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (!isTextual(target)) return
      clearTimeout(timer)
      timer = setTimeout(() => navigate(true), TYPING_SETTLE_MS)
    }

    const onChange = (event: Event) => {
      const target = event.target as HTMLElement | null
      // A text field also fires `change` on blur; its `input` handler already
      // covers it, and running both would navigate twice for one edit.
      if (isTextual(target)) return
      clearTimeout(timer)
      navigate(false)
    }

    /*
     * ⚠️ ENTER MUST NOT FALL THROUGH TO THE NATIVE SUBMIT. A GET submit is a
     * full document load: it discards the RSC cache, scrolls to the top and
     * drops focus out of the search box — the exact jolt this component exists
     * to remove, arriving only for people who press Enter.
     */
    const onSubmit = (event: SubmitEvent) => {
      event.preventDefault()
      clearTimeout(timer)
      navigate(false)
    }

    form.addEventListener('input', onInput)
    form.addEventListener('change', onChange)
    form.addEventListener('submit', onSubmit)

    return () => {
      clearTimeout(timer)
      form.removeEventListener('input', onInput)
      form.removeEventListener('change', onChange)
      form.removeEventListener('submit', onSubmit)
    }
  }, [action, router])

  return (
    <span ref={anchorRef} className="contents">
      {enhanced ? (
        <span
          role="status"
          aria-live="polite"
          className={`text-xs text-muted transition-opacity duration-150 ${
            pending ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/*
            Held in the layout even when idle (`opacity-0`, not unmounted) so
            the row does not reflow on every applied filter.
          */}
          Updating…
        </span>
      ) : (
        /*
         * ⚠️ THE APPLY BUTTON IS THE `children`, AND IT IS THE FALLBACK. It is
         * rendered until the exact moment this component is listening, so
         * there is never a frame — or a failed-hydration session — in which
         * the filter bar has neither a working button nor working auto-apply.
         */
        children
      )}
    </span>
  )
}

function isTextual(node: HTMLElement | null): boolean {
  if (!node) return false
  if (node instanceof HTMLTextAreaElement) return true
  if (!(node instanceof HTMLInputElement)) return false
  // `date` fires `input` per typed digit, producing navigations for 0001-01-01
  // on the way to 2026-01-01. It is a discrete choice; let `change` have it.
  return ['text', 'search', 'email', 'tel', 'url', 'number', 'password'].includes(node.type)
}
