/**
 * The macro answer.
 *
 * PURE. No I/O, no clock beyond what the caller passes.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  A MACRO RUN THAT RETURNS ROWS HAS NOT ANSWERED A MACRO QUESTION.        ║
 * ║                                                                          ║
 * ║  "What is true of this set?" is not answered by 2,000 individual         ║
 * ║  records — that is the raw material for an answer, handed over unread.   ║
 * ║  This module turns the rows into the thing that was actually asked for:  ║
 * ║  distributions, concentration, coverage, and what the set does NOT say.  ║
 * ║                                                                          ║
 * ║  The rows still exist below it, because export and merge read from them. ║
 * ║  They are evidence for the analysis, not the analysis.                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ COVERAGE IS REPORTED AS LOUDLY AS THE FINDING. "68% are in software" is
 * a very different claim when industry is known for 900 of 1,000 leads than
 * when it is known for 40. A distribution over a thin slice looks exactly as
 * confident as one over a full set unless something says otherwise, so every
 * breakdown carries the base it was computed from. This is the same rule
 * `resolveConflict` follows: absence is a fact, and it is reported.
 */
import {
  RESEARCH_FIELD_SPEC,
  type EntityType,
  type ResearchField,
} from '@/lib/intelligence/types'

/**
 * ⚠️ STRUCTURAL, NOT IMPORTED. This deliberately does NOT depend on
 * `ResultRow`: the server's row and the client's row are different shapes, and
 * a pure aggregator should need only the parts it actually reads. Coupling it
 * to either one would force a cast at whichever boundary lost.
 */
type AnalysableCell = { state: 'known'; value: unknown } | { state: 'unknown' }

export type AnalysableRow = {
  companyId?: string | null
  companyName?: string | null
  fields: Record<string, AnalysableCell | undefined>
}

export type Distribution = {
  /** The column key. Typed as a plain string: this module aggregates whatever
      columns a run produced, and the client carries them as strings. */
  field: string
  /** Whether rows are counted as distinct people or distinct companies. */
  entity: EntityType
  /** Ranked, highest first. */
  buckets: Array<{ label: string; count: number; share: number }>
  /** Rows where this field was known. The denominator for `share`. */
  known: number
  /** Rows where we looked and could not find out. */
  unknown: number
  /** Distinct entities considered for this field. */
  base: number
  /** Distinct values seen. High cardinality means "varied", not "top-heavy". */
  distinct: number
  /**
   * Share held by the single largest bucket. The one number that says whether
   * this set is concentrated or scattered.
   */
  concentration: number
}

export type NumericSummary = {
  field: string
  entity: EntityType
  known: number
  unknown: number
  /** Distinct entities considered for this field. */
  base: number
  min: number
  median: number
  max: number
  /** Sum, where adding up is meaningful (headcount, award totals). */
  total: number
}

export type MacroAnalysis = {
  /** Rows the analysis was computed over. */
  leads: number
  /** Distinct companies behind those rows — the real base for company facts. */
  companies: number
  distributions: Distribution[]
  numerics: NumericSummary[]
  /**
   * Plain-language observations, each derived arithmetically from the data
   * above. ⚠️ NEVER MODEL-WRITTEN: a sentence a model invented about a
   * customer's data cannot be traced back to a number, and this file is the
   * one place the macro answer is allowed to come from.
   */
  headlines: string[]
}

/** Fields worth summing rather than bucketing. */
const NUMERIC_FIELDS = new Set<string>([
  'employee_count',
  'revenue_estimate',
  'funding_amount',
  'federal_awards_total',
  'federal_awards_count',
  'review_count',
  'review_rating',
  'company_age',
  'employee_growth',
])

/** Too granular to bucket usefully — a breakdown of 900 distinct values is noise. */
const UNBUCKETABLE = new Set<string>([
  'company_description',
  'registered_office',
  'sec_business_address',
  'company_number',
  'lei_number',
  'sec_cik',
  'sec_ein',
  'company_domain',
  'company_linkedin',
  'sec_website',
])

const MAX_BUCKETS = 8

function cellValue(cell: AnalysableCell | undefined): unknown {
  return cell && cell.state === 'known' ? cell.value : undefined
}

function fieldEntity(field: string): EntityType {
  return RESEARCH_FIELD_SPEC[field as ResearchField]?.entity ?? 'person'
}

/**
 * Company facts are researched once per company and must also be analysed once
 * per company. When the same company has several contacts, prefer a row with a
 * known value over an earlier unknown row; person facts remain one row per lead.
 */
function rowsForField(field: string, rows: readonly AnalysableRow[]): AnalysableRow[] {
  if (fieldEntity(field) !== 'company') return [...rows]

  const companies = new Map<string, AnalysableRow>()
  rows.forEach((row, index) => {
    const companyKey = row.companyId?.trim() || row.companyName?.trim().toLowerCase()
    const key = companyKey || `__unknown_company_row_${index}`
    const current = companies.get(key)
    if (!current) {
      companies.set(key, row)
      return
    }

    if (cellValue(current.fields[field]) === undefined && cellValue(row.fields[field]) !== undefined) {
      companies.set(key, row)
    }
  })

  return [...companies.values()]
}

/**
 * A displayable label for a bucket.
 *
 * Objects and arrays are flattened to their most identifying string rather
 * than stringified — `[object Object]` in a distribution is worse than
 * dropping the row, because it looks like a real category.
 */
function bucketLabels(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]

  if (Array.isArray(value)) {
    // A tech stack is many values on one lead; each counts once.
    return value.flatMap(bucketLabels)
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['name', 'industry', 'value', 'label', 'status', 'title']) {
      const candidate = record[key]
      if (typeof candidate === 'string' && candidate.trim()) return [candidate.trim()]
    }
    // Social maps and similar: the KEYS are the categories.
    const keys = Object.keys(record).filter((key) => {
      const entry = record[key]
      return typeof entry === 'string' && entry.trim().length > 0
    })
    return keys
  }

  return []
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const cleaned = value
      .trim()
      .replace(/\b(?:usd|eur|gbp|cad|aud|inr)\b/gi, '')
      .replace(/[,$€£¥_\s]/g, '')
    const match = cleaned.match(/^([-+]?\d*\.?\d+)([kmbt])?$/i)
    if (!match) return null
    const parsed = Number.parseFloat(match[1]!)
    if (!Number.isFinite(parsed)) return null
    const multiplier = { k: 1_000, m: 1_000_000, b: 1_000_000_000, t: 1_000_000_000_000 }[
      (match[2] ?? '').toLowerCase() as 'k' | 'm' | 'b' | 't'
    ] ?? 1
    return parsed * multiplier
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['amount', 'value', 'count', 'total', 'rating']) {
      const found = numericValue(record[key])
      if (found !== null) return found
    }
  }
  return null
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!
}

function distributionFor(field: string, rows: readonly AnalysableRow[]): Distribution | null {
  if (UNBUCKETABLE.has(field)) return null

  const entity = fieldEntity(field)
  const entities = rowsForField(field, rows)

  const counts = new Map<string, number>()
  let known = 0
  let unknown = 0

  for (const row of entities) {
    const value = cellValue(row.fields[field])
    if (value === undefined) {
      unknown += 1
      continue
    }
    const labels = [...new Set(bucketLabels(value))]
    if (labels.length === 0) {
      unknown += 1
      continue
    }
    known += 1
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  if (known === 0) return null

  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ label, count, share: count / known }))

  return {
    field,
    entity,
    buckets: ranked.slice(0, MAX_BUCKETS),
    known,
    unknown,
    base: entities.length,
    distinct: counts.size,
    concentration: ranked[0]?.share ?? 0,
  }
}

function numericFor(field: string, rows: readonly AnalysableRow[]): NumericSummary | null {
  const entity = fieldEntity(field)
  const entities = rowsForField(field, rows)
  const values: number[] = []
  let unknown = 0

  for (const row of entities) {
    const parsed = numericValue(cellValue(row.fields[field]))
    if (parsed === null) unknown += 1
    else values.push(parsed)
  }

  if (values.length === 0) return null
  values.sort((a, b) => a - b)

  return {
    field,
    entity,
    known: values.length,
    unknown,
    base: entities.length,
    min: values[0]!,
    median: median(values),
    max: values[values.length - 1]!,
    total: values.reduce((sum, value) => sum + value, 0),
  }
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`
}

function fieldLabel(field: string): string {
  return field.replace(/_/g, ' ')
}

/**
 * Observations, derived arithmetically.
 *
 * ⚠️ EVERY SENTENCE HERE IS A RESTATEMENT OF A NUMBER ABOVE IT. Nothing is
 * inferred, predicted or embellished — CLAUDE.md rule 4 applies to prose about
 * the data exactly as it applies to a cell.
 */
function buildHeadlines(
  distributions: readonly Distribution[],
  numerics: readonly NumericSummary[],
): string[] {
  const lines: string[] = []

  for (const distribution of distributions.slice(0, 3)) {
    const top = distribution.buckets[0]
    if (!top) continue
    const base = `${distribution.known} of ${distribution.base} ${distribution.entity === 'company' ? 'companies' : 'leads'}`
    const knownBase = `${percent(top.share)} of ${distribution.entity === 'company' ? 'companies' : 'leads'} with known ${fieldLabel(distribution.field)}`
    if (distribution.concentration >= 0.5) {
      lines.push(
        `${knownBase} share one value: ${top.label} (${base} known).`,
      )
    } else if (distribution.distinct >= 8) {
      lines.push(
        `${fieldLabel(distribution.field)} is spread across ${distribution.distinct} values; among known records, the largest is ${top.label} at ${percent(top.share)} (${base} known).`,
      )
    } else {
      lines.push(
        `Among known records, the most common ${fieldLabel(distribution.field)} is ${top.label} at ${percent(top.share)} (${base} known).`,
      )
    }
  }

  for (const numeric of numerics.slice(0, 2)) {
    lines.push(
      `${fieldLabel(numeric.field)} runs ${numeric.min} to ${numeric.max}, median ${numeric.median} (${numeric.known} of ${numeric.base} ${numeric.entity === 'company' ? 'companies' : 'leads'} known).`,
    )
  }

  /*
   * ⚠️ THE THINNEST FIELD IS NAMED OUT LOUD. A breakdown over 40 of 1,000
   * leads renders identically to one over 900 unless something says so, and a
   * reader who does not notice will act on a number that is not there.
   */
  const thinnest = [...distributions].sort((a, b) => a.known - b.known)[0]
  if (thinnest && thinnest.base > 0 && thinnest.known / thinnest.base < 0.5) {
    lines.push(
      `Thin evidence: ${fieldLabel(thinnest.field)} is known for only ${thinnest.known} of ${thinnest.base} ${thinnest.entity === 'company' ? 'companies' : 'leads'}. Treat its breakdown as indicative, not representative.`,
    )
  }

  return lines
}

/**
 * Turns a finished macro run into the analysis that was actually asked for.
 *
 * Distributions are ordered by how much they say — a field where one value
 * dominates, or which is spread widely, is more informative than one where
 * everything is a near-tie.
 */
export function analyseRun(
  columns: readonly string[],
  rows: readonly AnalysableRow[],
): MacroAnalysis {
  const distributions: Distribution[] = []
  const numerics: NumericSummary[] = []

  for (const field of columns) {
    if (NUMERIC_FIELDS.has(field)) {
      const summary = numericFor(field, rows)
      if (summary) numerics.push(summary)
      continue
    }
    const distribution = distributionFor(field, rows)
    if (distribution) distributions.push(distribution)
  }

  // Most-concentrated first: "80% use HubSpot" outranks a four-way tie.
  distributions.sort((a, b) => b.concentration - a.concentration || b.known - a.known)

  const companies = new Set(
    rows.map((row) => row.companyId ?? row.companyName).filter(Boolean) as string[],
  ).size

  return {
    leads: rows.length,
    companies,
    distributions,
    numerics,
    headlines: buildHeadlines(distributions, numerics),
  }
}

export type Coverage = {
  field: string
  known: number
  total: number
  share: number
  /** Below this, a breakdown of the field is indicative at best. */
  thin: boolean
}

/** Anything known for less than half the set is called thin. */
const THIN_COVERAGE = 0.5

/**
 * How much of the set each column actually covers.
 *
 * ⚠️ THE THINNEST COLUMN COMES FIRST, deliberately. Coverage sorted best-first
 * is a reassurance exercise; the useful question is always "what is this
 * analysis weakest on?" — and that is the column a reader is most likely to
 * over-trust.
 */
export function coverageOf(analysis: MacroAnalysis): Coverage[] {
  const entries: Coverage[] = [
    ...analysis.distributions.map((d) => ({ field: d.field, known: d.known, total: d.base })),
    ...analysis.numerics.map((n) => ({ field: n.field, known: n.known, total: n.base })),
  ].map(({ field, known, total }) => ({
    field,
    known,
    total,
    share: total === 0 ? 0 : known / total,
    thin: total > 0 && known / total < THIN_COVERAGE,
  }))

  return entries.sort((a, b) => a.share - b.share || a.field.localeCompare(b.field))
}

export type BucketDelta = {
  label: string
  shareA: number
  shareB: number
  /** `shareB - shareA`, or null when the comparison would be misleading. */
  delta: number | null
}

export type FieldComparison = {
  field: string
  knownA: number
  knownB: number
  totalA: number
  totalB: number
  /**
   * True when either side is too thinly covered for a delta to mean anything.
   * Every `delta` is then null — the buckets are still shown, because the
   * shares themselves are real; only the SUBTRACTION is suppressed.
   */
  unreliable: boolean
  buckets: BucketDelta[]
}

/**
 * Compares two analyses of the same field set.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ A DELTA BETWEEN TWO DIFFERENT COVERAGE LEVELS IS AN ARTEFACT.        ║
 * ║                                                                          ║
 * ║  If industry is known for 90% of list A and 20% of list B, "B is 30%     ║
 * ║  less software" is a statement about what we FAILED TO FIND, not about   ║
 * ║  the companies. It is indistinguishable from a real difference on        ║
 * ║  screen, so the subtraction is withheld rather than annotated — a        ║
 * ║  caveat under a big number does not stop anyone believing the number.    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
export function compareAnalyses(a: MacroAnalysis, b: MacroAnalysis): FieldComparison[] {
  const byField = (analysis: MacroAnalysis) =>
    new Map(analysis.distributions.map((d) => [d.field, d]))

  const left = byField(a)
  const right = byField(b)
  const fields = [...left.keys()].filter((field) => right.has(field))

  return fields.map((field) => {
    const da = left.get(field)!
    const db = right.get(field)!

    const shareA = new Map(da.buckets.map((bucket) => [bucket.label, bucket.share]))
    const shareB = new Map(db.buckets.map((bucket) => [bucket.label, bucket.share]))

    const coverA = da.base === 0 ? 0 : da.known / da.base
    const coverB = db.base === 0 ? 0 : db.known / db.base
    const unreliable = coverA < THIN_COVERAGE || coverB < THIN_COVERAGE

    const labels = [...new Set([...shareA.keys(), ...shareB.keys()])]
    const buckets = labels
      .map((label) => {
        const valueA = shareA.get(label) ?? 0
        const valueB = shareB.get(label) ?? 0
        return {
          label,
          shareA: valueA,
          shareB: valueB,
          delta: unreliable ? null : valueB - valueA,
        }
      })
      .sort((x, y) => Math.abs(y.shareB - y.shareA) - Math.abs(x.shareB - x.shareA))

    return {
      field,
      knownA: da.known,
      knownB: db.known,
      totalA: da.base,
      totalB: db.base,
      unreliable,
      buckets,
    }
  })
}

/** Rows for the analysis CSV. Shaped here so the writer stays generic. */
export function analysisCsvRows(
  analysis: MacroAnalysis,
): Array<Record<string, string | number>> {
  const rows: Array<Record<string, string | number>> = []

  for (const distribution of analysis.distributions) {
    for (const bucket of distribution.buckets) {
      rows.push({
        field: distribution.field,
        value: bucket.label,
        count: bucket.count,
        share_percent: Math.round(bucket.share * 1000) / 10,
        known: distribution.known,
        entity: distribution.entity,
        total_entities: distribution.base,
      })
    }
  }

  for (const numeric of analysis.numerics) {
    rows.push({
      field: numeric.field,
      /*
       * ⚠️ NO SYMBOLS IN A CSV CELL. This read "min 10 · median 20 · max 300".
       * A middle dot in a spreadsheet is not a separator anyone can filter,
       * sort or split on, and it renders differently across locales and fonts.
       * Numbers get their own columns; words do the joining.
       */
      value: `min ${numeric.min}, median ${numeric.median}, max ${numeric.max}`,
      count: numeric.known,
      share_percent: numeric.base === 0 ? 0 : Math.round((numeric.known / numeric.base) * 1000) / 10,
      known: numeric.known,
      entity: numeric.entity,
      total_entities: numeric.base,
    })
  }

  return rows
}
