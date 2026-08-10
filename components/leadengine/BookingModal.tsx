'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { CALENDLY_URL } from '@/app/lib/constants'

/**
 * Calendly booking in a modal.
 *
 * Embedded as a plain iframe rather than via Calendly's widget.js: no
 * third-party script executes on our origin, so the CSP only needs a frame-src
 * grant instead of a hole in script-src. See next.config.ts.
 *
 * The iframe is mounted only while the modal is open, so a visitor who never
 * asks for a call never contacts Calendly and never receives its cookies.
 * Their consent banner is deliberately not suppressed.
 */
export function BookingModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => {
    setIsOpen(false)
    // The iframe unmounts on close, so the next open starts loading again.
    setIsLoaded(false)
  }, [])

  useEffect(() => {
    if (!isOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Captured now: by cleanup time the ref may point somewhere else.
    const trigger = triggerRef.current

    const panel = panelRef.current
    panel?.querySelector<HTMLElement>('button')?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        return
      }
      // Keep focus inside the dialog. The iframe is one stop in the ring, so a
      // keyboard user can still reach the scheduler and tab back out of it.
      if (e.key === 'Tab' && panel) {
        const focusables = panel.querySelectorAll<HTMLElement>('button, iframe')
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (!first || !last) return
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
      // Return focus where the user left it.
      trigger?.focus()
    }
  }, [isOpen, close])

  return (
    <>
      <div className="mx-auto mt-10 max-w-2xl rounded-[var(--radius-lg)] border border-border bg-panel p-6 text-center">
        <h3 className="text-base font-semibold text-ink">
          Not sure which plan fits?
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          Take a 30-minute call. We will look at your list volume and tell you
          which plan covers it — or that you do not need us yet.
        </p>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setIsOpen(true)}
          className="mt-5 inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] bg-accent px-6 text-base font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep"
        >
          Book a call
        </button>
      </div>

      {isOpen ? (
        <div
          className="modal-backdrop fixed inset-0 z-[60] grid place-items-center bg-ink/40 p-4 backdrop-blur-md sm:p-8"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="Book a call with Outlio"
        >
          <div
            ref={panelRef}
            onClick={(e) => e.stopPropagation()}
            className="modal-panel flex h-[85vh] max-h-[760px] w-full max-w-3xl flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border bg-panel shadow-[var(--shadow-lg)]"
          >
            <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5">
              <p className="text-sm font-semibold text-ink">Book a 30-minute call</p>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="grid size-9 shrink-0 place-items-center rounded-full border border-border text-muted transition-colors duration-150 hover:border-border-strong hover:text-ink"
              >
                <span aria-hidden>&times;</span>
              </button>
            </div>

            <div className="relative min-h-0 flex-1">
              {/* Calendly takes a beat to paint; never show a bare white void. */}
              {!isLoaded ? (
                <div
                  aria-hidden
                  className="absolute inset-0 grid place-items-center bg-panel"
                >
                  <div className="flex flex-col items-center gap-3">
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" />
                    <p className="text-sm text-muted">Loading available times…</p>
                  </div>
                </div>
              ) : null}

              <iframe
                src={CALENDLY_URL}
                title="Calendly scheduling"
                onLoad={() => setIsLoaded(true)}
                className="h-full w-full border-0"
                // The scheduler is a third party: give it nothing it does not need.
                sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
