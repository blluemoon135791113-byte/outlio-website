/**
 * Turning a picked calendar range into a timestamp filter.
 *
 * PURE. Shared by the scope resolver and the pre-flight estimate so the count
 * a user is shown and the leads actually researched can never disagree.
 */

/**
 * The half-open interval `[fromInclusive, toExclusive)` for a picked range.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE OFF-BY-ONE-DAY TRAP.                                             ║
 * ║                                                                          ║
 * ║  A user picking "1 Aug to 14 Aug" in a calendar means the WHOLE of the   ║
 * ║  14th. Filtering `created_at <= '2026-08-14'` compares against midnight  ║
 * ║  at the START of the 14th and silently drops every lead extracted that   ║
 * ║  day — a whole day of work missing from a run, with nothing to show that ║
 * ║  anything was excluded.                                                  ║
 * ║                                                                          ║
 * ║  The upper bound is therefore the NEXT midnight, and exclusive.          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Reversed inputs are swapped rather than rejected: dragging a calendar
 * backwards is a normal way to pick a range, not an error.
 */
export function dateRangeBounds(
  from: string,
  to: string,
): { fromInclusive: string; toExclusive: string } | null {
  const start = Date.parse(`${from}T00:00:00.000Z`)
  const end = Date.parse(`${to}T00:00:00.000Z`)

  if (Number.isNaN(start) || Number.isNaN(end)) return null

  const [low, high] = start <= end ? [start, end] : [end, start]

  return {
    fromInclusive: new Date(low).toISOString(),
    // The next midnight. Exclusive, so the last day is fully included.
    toExclusive: new Date(high + 24 * 60 * 60 * 1000).toISOString(),
  }
}

/** `YYYY-MM-DD` for a date, in UTC — the same calendar the bounds use. */
export function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Whether a string is a calendar date this module can use. */
export function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
}

/** Inclusive day count, for showing what a picked range covers. */
export function dayCount(from: string, to: string): number {
  const bounds = dateRangeBounds(from, to)
  if (!bounds) return 0

  return Math.round(
    (Date.parse(bounds.toExclusive) - Date.parse(bounds.fromInclusive)) / (24 * 60 * 60 * 1000),
  )
}

/** A readable label, e.g. `1 Aug 2026 – 14 Aug 2026`. */
export function formatRange(from: string, to: string): string {
  const format = (value: string) =>
    new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${value}T00:00:00.000Z`))

  const [low, high] = Date.parse(from) <= Date.parse(to) ? [from, to] : [to, from]
  return low === high ? format(low) : `${format(low)} – ${format(high)}`
}

/**
 * The days to render for a month grid, padded to whole weeks.
 *
 * `null` is a leading or trailing blank. Weeks start on Monday, matching the
 * `en-GB` formatting used everywhere else in the product.
 */
export function monthGrid(year: number, month: number): Array<string | null> {
  const first = new Date(Date.UTC(year, month, 1))
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()

  // getUTCDay is 0=Sunday; shift so Monday is 0.
  const leading = (first.getUTCDay() + 6) % 7

  const cells: Array<string | null> = Array(leading).fill(null)
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(toDateInput(new Date(Date.UTC(year, month, day))))
  }

  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

/** Whether `day` falls inside the picked range, for highlighting the grid. */
export function isWithinRange(day: string, from: string | null, to: string | null): boolean {
  if (!from || !to) return false
  const [low, high] = from <= to ? [from, to] : [to, from]
  return day >= low && day <= high
}
