/**
 * The qualification engine (spec §18, §19).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  PURE, AND DELIBERATELY SO. THE SCORE IS ARITHMETIC, NOT AN OPINION.     ║
 * ║                                                                          ║
 * ║  The LLM never produces this number. Providers supply facts, this file   ║
 * ║  computes the score, and the model may only explain the result           ║
 * ║  afterwards. The same lead with the same evidence and the same profile   ║
 * ║  must always score identically — otherwise nobody can defend a list to   ║
 * ║  the person who has to call it.                                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * The rule that shapes everything below: **UNKNOWN IS NOT FAILURE.** A company
 * we could not research has not failed a criterion — we simply do not know. It
 * is reported separately, and it can never be silently scored as a zero, which
 * would quietly bury every company with thin public data.
 */
import type { FieldKnowledge } from '@/lib/intelligence/evidence'
import { evidenceKey } from '@/lib/intelligence/evidence'
import type { EntityType, ResearchField } from '@/lib/intelligence/types'

export const CRITERION_OPERATORS = [
  'equals',
  'not_equals',
  'in',
  'not_in',
  'between',
  'gte',
  'lte',
  'contains',
  'not_contains',
  'exists',
] as const

export type CriterionOperator = (typeof CRITERION_OPERATORS)[number]

/**
 * How a criterion affects the outcome.
 *
 *   required  — failing it disqualifies the lead outright, whatever the score
 *   preferred — contributes its weight to the score
 *   excluded  — matching it disqualifies the lead (a negative filter)
 */
export const CRITERION_KINDS = ['required', 'preferred', 'excluded'] as const
export type CriterionKind = (typeof CRITERION_KINDS)[number]

export type Criterion = {
  id: string
  field: ResearchField
  operator: CriterionOperator
  value?: unknown
  /** Points contributed when satisfied. Ignored for `excluded`. */
  weight: number
  kind: CriterionKind
  /** Where in the evidence value to look, e.g. `count` or `detected`. */
  valuePath?: string
}

export type QualificationProfile = {
  id: string
  name: string
  criteria: Criterion[]
}

export type CriterionOutcome = 'met' | 'not_met' | 'unknown'

export type CriterionResult = {
  criterionId: string
  field: ResearchField
  outcome: CriterionOutcome
  /** Points awarded. Always 0 unless `outcome` is `met`. */
  points: number
  /** The observed value, for the "why qualified?" explanation (spec §33). */
  observed?: unknown
  sourceUrl?: string | null
}

export type QualificationResult = {
  entityId: string
  entityType: EntityType
  /** 0–100. Normalised over the criteria that could actually be evaluated. */
  score: number
  qualified: boolean
  /** Set when a required criterion failed or an excluded one matched. */
  disqualifiedBy: string | null
  results: CriterionResult[]
  /** Criteria that could not be evaluated because evidence was missing. */
  unknownCount: number
}

/** Reads a value out of an evidence payload, honouring an optional path. */
function readObserved(value: Record<string, unknown>, path?: string): unknown {
  if (!path) {
    /*
     * Payload keys the providers actually emit, most specific first.
     *
     * ⚠️ `detected` is load-bearing. Tech-stack evidence is
     * `{ detected: [...], coverage, scannedUrl }`, and omitting it here meant a
     * rule like "excluded: uses Salesforce" compared against the whole wrapper
     * object, found nothing, and excluded NOBODY — silently, on the exact query
     * the spec leads with (§54).
     */
    for (const key of [
      'value',
      'detected',
      'count',
      'amount',
      'domain',
      'industry',
      'headquarters',
      'round',
      'investors',
      'roles',
    ]) {
      if (key in value) return value[key]
    }
    return value
  }

  return path.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object' && segment in (current as object)) {
      return (current as Record<string, unknown>)[segment]
    }
    return undefined
  }, value)
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function asComparableStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value.toLowerCase()]
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value).toLowerCase()]
  if (Array.isArray(value)) return value.flatMap(asComparableStrings)
  if (value && typeof value === 'object') {
    // Technology lists arrive as [{ id, name, category }]; match on either.
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key === 'id' || key === 'name')
      .flatMap(([, inner]) => asComparableStrings(inner))
  }
  return []
}

/**
 * Evaluates one criterion against one observed value.
 *
 * PURE and total: returns `unknown` rather than throwing on any shape it does
 * not understand, because a comparison we cannot make is not a failed one.
 */
export function evaluateCriterion(criterion: Criterion, observed: unknown): CriterionOutcome {
  if (observed === undefined || observed === null) {
    return criterion.operator === 'exists' ? 'not_met' : 'unknown'
  }

  const asStrings = asComparableStrings(observed)
  const target = criterion.value

  switch (criterion.operator) {
    case 'exists':
      return 'met'

    case 'equals':
      return asComparableStrings(target).some((t) => asStrings.includes(t)) ? 'met' : 'not_met'

    case 'not_equals':
      return asComparableStrings(target).some((t) => asStrings.includes(t)) ? 'not_met' : 'met'

    case 'in':
      return asComparableStrings(target).some((t) => asStrings.includes(t)) ? 'met' : 'not_met'

    case 'not_in':
      return asComparableStrings(target).some((t) => asStrings.includes(t)) ? 'not_met' : 'met'

    case 'contains':
      return asComparableStrings(target).every((t) => asStrings.some((s) => s.includes(t)))
        ? 'met'
        : 'not_met'

    case 'not_contains':
      return asComparableStrings(target).some((t) => asStrings.some((s) => s.includes(t)))
        ? 'not_met'
        : 'met'

    case 'gte': {
      const left = asNumber(observed)
      const right = asNumber(target)
      if (left === null || right === null) return 'unknown'
      return left >= right ? 'met' : 'not_met'
    }

    case 'lte': {
      const left = asNumber(observed)
      const right = asNumber(target)
      if (left === null || right === null) return 'unknown'
      return left <= right ? 'met' : 'not_met'
    }

    case 'between': {
      const left = asNumber(observed)
      const bounds = Array.isArray(target) ? target.map(asNumber) : []
      const [low, high] = bounds
      if (left === null || low === null || low === undefined || high === null || high === undefined) {
        return 'unknown'
      }
      return left >= low && left <= high ? 'met' : 'not_met'
    }
  }
}

/**
 * Scores one entity against a profile.
 *
 * ⚠️ THE SCORE IS NORMALISED OVER WHAT COULD BE EVALUATED, not over every
 * criterion in the profile. A company with six of eight criteria researched is
 * scored out of those six. Scoring it out of eight would punish it for our
 * missing data rather than for its own attributes — which is how a good-fit
 * company with a thin public footprint silently drops off a list.
 *
 * `unknownCount` is reported so a caller can say "scored on 6 of 8 criteria"
 * instead of presenting a suspiciously precise number.
 */
export function scoreEntity(
  profile: QualificationProfile,
  entity: { id: string; type: EntityType },
  knowledge: ReadonlyMap<string, FieldKnowledge>,
  options: { qualifyAtOrAbove?: number } = {},
): QualificationResult {
  const results: CriterionResult[] = []
  let earned = 0
  let available = 0
  let unknownCount = 0
  let disqualifiedBy: string | null = null

  for (const criterion of profile.criteria) {
    const known = knowledge.get(evidenceKey(entity.type, entity.id, criterion.field))

    if (!known || known.state !== 'known') {
      unknownCount += 1
      results.push({
        criterionId: criterion.id,
        field: criterion.field,
        outcome: 'unknown',
        points: 0,
      })
      // An unknown REQUIRED criterion does not disqualify. We do not know that
      // it failed, and asserting otherwise would be fabricating a negative.
      continue
    }

    const observed = readObserved(known.record.value, criterion.valuePath)
    const outcome = evaluateCriterion(criterion, observed)

    if (outcome === 'unknown') {
      unknownCount += 1
      results.push({
        criterionId: criterion.id,
        field: criterion.field,
        outcome: 'unknown',
        points: 0,
        observed,
        sourceUrl: known.record.sourceUrl,
      })
      continue
    }

    const weight = Math.max(0, criterion.weight)

    if (criterion.kind === 'excluded') {
      // A negative filter: matching it is disqualifying, and it contributes no
      // points either way.
      if (outcome === 'met' && !disqualifiedBy) disqualifiedBy = criterion.id
      results.push({
        criterionId: criterion.id,
        field: criterion.field,
        outcome,
        points: 0,
        observed,
        sourceUrl: known.record.sourceUrl,
      })
      continue
    }

    available += weight
    const points = outcome === 'met' ? weight : 0
    earned += points

    if (criterion.kind === 'required' && outcome === 'not_met' && !disqualifiedBy) {
      disqualifiedBy = criterion.id
    }

    results.push({
      criterionId: criterion.id,
      field: criterion.field,
      outcome,
      points,
      observed,
      sourceUrl: known.record.sourceUrl,
    })
  }

  // No evaluable criterion means no score. Zero would read as "bad fit"; this
  // is "we know nothing", and `unknownCount` says so.
  const score = available === 0 ? 0 : Math.round((earned / available) * 100)
  const threshold = options.qualifyAtOrAbove ?? 0

  return {
    entityId: entity.id,
    entityType: entity.type,
    score,
    qualified: disqualifiedBy === null && available > 0 && score >= threshold,
    disqualifiedBy,
    results,
    unknownCount,
  }
}

/**
 * A short, factual explanation of a result (spec §33).
 *
 * Built from the evaluated criteria, never written by a model — so the reason
 * shown always matches the arithmetic that produced the score.
 */
export function explainResult(result: QualificationResult): string[] {
  const lines: string[] = []

  for (const criterion of result.results) {
    if (criterion.outcome === 'met') {
      lines.push(`${criterion.field} = ${formatObserved(criterion.observed)}`)
    }
  }

  if (result.disqualifiedBy) {
    lines.unshift(`Disqualified by ${result.disqualifiedBy}`)
  }

  if (result.unknownCount > 0) {
    lines.push(`${result.unknownCount} criteria could not be checked (unknown)`)
  }

  return lines
}

function formatObserved(value: unknown): string {
  if (value === undefined || value === null) return 'unknown'
  if (typeof value === 'object') {
    const strings = asComparableStrings(value)
    return strings.length > 0 ? strings.join(', ') : JSON.stringify(value)
  }
  return String(value)
}
