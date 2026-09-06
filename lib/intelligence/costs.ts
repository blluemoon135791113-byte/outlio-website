/**
 * Cost accounting (spec §23).
 *
 * PURE. Every amount is an INTEGER NUMBER OF MICROS — millionths of one USD.
 *
 * Floating point has no place in a ledger. Provider prices are routinely
 * fractions of a cent, and summing 460 of them as floats accumulates error that
 * later shows up as a margin nobody can reconcile.
 */

/** 1 USD. */
export const MICROS_PER_UNIT = 1_000_000

export function toMicros(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) return 0
  return Math.round(amount * MICROS_PER_UNIT)
}

export function fromMicros(micros: number): number {
  return micros / MICROS_PER_UNIT
}

/** For display. Never used to compute a total. */
export function formatMicros(micros: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(fromMicros(micros))
}

export function sumMicros(values: readonly number[]): number {
  let total = 0
  for (const value of values) {
    if (Number.isFinite(value) && value > 0) total += Math.trunc(value)
  }
  return total
}

export type CostEstimate = {
  totalMicros: number
  byCategory: Record<string, number>
  taskCount: number
}

/**
 * Sums per-task estimates into the number shown before a job runs.
 *
 * This is an UPPER BOUND: it assumes every task reaches a provider. A waterfall
 * that stops at the first provider costs less, and a task served from cache
 * never appears here at all. Quote it as a maximum, never as the price —
 * the same discipline `estimatedCreditCostForFiles` already applies to
 * extraction.
 */
export function estimateTotal(
  estimates: readonly { category: string; micros: number }[],
): CostEstimate {
  const byCategory: Record<string, number> = {}
  let totalMicros = 0

  for (const estimate of estimates) {
    const micros = Number.isFinite(estimate.micros) && estimate.micros > 0
      ? Math.trunc(estimate.micros)
      : 0
    byCategory[estimate.category] = (byCategory[estimate.category] ?? 0) + micros
    totalMicros += micros
  }

  return { totalMicros, byCategory, taskCount: estimates.length }
}

/**
 * Whether a job fits inside a remaining allowance.
 *
 * `null` means no limit is configured — the same convention `plans.limits` uses
 * throughout the codebase.
 */
export function withinBudget(
  estimatedMicros: number,
  remainingMicros: number | null,
): boolean {
  if (remainingMicros === null) return true
  return estimatedMicros <= remainingMicros
}
