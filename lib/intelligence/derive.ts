/**
 * Derived intelligence — facts computed from facts already held.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ZERO API CALLS. ZERO COST. PURE ARITHMETIC.                             ║
 * ║                                                                          ║
 * ║  `research_evidence` is INSERT-ONLY: a newer observation is stored       ║
 * ║  beside the old one rather than replacing it. That was done so two       ║
 * ║  providers disagreeing stays inspectable — but it also means the table   ║
 * ║  is a TIME SERIES, and nobody has to be asked for a trend.               ║
 * ║                                                                          ║
 * ║  Headcount growth, tech churn, funding recency and company age all fall  ║
 * ║  out of data already paid for. This is the difference between more data  ║
 * ║  and more intelligence.                                                  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * PURE — no I/O, no clock except the one passed in.
 *
 * ⚠️ DERIVED FIELDS ARE NEVER ROUTED. No provider answers them, so asking the
 * router for one would produce a task nothing can serve and a spurious
 * `unknown`. They are computed by the runner after research, from history.
 */
import type { EvidenceRecord, NormalizedEvidence, ResearchField } from '@/lib/intelligence/types'

/**
 * Fields produced by computation rather than by a provider.
 *
 * `lib/intelligence/router.ts` filters these out before planning, and
 * `lib/intelligence/run.ts` computes them afterwards.
 */
export const DERIVED_FIELDS = [
  'employee_growth',
  'tech_churn',
  'company_age',
  'funding_recency',
] as const

export type DerivedField = (typeof DERIVED_FIELDS)[number]

const DAY_MS = 24 * 60 * 60 * 1000

/** Observations of one field, oldest first. */
function timeline(history: readonly EvidenceRecord[], field: ResearchField): EvidenceRecord[] {
  return history
    .filter((record) => record.field === field)
    .sort((a, b) => Date.parse(a.retrievedAt) - Date.parse(b.retrievedAt))
}

function readNumber(value: Record<string, unknown>, key: string): number | null {
  const raw = value[key]
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const parsed = Number.parseFloat(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function techIds(value: Record<string, unknown>): string[] {
  const detected = value.detected
  if (!Array.isArray(detected)) return []
  return detected
    .map((item) =>
      item && typeof item === 'object' && 'id' in item
        ? String((item as { id: unknown }).id)
        : typeof item === 'string'
          ? item
          : null,
    )
    .filter((id): id is string => Boolean(id))
}

export type DerivedFact = {
  field: DerivedField
  value: Record<string, unknown>
  confidence: number
  /** The observations this was computed from, so it can be audited. */
  basedOn: string[]
}

/**
 * Headcount change between the earliest and latest observation.
 *
 * ⚠️ REQUIRES TWO OBSERVATIONS AT DIFFERENT TIMES. A single reading is a
 * headcount, not a trend, and reporting it as 0% growth would be inventing a
 * fact about a company nobody has watched yet.
 *
 * ⚠️ Only observations from the SAME provider are compared. Apollo's estimate
 * and Prospeo's figure differ by method, so a change between them measures our
 * choice of vendor, not the company's hiring.
 */
export function deriveEmployeeGrowth(history: readonly EvidenceRecord[]): DerivedFact | null {
  const observations = timeline(history, 'employee_count')
  if (observations.length < 2) return null

  const byProvider = new Map<string, EvidenceRecord[]>()
  for (const record of observations) {
    const bucket = byProvider.get(record.sourceProvider) ?? []
    bucket.push(record)
    byProvider.set(record.sourceProvider, bucket)
  }

  // The provider that has watched this company longest.
  let best: { first: EvidenceRecord; last: EvidenceRecord; spanMs: number } | null = null
  for (const bucket of byProvider.values()) {
    if (bucket.length < 2) continue
    const first = bucket[0]!
    const last = bucket[bucket.length - 1]!
    const spanMs = Date.parse(last.retrievedAt) - Date.parse(first.retrievedAt)
    if (spanMs <= 0) continue
    if (!best || spanMs > best.spanMs) best = { first, last, spanMs }
  }

  if (!best) return null

  const from = readNumber(best.first.value, 'count')
  const to = readNumber(best.last.value, 'count')
  if (from === null || to === null || from <= 0) return null

  const change = to - from
  const days = Math.round(best.spanMs / DAY_MS)

  return {
    field: 'employee_growth',
    value: {
      from,
      to,
      change,
      percentChange: Math.round((change / from) * 1000) / 10,
      overDays: days,
      direction: change > 0 ? 'growing' : change < 0 ? 'shrinking' : 'flat',
    },
    // Two points on a noisy estimate is a weak signal, and it is labelled so.
    confidence: days >= 30 ? 0.7 : 0.5,
    basedOn: [best.first.id, best.last.id],
  }
}

/**
 * Technologies added or dropped between the two most recent observations.
 *
 * A company that just added HubSpot is a different prospect from one that has
 * had it for three years, and neither vendor sells that distinction.
 */
export function deriveTechChurn(history: readonly EvidenceRecord[]): DerivedFact | null {
  const observations = timeline(history, 'tech_stack')
  if (observations.length < 2) return null

  const previous = observations[observations.length - 2]!
  const latest = observations[observations.length - 1]!

  // Same-provider comparison only: two vendors detect different things, and a
  // difference between them is a difference in method, not in the company.
  if (previous.sourceProvider !== latest.sourceProvider) return null

  const before = new Set(techIds(previous.value))
  const after = new Set(techIds(latest.value))
  if (before.size === 0 && after.size === 0) return null

  const added = [...after].filter((id) => !before.has(id))
  const removed = [...before].filter((id) => !after.has(id))
  if (added.length === 0 && removed.length === 0) return null

  return {
    field: 'tech_churn',
    value: {
      added,
      removed,
      betweenDays: Math.round(
        (Date.parse(latest.retrievedAt) - Date.parse(previous.retrievedAt)) / DAY_MS,
      ),
    },
    confidence: 0.7,
    basedOn: [previous.id, latest.id],
  }
}

/**
 * How long ago the company was founded.
 *
 * Reads whichever origin date is known — an incorporation filing is preferred
 * over a self-reported founding year, being a public record.
 */
export function deriveCompanyAge(
  history: readonly EvidenceRecord[],
  now: Date = new Date(),
): DerivedFact | null {
  const sources: Array<{ field: ResearchField; key: string; confidence: number }> = [
    { field: 'incorporation_date', key: 'value', confidence: 0.95 },
    { field: 'incorporation_date', key: 'date', confidence: 0.95 },
  ]

  for (const source of sources) {
    const latest = timeline(history, source.field).at(-1)
    if (!latest) continue

    const raw = latest.value[source.key]
    const parsed = typeof raw === 'string' ? Date.parse(raw) : Number.NaN
    if (Number.isNaN(parsed)) continue

    /*
     * ⚠️ A YEAR-PRECISION ORIGIN IS NOT A DATE.
     *
     * Apollo reports `founded_year`; a registry reports a day. `Date.parse('2011')`
     * silently becomes 1 January, which would overstate the age of a company
     * founded in December by a full year. Year precision is subtracted as years
     * and flagged approximate rather than pretending to a day nobody stated.
     */
    const yearOnly = latest.value.precision === 'year'

    const years = yearOnly
      ? now.getUTCFullYear() - new Date(parsed).getUTCFullYear()
      : Math.floor((now.getTime() - parsed) / (365.25 * DAY_MS))

    if (years < 0 || years > 300) continue

    return {
      field: 'company_age',
      value: {
        years,
        foundedAt: yearOnly
          ? String(new Date(parsed).getUTCFullYear())
          : new Date(parsed).toISOString().slice(0, 10),
        ...(yearOnly ? { isApproximate: true } : {}),
      },
      // A self-reported year is not a filing, and the derived age inherits that.
      confidence: yearOnly ? 0.6 : source.confidence,
      basedOn: [latest.id],
    }
  }

  return null
}

/**
 * How recently the company raised, as a usable buying signal.
 *
 * "Raised 4 months ago" is what a seller acts on; a raw date makes them do the
 * arithmetic. The window labels match the ones the clarification flow offers.
 */
export function deriveFundingRecency(
  history: readonly EvidenceRecord[],
  now: Date = new Date(),
): DerivedFact | null {
  const latest = timeline(history, 'funding_date').at(-1)
  if (!latest) return null

  const raw =
    (typeof latest.value.raisedAt === 'string' && latest.value.raisedAt) ||
    (typeof latest.value.announcedAt === 'string' && latest.value.announcedAt) ||
    null
  if (!raw) return null

  const when = Date.parse(raw)
  if (Number.isNaN(when)) return null

  const months = Math.floor((now.getTime() - when) / (30.44 * DAY_MS))
  if (months < 0) return null

  const window =
    months <= 3 ? 'last_3_months' : months <= 6 ? 'last_6_months' : months <= 12 ? 'last_12_months' : months <= 18 ? 'last_18_months' : 'older'

  return {
    field: 'funding_recency',
    value: {
      monthsAgo: months,
      window,
      raisedAt: new Date(when).toISOString().slice(0, 10),
      // Carried through: an announcement date is not the round date, and a
      // filter on "raised in the last 3 months" should know which it has.
      isAnnouncementDate: latest.value.isAnnouncementDate === true,
    },
    // No better than the observation it was computed from.
    confidence: Math.min(latest.confidence, 0.8),
    basedOn: [latest.id],
  }
}

/**
 * Every derived fact computable from one company's evidence history.
 *
 * PURE. Returns only what the history actually supports — a company seen once
 * yields no trends, which is correct rather than disappointing.
 */
export function deriveAll(
  history: readonly EvidenceRecord[],
  now: Date = new Date(),
): DerivedFact[] {
  return [
    deriveEmployeeGrowth(history),
    deriveTechChurn(history),
    deriveCompanyAge(history, now),
    deriveFundingRecency(history, now),
  ].filter((fact): fact is DerivedFact => fact !== null)
}

/**
 * Turns derived facts into evidence.
 *
 * ⚠️ `sourceProvider` is `outlio-derived` and `sourceUrl` is null, deliberately.
 * These are OUR computations, not a third party's claim, and dressing them up
 * with someone else's name would misattribute them. `basedOn` records the
 * observations behind each one so the arithmetic can be re-checked.
 *
 * Confidence never exceeds that of the observations it came from — a trend
 * computed from a rough estimate is no firmer than the estimate.
 */
export function derivedEvidence(
  facts: readonly DerivedFact[],
  companyId: string,
  ttlFor: (field: ResearchField, at: Date) => Date | null,
  retrievedAt: Date = new Date(),
): NormalizedEvidence[] {
  return facts.map((fact) => ({
    field: fact.field as ResearchField,
    entityType: 'company' as const,
    entityId: companyId,
    value: { ...fact.value, basedOn: fact.basedOn },
    sourceProvider: 'outlio-derived',
    sourceUrl: null,
    // MEDIUM at best: arithmetic is exact, but its inputs are observations.
    sourceConfidence: 'medium' as const,
    confidence: fact.confidence,
    retrievedAt: retrievedAt.toISOString(),
    expiresAt: ttlFor(fact.field as ResearchField, retrievedAt)?.toISOString() ?? null,
  }))
}
