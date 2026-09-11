'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Lead lookup, on ⌘K.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE FASTEST PATH TO A PERSON, FROM ANYWHERE IN THE PRODUCT.               ║
 * ║                                                                           ║
 * ║  A setter's day is "find this person, then act". Before this, that was     ║
 * ║  navigate to Contacts, wait for the list, type into the filter, submit.    ║
 * ║  Four steps and two page loads to reach a record they can already name.   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ NO `cmdk`, NO NEW DEPENDENCY. The behaviour that matters here is a
 * debounce, an abort, four key handlers and a focus return — about sixty lines.
 * A dependency would also own the markup, and every token in it would then be
 * someone else's decision.
 *
 * ⚠️ NO `backdrop-filter` ON THE SCRIM, even though the rule was just relaxed.
 * The condition recorded with that change is "not on a large or frequently
 * repainted surface", and a full-viewport blur sitting over the contacts table
 * is exactly the case it names. A solid scrim costs nothing and the palette is
 * the thing meant to hold attention.
 */

type Result = { id: string; name: string | null; subtitle: string | null; href: string }
type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; results: Result[] }
  | { kind: 'error' }

/**
 * The last answer received, tagged with the query it answers.
 *
 * ⚠️ TAGGED, NOT BARE. `idle` and `loading` are derived from the query below
 * rather than written into state, because setting state synchronously inside
 * the search effect is a cascading render. Carrying the query on the outcome
 * falls out of that for free, and it makes a stale response impossible to
 * DISPLAY rather than merely unlikely to arrive — belt as well as braces on
 * the abort.
 */
type Outcome =
  | { query: string; kind: 'results'; results: Result[] }
  | { query: string; kind: 'error' }

const MIN_QUERY = 2
/* Long enough that a typed word is one request, short enough to feel live. */
const DEBOUNCE_MS = 220

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [active, setActive] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  /* Where focus came from, so Escape returns it rather than dropping it. */
  const openerRef = useRef<HTMLElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setOutcome(null)
    setActive(0)
    abortRef.current?.abort()
    openerRef.current?.focus()
  }, [])

  /* ⌘K on mac, Ctrl+K elsewhere. Registered once, on the window, because the
     point is that it works from any screen. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        openerRef.current = document.activeElement as HTMLElement | null
        setOpen((was) => !was)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  /*
   * ⚠️ EVERY IN-FLIGHT REQUEST IS ABORTED BEFORE THE NEXT ONE. Without this,
   * responses race: type "mar", then "marcus", and the slower "mar" can land
   * second and overwrite the results for what the user actually typed.
   */
  useEffect(() => {
    if (!open) return
    const term = query.trim()

    if (term.length < MIN_QUERY) {
      abortRef.current?.abort()
      return
    }

    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller

    const timer = setTimeout(() => {
      fetch(`/api/crm/quick-search?q=${encodeURIComponent(term)}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error('failed'))))
        .then((body: { results?: Result[] }) => {
          setOutcome({ query: term, kind: 'results', results: body.results ?? [] })
          setActive(0)
        })
        .catch((error: unknown) => {
          // An abort is the expected path, not a failure to report.
          if (error instanceof DOMException && error.name === 'AbortError') return
          setOutcome({ query: term, kind: 'error' })
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, open])

  const term = query.trim()
  /*
   * The four states, derived rather than stored. `loading` is "the query is
   * long enough but the answer on hand is not for this query" — which covers
   * the first request and every subsequent keystroke with one expression.
   */
  const state: State =
    term.length < MIN_QUERY
      ? { kind: 'idle' }
      : outcome === null || outcome.query !== term
        ? { kind: 'loading' }
        : outcome.kind === 'error'
          ? { kind: 'error' }
          : { kind: 'ready', results: outcome.results }

  if (!open) return null

  const results = state.kind === 'ready' ? state.results : []

  const go = (href: string) => {
    close()
    router.push(href)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (results.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const chosen = results[active]
      if (chosen) go(chosen.href)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 px-4 pt-[12vh]"
      /* A click on the scrim is a dismissal; one inside the panel is not. */
      onMouseDown={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search leads"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        className="w-full max-w-xl overflow-hidden rounded-[var(--radius-lg)] border border-border bg-panel shadow-[var(--shadow-lg)]"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-muted">
            <path
              d="M9 3a6 6 0 104.24 10.24l3.26 3.26 1.5-1.5-3.26-3.26A6 6 0 009 3zm0 2a4 4 0 110 8 4 4 0 010-8z"
              fill="currentColor"
            />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search leads by name or email…"
            aria-label="Search leads by name or email"
            autoComplete="off"
            spellCheck={false}
            className="h-12 w-full border-0 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded-[var(--radius-sm)] border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted sm:block">
            Esc
          </kbd>
        </div>

        {/* Every state is designed — CLAUDE.md requires loading, empty and error. */}
        <div className="max-h-[52vh] overflow-y-auto p-2">
          {state.kind === 'idle' ? (
            <p className="px-3 py-6 text-center text-sm text-muted">
              Type at least two characters to search your leads.
            </p>
          ) : null}

          {state.kind === 'loading' ? (
            <div className="space-y-1 p-1" aria-busy="true">
              <span className="sr-only">Searching…</span>
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-2.5">
                  <div
                    aria-hidden
                    className="h-8 w-8 shrink-0 rounded-full bg-surface-muted motion-safe:animate-pulse"
                  />
                  <div className="flex-1 space-y-1.5">
                    <div
                      aria-hidden
                      className="h-3.5 w-1/3 rounded-[var(--radius-sm)] bg-surface-muted motion-safe:animate-pulse"
                    />
                    <div
                      aria-hidden
                      className="h-3 w-1/2 rounded-[var(--radius-sm)] bg-surface-muted motion-safe:animate-pulse"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {state.kind === 'error' ? (
            <p role="alert" className="px-3 py-6 text-center text-sm text-muted">
              That search could not be run. Your leads are unaffected — try again.
            </p>
          ) : null}

          {state.kind === 'ready' && results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">
              Nobody matches “{query.trim()}”. Check the spelling, or they may not be in your
              CRM yet.
            </p>
          ) : null}

          {results.map((result, index) => (
            <button
              key={result.id}
              type="button"
              onClick={() => go(result.href)}
              onMouseEnter={() => setActive(index)}
              aria-current={index === active ? 'true' : undefined}
              className={`flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2 py-2.5 text-left transition-colors duration-150 ${
                index === active ? 'bg-accent-soft' : 'hover:bg-surface-muted'
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[11px] font-semibold text-muted">
                {initials(result.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">
                  {result.name ?? 'Unnamed contact'}
                </span>
                {result.subtitle ? (
                  <span className="block truncate text-xs text-muted">{result.subtitle}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Two letters, or one, or a dash — never a crash on an unnamed contact. */
function initials(name: string | null): string {
  if (!name) return '—'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

/** The affordance that tells people the shortcut exists. */
export function CommandPaletteTrigger() {
  return (
    <button
      type="button"
      onClick={() => {
        /*
         * ⚠️ DISPATCHES THE SHORTCUT RATHER THAN LIFTING STATE. The palette owns
         * its own open state and listens on the window, so the button can stay
         * a sibling anywhere in the shell without either one knowing about the
         * other. One source of truth for "is it open".
         */
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
        )
      }}
      className="flex h-9 items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 text-sm text-muted transition-colors duration-150 hover:border-border-strong hover:text-ink"
    >
      <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4">
        <path
          d="M9 3a6 6 0 104.24 10.24l3.26 3.26 1.5-1.5-3.26-3.26A6 6 0 009 3zm0 2a4 4 0 110 8 4 4 0 010-8z"
          fill="currentColor"
        />
      </svg>
      <span className="hidden sm:inline">Search leads</span>
      <kbd className="hidden rounded-[var(--radius-sm)] border border-border px-1.5 text-[11px] font-medium md:inline">
        ⌘K
      </kbd>
    </button>
  )
}
