'use client'

import { useSyncExternalStore } from 'react'

/**
 * A timestamp rendered in the READER'S timezone.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ `toLocaleString()` IN A SERVER COMPONENT IS A CORRECTNESS BUG, not a  ║
 * ║  style problem.                                                           ║
 * ║                                                                           ║
 * ║  It formats with the SERVER's locale and timezone. Vercel runs in UTC, so ║
 * ║  a reply that arrived at 4pm in Karachi renders as 11am to the person who ║
 * ║  received it — and "when did they reply" is exactly the question an inbox ║
 * ║  exists to answer.                                                        ║
 * ║                                                                           ║
 * ║  The machine-readable value stays in `dateTime`, so the correct instant   ║
 * ║  is available to assistive tech and to anything parsing the page even     ║
 * ║  before hydration.                                                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function LocalTime({ iso, dateOnly = false }: { iso: string; dateOnly?: boolean }) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null

  /*
   * ⚠️ `suppressHydrationWarning` IS CORRECT HERE AND ONLY HERE. The server
   * genuinely cannot know the reader's timezone, so server and client output
   * differ by design. Suppressing it anywhere else would hide a real bug.
   */
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {dateOnly
        ? date.toLocaleDateString(undefined, { dateStyle: 'medium' })
        : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
    </time>
  )
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The reader's clock, as an external store.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ TIME IS MUTABLE STATE OUTSIDE REACT, SO IT IS READ LIKE ONE.         ║
 * ║                                                                           ║
 * ║  `Date.now()` called during render is impure — two renders of identical   ║
 * ║  props disagree — and the React compiler rejects it outright. Assigning   ║
 * ║  it from an effect instead trades that for a cascading render on mount,   ║
 * ║  which the compiler also rejects, and both were tried here first.         ║
 * ║                                                                           ║
 * ║  `useSyncExternalStore` is the primitive for exactly this: a cached       ║
 * ║  snapshot that only changes when the store says so, and a SEPARATE server ║
 * ║  snapshot — `null` — so the server renders an absolute date and hydration ║
 * ║  matches by construction rather than by suppression.                      ║
 * ║                                                                           ║
 * ║  One interval serves every timestamp on the page, and it does not exist   ║
 * ║  while nothing is subscribed.                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
let clockNow = 0
let clockTimer: ReturnType<typeof setInterval> | null = null
const clockListeners = new Set<() => void>()

function subscribeToClock(onChange: () => void): () => void {
  clockListeners.add(onChange)

  if (clockTimer === null) {
    clockNow = Date.now()
    clockTimer = setInterval(() => {
      clockNow = Date.now()
      for (const listener of clockListeners) listener()
      // A minute is the finest granularity any label below distinguishes, so
      // ticking faster would re-render the page to produce identical text.
    }, MINUTE)
  }

  return () => {
    clockListeners.delete(onChange)
    if (clockListeners.size === 0 && clockTimer !== null) {
      clearInterval(clockTimer)
      clockTimer = null
    }
  }
}

/** Cached: returning a fresh `Date.now()` here would loop forever. */
function clockSnapshot(): number {
  if (clockNow === 0) clockNow = Date.now()
  return clockNow
}

/** The server has no reader's clock, and says so rather than guessing. */
function clockServerSnapshot(): null {
  return null
}

/**
 * "3 days ago", with the exact instant available on hover and to assistive tech.
 *
 * ⚠️ THE RECENCY IS THE ANSWER; THE DATE IS THE EVIDENCE. Scanning a column of
 * "Aug 30, 2026" to work out which contacts have gone cold is arithmetic the
 * reader should not be doing. `title` and `dateTime` keep the precise value one
 * hover away, so nothing is lost — only the arithmetic.
 *
 * ⚠️ RELATIVE TO THE READER'S CLOCK, WHICH IS WHY THIS IS A CLIENT COMPONENT.
 * Computed on the server it would be relative to the server's clock in UTC and
 * could read "in 4 hours" for something that has already happened.
 */
export function RelativeTime({ iso }: { iso: string }) {
  // `null` until the browser has a clock. See the note on `subscribeToClock`.
  const now = useSyncExternalStore(subscribeToClock, clockSnapshot, clockServerSnapshot)

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null

  const exact = date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  if (now === null) {
    /*
     * The server pass and the first client pass. `suppressHydrationWarning`
     * is still needed because `toLocaleDateString` uses the SERVER's timezone
     * here — the same reason `LocalTime` above needs it — but the shape and
     * the reasoning are identical on both sides, so nothing flickers.
     */
    return (
      <time dateTime={iso} title={exact} suppressHydrationWarning>
        {date.toLocaleDateString(undefined, { dateStyle: 'medium' })}
      </time>
    )
  }

  const delta = now - date.getTime()

  let label: string
  if (delta < 0) {
    // A future timestamp is a data problem, not something to phrase as "ago".
    label = date.toLocaleDateString(undefined, { dateStyle: 'medium' })
  } else if (delta < MINUTE) {
    label = 'Just now'
  } else if (delta < HOUR) {
    const minutes = Math.floor(delta / MINUTE)
    label = `${minutes}m ago`
  } else if (delta < DAY) {
    label = `${Math.floor(delta / HOUR)}h ago`
  } else if (delta < 30 * DAY) {
    const days = Math.floor(delta / DAY)
    label = days === 1 ? 'Yesterday' : `${days}d ago`
  } else {
    // Past a month the exact date is more useful than "47d ago".
    label = date.toLocaleDateString(undefined, { dateStyle: 'medium' })
  }

  return (
    <time dateTime={iso} title={exact} suppressHydrationWarning>
      {label}
    </time>
  )
}
