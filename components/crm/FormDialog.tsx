'use client'

import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react'

/**
 * The overlay that "New deal" and "New pipeline" open into.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  WHY THIS EXISTS: BOTH FORMS USED TO REPLACE THEIR OWN BUTTON, IN PLACE.  ║
 * ║                                                                           ║
 * ║  `NewPipelineButton` and `NewOpportunityButton` both did                  ║
 * ║  `if (open) return <TheWholeForm />` — so a multi-row form with a name    ║
 * ║  field, six stage rows and three controls each became a flex ITEM inside  ║
 * ║  the board's `flex flex-wrap items-center gap-2` header strip.            ║
 * ║                                                                           ║
 * ║  Two visible failures came out of that, and they looked like separate     ║
 * ║  bugs:                                                                    ║
 * ║                                                                           ║
 * ║    1. The form was squeezed to whatever width the strip had left, so its  ║
 * ║       stage rows wrapped into an unreadable column.                       ║
 * ║    2. It displaced its siblings, which dragged the "Manage" button —      ║
 * ║       and the `absolute right-0` menu anchored to it — leftward and off   ║
 * ║       the edge of the content column, where it was clipped. That is the   ║
 * ║       "manage pipeline pops out cut off" report: the menu's own CSS was   ║
 * ║       never wrong, its anchor had been shoved out from under it.          ║
 * ║                                                                           ║
 * ║  A layer of its own fixes both, because the form stops taking part in the ║
 * ║  header's layout at all.                                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ NOT `<dialog>`. Its top-layer rendering escapes `.product-clay`, which is
 * where the in-product accent tokens are scoped (DESIGN_TOKENS / CLAUDE.md), so
 * a native dialog renders the marketing coral on a product surface.
 */
export function FormDialog({
  label,
  onClose,
  children,
}: {
  label: string
  onClose: () => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  // Call the latest callback without reinstalling focus/scroll effects whenever
  // a parent passes a new inline handler (e.g. when adding a form row).
  const dismiss = useEffectEvent(onClose)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const previouslyFocused = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'

    const getFocusable = () => Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0)

    // Deal forms start with hidden IDs; those cannot receive keyboard focus.
    const firstControl = getFocusable()[0] ?? panelRef.current
    firstControl?.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        dismiss()
        return
      }
      if (event.key !== 'Tab') return

      /*
       * ⚠️ QUERIED ON EVERY TAB, NOT CACHED ON MOUNT. Both forms add and
       * remove rows while open — "Add stage", "Remove" — so a list captured
       * once sends focus to a button that is no longer on screen.
       */
      const focusable = getFocusable()
      if (!focusable.length) {
        event.preventDefault()
        panelRef.current?.focus({ preventScroll: true })
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
      // Back where they were, so the board does not scroll to the top.
      previouslyFocused?.focus?.({ preventScroll: true })
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-ink/25 p-4 sm:p-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        /*
         * ⚠️ `my-auto` PLUS `items-start`, NOT `items-center`. Centred, a form
         * taller than the viewport is centred on its own midpoint and its top
         * — the name field and the heading — is cut off above the scroll
         * origin, unreachable. Aligned to the start it simply scrolls.
         */
        className="my-auto w-full max-w-2xl outline-none"
      >
        {children}
      </div>
    </div>
  )
}
