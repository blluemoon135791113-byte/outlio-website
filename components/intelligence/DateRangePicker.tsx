'use client'

/**
 * A two-month calendar for picking a lead date range.
 *
 * Opens above the control it belongs to, because the scope row sits high in
 * the console and a popover below it would be clipped by the panel edge.
 *
 * No dependency: a date-picker library is a lot of bytes for one popover, and
 * the range logic it would bring is already in `lib/intelligence/date-range.ts`
 * where it is unit-tested against the off-by-one-day trap.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  formatRange,
  isWithinRange,
  monthGrid,
  toDateInput,
} from '@/lib/intelligence/date-range'

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month, 1)))
}

export function DateRangePicker({
  from,
  to,
  onChange,
  disabled,
  allTimeLabel,
}: {
  from: string | null
  to: string | null
  onChange: (from: string | null, to: string | null) => void
  disabled?: boolean
  /** Shown when no range is picked. "All time" on Hubble; a prompt elsewhere. */
  allTimeLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const today = useMemo(() => toDateInput(new Date()), [])
  const containerRef = useRef<HTMLDivElement>(null)

  const [cursor, setCursor] = useState(() => {
    const anchor = from ? new Date(`${from}T00:00:00.000Z`) : new Date()
    return { year: anchor.getUTCFullYear(), month: anchor.getUTCMonth() }
  })

  // Click-away and Escape. A popover that traps the user is worse than none.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  /*
   * One click starts a range, the next completes it, the third starts over.
   * Picking the earlier day second is normal — `dateRangeBounds` orders the
   * pair, so the calendar does not have to scold anyone about direction.
   */
  const pick = (day: string) => {
    if (!from || (from && to)) {
      onChange(day, null)
      return
    }
    onChange(from, day)
    setOpen(false)
  }

  const shiftMonth = (delta: number) => {
    setCursor((current) => {
      const next = new Date(Date.UTC(current.year, current.month + delta, 1))
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() }
    })
  }

  const label =
    from && to
      ? formatRange(from, to)
      : from
        ? `${formatRange(from, from)} – …`
        : (allTimeLabel ?? 'Pick dates')

  /*
   * ⚠️ FORWARD STOPS AT THE PRESENT.
   *
   * Leads cannot be extracted in the future, so every day beyond today is
   * already disabled. Without this the arrow happily walks into 2027, where the
   * calendar is entirely dead and there is nothing to explain why. The left
   * panel is the cursor and the right is cursor+1, so the stop is when the
   * cursor reaches the current month.
   */
  const now = new Date()
  const atPresent =
    cursor.year > now.getUTCFullYear() ||
    (cursor.year === now.getUTCFullYear() && cursor.month >= now.getUTCMonth())

  const months = [
    cursor,
    (() => {
      const next = new Date(Date.UTC(cursor.year, cursor.month + 1, 1))
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() }
    })(),
  ]

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={
          allTimeLabel
            ? 'clay-sunken flex h-12 w-full items-center gap-2.5 px-4 text-left text-sm transition-colors duration-150 disabled:opacity-60'
            : 'mt-1 flex h-9 w-full items-center justify-between rounded-[var(--radius-md)] border border-border bg-paper px-2 text-left text-sm text-ink transition-colors duration-150 hover:border-border-strong disabled:opacity-60'
        }
      >
        {allTimeLabel ? (
          <span aria-hidden className="text-muted">
            ▦
          </span>
        ) : null}
        <span className={from ? 'flex-1 text-ink' : 'flex-1 text-muted'}>{label}</span>
        <span aria-hidden className="ml-2 text-muted">
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose a date range"
          /*
           * Above the trigger: the scope row sits near the top of the console
           * panel, and a popover below it is clipped by the panel edge.
           */
          /*
           * ⚠️ ANCHORED RIGHT, AND CAPPED TO THE VIEWPORT.
           *
           * Anchored left it ran off the screen: the trigger sits at the right
           * of the filter row, the panel is 34rem wide, and the NEXT-MONTH
           * arrow — which lives at the panel's right edge — was rendered past
           * the window. The calendar looked like it could only go backwards.
           */
          className="absolute bottom-full right-0 z-30 mb-2 w-[19rem] max-w-[calc(100vw-2rem)] rounded-[var(--radius-clay)] bg-clay-raised p-3 shadow-[var(--clay-shadow-lg)] sm:w-[34rem]"
        >
          <div className="flex items-center justify-between px-1 pb-2.5">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="clay-interactive inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[var(--radius-md)] bg-clay-surface text-sm text-ink shadow-[var(--clay-shadow-chip)] active:scale-[0.94]"
            >
              <span aria-hidden>‹</span>
            </button>

            {/* Named here as well as per column: with two months on screen the
                arrows are far apart, and the header says what they move. */}
            <p className="text-xs font-medium text-muted sm:hidden">
              {monthLabel(cursor.year, cursor.month)}
            </p>

            <button
              type="button"
              onClick={() => shiftMonth(1)}
              disabled={atPresent}
              aria-label="Next month"
              title={atPresent ? 'Leads cannot be extracted in the future' : undefined}
              className="clay-interactive inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[var(--radius-md)] bg-clay-surface text-sm text-ink shadow-[var(--clay-shadow-chip)] active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none disabled:active:scale-100"
            >
              <span aria-hidden>›</span>
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {months.map(({ year, month }, index) => (
              <div key={`${year}-${month}`} className={index === 1 ? 'hidden sm:block' : undefined}>
                <p className="pb-1.5 text-center text-xs font-semibold text-ink">
                  {monthLabel(year, month)}
                </p>

                <div className="grid grid-cols-7 gap-0.5">
                  {WEEKDAYS.map((day, dayIndex) => (
                    <span
                      key={`${day}-${dayIndex}`}
                      aria-hidden
                      className="pb-1 text-center text-[10px] font-semibold uppercase text-muted"
                    >
                      {day}
                    </span>
                  ))}

                  {monthGrid(year, month).map((day, cellIndex) => {
                    if (!day) return <span key={`blank-${cellIndex}`} />

                    const isEdge = day === from || day === to
                    const inRange = isWithinRange(day, from, to)
                    // Leads cannot be extracted in the future, so a future day
                    // is a range that can only ever return nothing.
                    const isFuture = day > today

                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => pick(day)}
                        disabled={isFuture}
                        aria-pressed={isEdge}
                        className={[
                          'clay-interactive h-7 cursor-pointer rounded-[var(--radius-sm)] text-xs',
                          isEdge
                            ? 'bg-accent font-semibold text-white'
                            : inRange
                              ? 'bg-accent-soft text-ink'
                              : 'text-ink',
                          isFuture ? 'cursor-not-allowed text-muted opacity-40 hover:bg-transparent' : '',
                        ].join(' ')}
                      >
                        {Number(day.slice(8, 10))}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
            <button
              type="button"
              onClick={() => onChange(null, null)}
              className="cursor-pointer text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
            >
              Clear
            </button>
            <p className="text-xs text-muted">
              {from && !to ? 'Now pick the end date' : 'Click a start and an end date'}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
