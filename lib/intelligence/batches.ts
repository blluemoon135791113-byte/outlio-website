/**
 * Lead batches — one extraction run, as the Hubble filter sees it.
 *
 * PURE. The store lives in `batches-store.ts`.
 *
 * THE FILTER CHAIN. The date comes first and the batch list narrows to it:
 * "All time" lists every extraction, and picking a range in the calendar cuts
 * the dropdown down to the runs from those days. That ordering is the whole
 * point — an account with 80 extractions has an unusable dropdown until a date
 * narrows it.
 */

export type LeadBatch = {
  id: string
  /** Filename-derived where possible, else the run id. */
  label: string
  leadCount: number
  /** ISO timestamp of the extraction. */
  createdAt: string
}

/**
 * A batch's display name: what it is, and exactly when it ran.
 *
 * The time matters. Someone who extracted three lists this morning has three
 * entries that would otherwise be identical, and picking the wrong one means
 * researching the wrong 25 people.
 */
export function batchLabel(batch: Pick<LeadBatch, 'label' | 'leadCount' | 'createdAt'>): string {
  const when = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(new Date(batch.createdAt))

  return `${batch.label} · ${batch.leadCount} lead${batch.leadCount === 1 ? '' : 's'} · ${when}`
}

/**
 * Batches that fall inside a picked range.
 *
 * A null range means "All time" and everything passes. Bounds come from
 * `dateRangeBounds`, so the last day is fully included here too — a batch
 * extracted at 16:00 on the closing day must not vanish because the filter
 * compared against that morning's midnight.
 */
export function batchesInRange(
  batches: readonly LeadBatch[],
  bounds: { fromInclusive: string; toExclusive: string } | null,
): LeadBatch[] {
  if (!bounds) return [...batches]

  const from = Date.parse(bounds.fromInclusive)
  const to = Date.parse(bounds.toExclusive)

  return batches.filter((batch) => {
    const at = Date.parse(batch.createdAt)
    return !Number.isNaN(at) && at >= from && at < to
  })
}

/**
 * Whether a chosen batch is still valid under the current date range.
 *
 * ⚠️ A SELECTION THAT SURVIVES ITS OWN FILTER IS A LIE. Narrowing the calendar
 * while a batch from outside the new range stays selected would run research on
 * leads the filter says are not there. The caller clears it.
 */
export function selectionStillValid(
  selectedId: string | null,
  visible: readonly LeadBatch[],
): boolean {
  if (!selectedId) return true
  return visible.some((batch) => batch.id === selectedId)
}
