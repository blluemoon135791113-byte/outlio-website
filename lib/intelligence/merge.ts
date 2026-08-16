/**
 * Merging a research run's results onto the leads they came from.
 *
 * PURE — shaping only. `lib/intelligence/merge-store.ts` performs the write.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WHAT THIS IS FOR.                                                       ║
 * ║                                                                          ║
 * ║  Research answers a question on screen. Merging makes the answer part of ║
 * ║  the lead, so the next CSV or CRM push carries it without anyone         ║
 * ║  re-running anything.                                                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ ONLY `known` CELLS ARE MERGED. An `unknown` cell means we looked and could
 * not find out; writing it as an empty column would turn "we don't know" into
 * "they don't have one" the moment it reached a CRM, and nobody downstream
 * could tell the difference. Unknowns are counted and reported, never stored.
 *
 * ⚠️ COMPANY FACTS FAN OUT TO EVERY LEAD AT THAT COMPANY, deliberately. Six
 * contacts at Acme each get Acme's industry, because a CRM row is a person and
 * the person's row is where a seller reads it.
 */
import type { RunResults } from '@/lib/intelligence/results'
import type { ResearchField } from '@/lib/intelligence/types'

/** One merged field, with enough provenance to trace a wrong value back. */
export type MergedField = {
  value: unknown
  provider: string
  sourceUrl: string | null
  runId: string
  mergedAt: string
}

/** The `enrichment` patch for one lead, keyed by research field. */
export type LeadEnrichmentPatch = Record<string, MergedField>

export type MergePlan = {
  /** Keyed by lead id. Only leads with at least one known cell appear. */
  byLead: Record<string, LeadEnrichmentPatch>
  leadIds: string[]
  /** Cells that were merged. */
  mergedCells: number
  /** Cells skipped because nothing was found. Reported, never written. */
  unknownCells: number
  /** Fields that ended up on at least one lead, in column order. */
  fields: ResearchField[]
}

/**
 * Builds the patch for a finished run.
 *
 * Restricting to `fields` lets a user merge the email column without also
 * merging eleven firmographic columns they were only browsing.
 */
export function buildMergePlan(
  results: Pick<RunResults, 'runId' | 'columns' | 'rows'>,
  options: { fields?: readonly ResearchField[]; leadIds?: readonly string[]; now?: Date } = {},
): MergePlan {
  const mergedAt = (options.now ?? new Date()).toISOString()

  const wanted = options.fields
    ? results.columns.filter((column) => options.fields!.includes(column))
    : results.columns

  const onlyLeads = options.leadIds ? new Set(options.leadIds) : null

  const byLead: Record<string, LeadEnrichmentPatch> = {}
  const fieldsSeen = new Set<ResearchField>()
  let mergedCells = 0
  let unknownCells = 0

  for (const row of results.rows) {
    if (onlyLeads && !onlyLeads.has(row.leadId)) continue

    const patch: LeadEnrichmentPatch = {}

    for (const field of wanted) {
      const cell = row.fields[field]
      if (!cell) continue

      if (cell.state !== 'known') {
        unknownCells += 1
        continue
      }

      patch[field] = {
        value: cell.value,
        provider: cell.sourceProvider,
        sourceUrl: cell.sourceUrl,
        runId: results.runId,
        mergedAt,
      }
      fieldsSeen.add(field)
      mergedCells += 1
    }

    // A lead whose every cell came back unknown is left untouched rather than
    // stamped with an empty object that would read as "enriched".
    if (Object.keys(patch).length > 0) byLead[row.leadId] = patch
  }

  return {
    byLead,
    leadIds: Object.keys(byLead),
    mergedCells,
    unknownCells,
    fields: wanted.filter((field) => fieldsSeen.has(field)),
  }
}

/**
 * Flattens a stored enrichment value into a single export cell.
 *
 * ⚠️ A CSV CELL IS A STRING, AND A LOSSY ONE. Evidence values are objects whose
 * shape differs per provider — `{ email }`, `{ count, isEstimate }`,
 * `{ detected: [...] }`. Rendering `[object Object]` into a CRM is the failure
 * this function exists to prevent.
 *
 * The single-meaningful-key case is unwrapped, because `{ email: "…" }` in a
 * column headed "Work Email" should be the address, not JSON.
 */
export function flattenEnrichmentValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  if (Array.isArray(value)) {
    const parts = value.map((item) => flattenEnrichmentValue(item)).filter(Boolean)
    return parts.length > 0 ? parts.join('; ') : null
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>

    // Metadata about the value, not the value. `isEstimate` qualifies a count;
    // it is not something to print in a column of its own.
    const METADATA = new Set([
      'basedOn',
      'coverage',
      'isEstimate',
      'isTotalFunding',
      'isAnnouncementDate',
      'isFoundingYear',
      'isApproximate',
      'precision',
      'currency',
      'source',
    ])

    const entries = Object.entries(record).filter(
      ([key, item]) => !METADATA.has(key) && item !== null && item !== undefined,
    )

    if (entries.length === 0) return null
    if (entries.length === 1) return flattenEnrichmentValue(entries[0]![1])

    const parts = entries
      .map(([key, item]) => {
        const flat = flattenEnrichmentValue(item)
        return flat ? `${key}: ${flat}` : null
      })
      .filter(Boolean)

    return parts.length > 0 ? parts.join(' | ') : null
  }

  return null
}

/**
 * Words to upper-case whole in a column header.
 *
 * An explicit list, not a length rule: "≤3 characters" would render
 * `company_age` as "Company AGE".
 */
const HEADER_ACRONYMS = new Set(['sec', 'cik', 'ein', 'lei', 'sic', 'url', 'ceo', 'us', 'uk'])

/** Column header for a merged field, e.g. `work_email` → `Work Email`. */
export function enrichmentColumnHeader(field: string): string {
  return field
    .split('_')
    .filter(Boolean)
    .map((word) =>
      HEADER_ACRONYMS.has(word) ? word.toUpperCase() : word[0]!.toUpperCase() + word.slice(1),
    )
    .join(' ')
}

/**
 * Reads a stored `enrichment` object into flat export cells.
 *
 * Tolerant of anything: this is read back out of JSONB written by an older
 * build, so a shape that does not match is skipped rather than thrown on.
 */
export function enrichmentCells(enrichment: unknown): Record<string, string> {
  if (!enrichment || typeof enrichment !== 'object' || Array.isArray(enrichment)) return {}

  const cells: Record<string, string> = {}

  for (const [field, entry] of Object.entries(enrichment as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue

    const flat = flattenEnrichmentValue((entry as { value?: unknown }).value)
    if (flat) cells[enrichmentColumnHeader(field)] = flat
  }

  return cells
}

/**
 * Every enrichment column present across a set of leads, in a STABLE order.
 *
 * Sorted rather than first-seen: a CSV whose columns reorder between two
 * exports of the same data breaks whatever the customer built on top of it.
 */
export function enrichmentColumns(
  leads: ReadonlyArray<{ enrichment?: unknown }>,
): string[] {
  const columns = new Set<string>()

  for (const lead of leads) {
    for (const header of Object.keys(enrichmentCells(lead.enrichment))) {
      columns.add(header)
    }
  }

  return [...columns].sort()
}
