/**
 * Turning what a user typed into a criterion value.
 *
 * PURE — no I/O, so every operator's parsing is testable without a form.
 *
 * The rule: **a value that cannot be parsed is an error, never a default.**
 * Silently coercing "ten to fifty" into `[0, 0]` would produce a profile that
 * scores confidently against criteria the user never expressed, and nobody
 * would find out until a list came back wrong.
 */
import type { CriterionOperator } from '@/lib/qualification/score'

export type ParsedValue =
  | { ok: true; value: unknown }
  | { ok: false; reason: string }

/** Operators that compare against nothing — the field simply has to be present. */
const VALUELESS: readonly CriterionOperator[] = ['exists']

/** Operators taking a list. A single entry is a list of one. */
const LIST_OPERATORS: readonly CriterionOperator[] = ['in', 'not_in']

/** Operators taking a number. */
const NUMERIC_OPERATORS: readonly CriterionOperator[] = ['gte', 'lte']

export function parseCriterionValue(
  operator: CriterionOperator,
  raw: string,
): ParsedValue {
  const input = raw.trim()

  if (VALUELESS.includes(operator)) return { ok: true, value: null }

  if (input.length === 0) {
    return { ok: false, reason: 'Enter a value to compare against.' }
  }

  if (operator === 'between') {
    // "10-50", "10,50" and "10 to 50" are all things people type.
    const parts = input
      .split(/\s*(?:-|–|,|to)\s*/i)
      .map((part) => part.trim())
      .filter(Boolean)

    if (parts.length !== 2) {
      return { ok: false, reason: 'Enter a range, for example 10-50.' }
    }

    const low = Number.parseFloat(parts[0]!)
    const high = Number.parseFloat(parts[1]!)

    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      return { ok: false, reason: 'A range must be two numbers, for example 10-50.' }
    }
    if (low > high) {
      return { ok: false, reason: 'The first number must be the smaller one.' }
    }

    return { ok: true, value: [low, high] }
  }

  if (NUMERIC_OPERATORS.includes(operator)) {
    // Tolerate what people paste from a pitch deck: "$5M", "5,000,000", "50k".
    const numeric = parseHumanNumber(input)
    if (numeric === null) {
      return { ok: false, reason: 'Enter a number, for example 5000000 or 5M.' }
    }
    return { ok: true, value: numeric }
  }

  if (LIST_OPERATORS.includes(operator)) {
    const items = input
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

    if (items.length === 0) {
      return { ok: false, reason: 'Enter one or more values, separated by commas.' }
    }
    return { ok: true, value: items }
  }

  // equals / not_equals / contains / not_contains: plain text.
  return { ok: true, value: input }
}

/**
 * Reads a number a human would write.
 *
 * Returns `null` rather than guessing — "a few million" is not a number, and
 * treating it as one would silently misprice a criterion.
 */
export function parseHumanNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$£€,\s]/g, '')
  if (!cleaned) return null

  const match = /^(\d+(?:\.\d+)?)(k|m|mm|bn|b)?$/i.exec(cleaned)
  if (!match) return null

  const base = Number.parseFloat(match[1]!)
  if (!Number.isFinite(base)) return null

  const multipliers: Record<string, number> = {
    k: 1e3,
    m: 1e6,
    mm: 1e6,
    b: 1e9,
    bn: 1e9,
  }

  const suffix = match[2]?.toLowerCase()
  return Math.round(base * (suffix ? (multipliers[suffix] ?? 1) : 1))
}

/** Human-readable hint shown under the value input for each operator. */
export function valueHint(operator: CriterionOperator): string {
  switch (operator) {
    case 'exists':
      return 'No value needed — the field just has to be known.'
    case 'between':
      return 'A range, for example 10-50'
    case 'gte':
      return 'A number, for example 5M'
    case 'lte':
      return 'A number, for example 50'
    case 'in':
    case 'not_in':
      return 'Comma-separated, for example Seed, Series A'
    default:
      return 'Text to match, for example software'
  }
}
