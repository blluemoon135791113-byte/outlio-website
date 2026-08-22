/**
 * Canonical, deterministic constraints recovered from the user's own words.
 *
 * The LLM proposes a plan, but an explicit "Series A" or "more than one
 * investor" must not disappear because one model chose a vague filter key.
 * These functions never invent criteria; they only preserve criteria that are
 * literally present in the question or normalize an equivalent model value.
 */
import type { ResearchPlan } from '@/lib/intelligence/plan'

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

function numberFrom(value: string): number | null {
  const numeric = Number.parseInt(value, 10)
  if (Number.isSafeInteger(numeric)) return numeric
  return NUMBER_WORDS[value.toLowerCase()] ?? null
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function subtractUtc(now: Date, amount: number, unit: 'day' | 'week' | 'month'): string {
  const date = new Date(now)
  if (unit === 'month') date.setUTCMonth(date.getUTCMonth() - amount)
  else date.setUTCDate(date.getUTCDate() - amount * (unit === 'week' ? 7 : 1))
  return isoDay(date)
}

function fundedAfterFromText(value: string, now: Date): string | null {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null

  if (/\bthis week\b/.test(normalized)) {
    const monday = new Date(now)
    const day = monday.getUTCDay()
    monday.setUTCDate(monday.getUTCDate() - (day === 0 ? 6 : day - 1))
    return isoDay(monday)
  }

  const match = /\b(?:past|last)?\s*(\d+)\s*(day|week|month)s?\b/.exec(normalized)
  if (!match) return null
  const amount = Number.parseInt(match[1]!, 10)
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 120) return null
  return subtractUtc(now, amount, match[2] as 'day' | 'week' | 'month')
}

/** Adds only explicit constraints and ensures their evidence fields are routed. */
export function preserveExplicitConstraints(
  question: string,
  plan: ResearchPlan,
  now: Date = new Date(),
): ResearchPlan {
  const filters: Record<string, unknown> = { ...plan.filters }
  const required = new Set(plan.requiredFields)

  if (/\b(?:saas|software[- ]as[- ]a[- ]service)\b/i.test(question)) {
    filters.business_model = 'SaaS'
    required.add('business_model')
  }

  const hiringIntent = /\b(?:hiring|hires?|recruiting|open roles?|job openings?)\b/i.test(question)
  if (hiringIntent) {
    required.add('hiring_signals')
    const roles = new Set<string>()
    if (/\b(?:sdrs?|sales development representatives?)\b/i.test(question)) roles.add('sdr')
    if (/\b(?:account executives?|aes?)\b/i.test(question)) roles.add('account executive')
    if (/\b(?:business development representatives?|bdrs?)\b/i.test(question)) roles.add('business development')
    if (roles.size > 0) filters.hiring_roles = [...roles]
  }

  const round = /\bseries\s+([a-j])\b/i.exec(question)
  if (round) {
    filters.funding_round = `Series ${round[1]!.toUpperCase()}`
    required.add('funding_round')
  }

  const moreThan = /\bmore than\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+investors?\b/i.exec(
    question,
  )
  const atLeast = /\bat least\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+investors?\b/i.exec(
    question,
  )
  if (moreThan || atLeast) {
    const parsed = numberFrom((moreThan ?? atLeast)![1]!)
    if (parsed !== null) {
      filters.minimum_investor_count = parsed + (moreThan ? 1 : 0)
      required.add('funding_investors')
    }
  }

  const explicitDate = fundedAfterFromText(question, now)
  const modelDate = [filters.timeframe, filters.recency_timeframe, filters.funding_window]
    .find((value): value is string => typeof value === 'string')
  const fundedAfter = explicitDate ?? (modelDate ? fundedAfterFromText(modelDate, now) : null)
  if (fundedAfter) {
    filters.funded_after = fundedAfter
    required.add('funding_date')
  }

  return { ...plan, requiredFields: [...required], filters }
}

export function searxngTimeRange(filters: Readonly<Record<string, unknown>>):
  | 'day'
  | 'week'
  | 'month'
  | 'year'
  | undefined {
  if (typeof filters.funded_after !== 'string') return undefined
  const ageDays = (Date.now() - Date.parse(filters.funded_after)) / 86_400_000
  if (!Number.isFinite(ageDays)) return undefined
  if (ageDays <= 1) return 'day'
  if (ageDays <= 7) return 'week'
  if (ageDays <= 31) return 'month'
  return 'year'
}
