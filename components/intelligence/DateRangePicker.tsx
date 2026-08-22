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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverPosition, setPopoverPosition] = useState<{
    left: number
    top: number
    width: number
    maxHeight: number
  } | null>(null)

  const [cursor, setCursor] = useState(() => {
    const anchor = from ? new Date(`${from}T00:00:00.000Z`) : new Date()
    return { year: anchor.getUTCFullYear(), month: anchor.getUTCMonth() }
  })

  // Click-away and Escape. A popover that traps the user is worse than none.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        !containerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false)
      }
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

  const positionPopover = useCallback(() => {
    const trigger = triggerRef.current
    const popover = popoverRef.current
    if (!trigger || !popover) return

    const viewportPadding = 12
    const gap = 8
    const triggerRect = trigger.getBoundingClientRect()
    const width = Math.min(304, window.innerWidth - viewportPadding * 2)

    /*
     * Sticky/fixed headers reserve the top edge of the viewport. Reading their
     * actual bounds also handles browser zoom and the compact mobile header;
     * a hard-coded 64px value is what allowed the account menu to cover June.
     */
    const headerBottom = Array.from(document.querySelectorAll('header')).reduce(
      (bottom, header) => {
        const position = window.getComputedStyle(header).position
        if (position !== 'sticky' && position !== 'fixed') return bottom
        const rect = header.getBoundingClientRect()
        return rect.top <= viewportPadding ? Math.max(bottom, rect.bottom) : bottom
      },
      viewportPadding,
    )
    const safeTop = Math.min(headerBottom + viewportPadding, triggerRect.top - gap)
    const spaceAbove = Math.max(0, triggerRect.top - gap - safeTop)
    const spaceBelow = Math.max(0, window.innerHeight - triggerRect.bottom - gap - viewportPadding)
    const naturalHeight = popover.scrollHeight
    const openAbove = spaceAbove >= Math.min(naturalHeight, 240) || spaceAbove >= spaceBelow
    const maxHeight = Math.max(1, openAbove ? spaceAbove : spaceBelow)
    const visibleHeight = Math.min(naturalHeight, maxHeight)
    const top = openAbove
      ? Math.max(safeTop, triggerRect.top - gap - visibleHeight)
      : triggerRect.bottom + gap
    const left = Math.min(
      Math.max(viewportPadding, triggerRect.right - width),
      window.innerWidth - width - viewportPadding,
    )

    setPopoverPosition({ left, top, width, maxHeight })
  }, [])

  useLayoutEffect(() => {
    if (!open) return

    positionPopover()
    window.addEventListener('resize', positionPopover)
    window.addEventListener('scroll', positionPopover, true)
    return () => {
      window.removeEventListener('resize', positionPopover)
      window.removeEventListener('scroll', positionPopover, true)
    }
  }, [open, cursor, positionPopover])

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

  // ONE month. Two filled the popover to 34rem, which is what pushed the
  // next-month arrow off screen in the first place; a single month keeps the
  // whole control inside the viewport at any width.
  const months = [cursor]

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={
          allTimeLabel
            ? 'clay-interactive hubble-filter-control hubble-filter-date flex h-12 w-full cursor-pointer items-center gap-2.5 px-4 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60'
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

      {open && typeof document !== 'undefined' ? createPortal(
        <div
          ref={popoverRef}
          data-lenis-prevent
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
          className="fixed z-[60] overflow-y-auto overscroll-contain rounded-[var(--radius-clay)] bg-clay-raised p-3 shadow-[var(--clay-shadow-lg)] [scrollbar-gutter:stable]"
          style={popoverPosition ? {
            left: popoverPosition.left,
            top: popoverPosition.top,
            width: popoverPosition.width,
            maxHeight: popoverPosition.maxHeight,
          } : {
            left: 0,
            top: 0,
            width: 304,
            visibility: 'hidden',
          }}
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

            <p className="text-sm font-semibold text-ink">
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

          <div className="grid gap-4">
            {months.map(({ year, month }) => (
              <div key={`${year}-${month}`}>
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
                            ? 'hubble-selected-option font-semibold'
                            : inRange
                              ? 'bg-clay-sunken text-ink'
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
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
