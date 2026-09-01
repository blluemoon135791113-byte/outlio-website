'use client'

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
