'use client'

/**
 * "Search Lead List" + the date filter, as one control pair.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THE DATE COMES FIRST. THE LIST NARROWS TO IT.                           ║
 * ║                                                                          ║
 * ║  "All time" lists every extraction. Picking a range in the calendar cuts ║
 * ║  the dropdown down to the runs from those days. That ordering is the     ║
 * ║  whole point: an account with eighty extractions has an unusable         ║
 * ║  dropdown until a date narrows it.                                       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { DateRangePicker } from '@/components/intelligence/DateRangePicker'
import { batchLabel, batchesInRange, selectionStillValid } from '@/lib/intelligence/batches'
import type { LeadBatch } from '@/lib/intelligence/batches'
import { dateRangeBounds, formatRange } from '@/lib/intelligence/date-range'

export function BatchFilter({
  batches,
  selectedBatchId,
  onSelectBatch,
  from,
  to,
  onRangeChange,
  disabled,
}: {
  batches: LeadBatch[]
  selectedBatchId: string | null
  onSelectBatch: (id: string | null) => void
  from: string | null
  to: string | null
  onRangeChange: (from: string | null, to: string | null) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const bounds = from && to ? dateRangeBounds(from, to) : null
  const inRange = useMemo(() => batchesInRange(batches, bounds), [batches, bounds])

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return inRange
    return inRange.filter((batch) => batch.label.toLowerCase().includes(term))
  }, [inRange, query])

  /*
   * ⚠️ A SELECTION THAT SURVIVES ITS OWN FILTER IS A LIE. Narrowing the
   * calendar while a batch from outside the new range stays selected would run
   * research on leads the filter says are not there.
   */
  useEffect(() => {
    if (!selectionStillValid(selectedBatchId, inRange)) onSelectBatch(null)
  }, [inRange, selectedBatchId, onSelectBatch])

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

  const selected = batches.find((batch) => batch.id === selectedBatchId) ?? null

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <div ref={containerRef} className="relative flex-1">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="clay-sunken flex h-12 w-full items-center gap-3 px-4 text-left text-sm transition-colors duration-150 disabled:opacity-60"
        >
          <span aria-hidden className="text-muted">
            ⌕
          </span>
          <span className={selected ? 'flex-1 truncate text-ink' : 'flex-1 text-muted'}>
            {selected ? batchLabel(selected) : 'Search Lead List'}
          </span>
          {selected ? (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear selected list"
              onClick={(event) => {
                event.stopPropagation()
                onSelectBatch(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.stopPropagation()
                  onSelectBatch(null)
                }
              }}
              className="rounded-full px-1.5 text-muted transition-colors duration-150 hover:text-ink"
            >
              ✕
            </span>
          ) : null}
          <span aria-hidden className="text-muted">
            ▾
          </span>
        </button>

        {open ? (
          <div
            role="listbox"
            aria-label="Lead lists"
            /* Lenis hijacks page scroll; without this the list of 61 batches
               cannot be scrolled and only the first few are reachable. */
            data-lenis-prevent
            className="absolute left-0 right-0 top-full z-30 mt-2 max-h-80 overflow-y-auto rounded-[var(--radius-clay)] bg-clay-raised p-1.5 shadow-[var(--clay-shadow-lg)]"
          >
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by name…"
              aria-label="Filter lists by name"
              className="clay-sunken mb-1.5 h-9 w-full px-3 text-sm text-ink placeholder:text-muted"
            />

            {visible.length === 0 ? (
              /*
               * The empty state names the CAUSE. "No lists" when the account has
               * eighty of them, hidden by a date the user forgot they picked,
               * is the kind of dead end nobody debugs.
               */
              <p className="px-3 py-6 text-center text-xs text-muted">
                {batches.length === 0
                  ? 'No extractions yet. Run one to start.'
                  : bounds
                    ? `No lists extracted ${formatRange(from!, to!)}. Widen the date to see more.`
                    : 'No lists match that name.'}
              </p>
            ) : (
              visible.map((batch) => (
                <button
                  key={batch.id}
                  type="button"
                  role="option"
                  aria-selected={batch.id === selectedBatchId}
                  onClick={() => {
                    onSelectBatch(batch.id)
                    setOpen(false)
                  }}
                  className={`flex w-full flex-col gap-0.5 rounded-[var(--radius-lg)] px-3 py-2.5 text-left transition-colors duration-150 ${
                    batch.id === selectedBatchId ? 'bg-teal-soft' : 'hover:bg-clay-sunken'
                  }`}
                >
                  <span className="truncate text-sm font-medium text-ink">{batch.label}</span>
                  <span className="text-xs text-muted">
                    {batch.leadCount} lead{batch.leadCount === 1 ? '' : 's'} ·{' '}
                    {new Intl.DateTimeFormat('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                      timeZone: 'UTC',
                    }).format(new Date(batch.createdAt))}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      <div className="w-full sm:w-64">
        <DateRangePicker
          from={from}
          to={to}
          disabled={disabled}
          allTimeLabel="All time"
          onChange={onRangeChange}
        />
      </div>
    </div>
  )
}
