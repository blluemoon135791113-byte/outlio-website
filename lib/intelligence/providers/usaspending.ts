import 'server-only'

/**
 * USAspending.gov — US federal award spending.
 *
 * Official government data, free, no key. Spec §17 puts a government filing at
 * HIGH source confidence, and this is the primary record of what the US federal
 * government actually obligated to a company.
 *
 * WHAT IT IS FOR: a buying signal, not a firmographic. "This company holds
 * $5.1bn in federal contracts" tells you something no marketing site will.
 *
 * ⚠️ COVERAGE IS NARROW BY NATURE. Only US federal contractors and grant
 * recipients appear. On a Sales Navigator list of small B2B SaaS companies most
 * will legitimately return nothing, and that is a fact about the company, not a
 * failure. It earns its place because it is free and authoritative, not because
 * it will hit often.
 *
 * ⚠️ THE MATCHING TRAP. `autocomplete/recipient` is a substring search: asking
 * for "Palantir" returns "LONELY MOUNTAIN PALANTIR ENTERPRISES" beside
 * "PALANTIR TECHNOLOGIES INC.", and the response's `uei` is frequently null so
 * there is no id to disambiguate with. Attributing another company's federal
 * contracts to a lead would be a serious, confident error, so a candidate's
 * name must normalize to EXACTLY the company's before it is considered.
 */
import { normalizeCompanyName } from '@/lib/companies/normalize'
import { requestJson, setHostPacing, ProviderHttpError } from '@/lib/intelligence/http'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import type {
  IntelligenceProvider,
  NormalizedEvidence,
  ResearchField,
  ResearchTask,
} from '@/lib/intelligence/types'

const USASPENDING_HOST = 'api.usaspending.gov'
const BASE = `https://${USASPENDING_HOST}/api/v2`

/** A free public service funded by taxpayers. Pace it like a guest. */
setHostPacing(USASPENDING_HOST, 400)

/** The API refuses searches before this date. */
const EARLIEST_SEARCH_DATE = '2007-10-01'

/** Spending is published on a rolling basis; a month-old answer is fine. */
export const USASPENDING_FIELDS: readonly ResearchField[] = [
  'federal_awards_total',
  'federal_awards_count',
  'federal_award_types',
  'federal_recipient_name',
]

type RecipientMatch = { recipient_name?: string; uei?: string | null }
type AutocompleteResponse = { results?: RecipientMatch[] }

type SummaryResponse = {
  results?: { prime_awards_count?: number; prime_awards_obligation_amount?: number }
}

type AwardCountResponse = {
  results?: Record<string, number>
}

export type UsaSpendingFacts = {
  recipientName: string
  awardCount: number
  obligatedAmount: number
  awardTypes: Record<string, number>
}

/**
 * Selects every federal registration belonging to this company.
 *
 * PURE. The filter is strict — a candidate's normalized name must EQUAL the
 * company's — which is what keeps "LONELY MOUNTAIN PALANTIR ENTERPRISES" out
 * when the company is "Palantir".
 *
 * ⚠️ MULTIPLE MATCHES ARE NOT AMBIGUITY HERE. Everything surviving that filter
 * already normalizes to the same name, so extra rows are duplicate
 * registrations of one company, not rival candidates. Booz Allen Hamilton files
 * under five (`… INC.`, `… INC`, `… HOLDING CORPORATION`, …), and an earlier
 * version refused them all as "ambiguous", reporting a company with $91bn in
 * federal contracts as having none.
 *
 * They are returned as a SET, but only ONE is ever sent to the search — see
 * `searchKeyword`. The `keywords` filter is AND, not OR.
 */
export function pickRecipients(
  companyName: string | null,
  candidates: readonly RecipientMatch[],
): string[] {
  const target = normalizeCompanyName(companyName)
  if (!target) return []

  const names = candidates
    .map((candidate) => candidate.recipient_name)
    .filter((name): name is string => Boolean(name))
    .filter((name) => normalizeCompanyName(name) === target)

  return [...new Set(names)]
}

/**
 * The single keyword to search with.
 *
 * ⚠️ `filters.keywords` IS AND, NOT OR. Sending every registration of Booz
 * Allen Hamilton returned 52 awards and a NEGATIVE total, against 128,168
 * awards and $91.6bn for any one of them alone. Measured, not assumed.
 *
 * The search itself is a substring match, so the SHORTEST verified
 * registration is the most inclusive: `BOOZ ALLEN HAMILTON INC` also catches
 * `BOOZ ALLEN HAMILTON INC.`. It is still the company's full name, so it
 * cannot sweep in the unrelated companies that a bare `Palantir` would.
 */
export function searchKeyword(recipientNames: readonly string[]): string | null {
  if (recipientNames.length === 0) return null
  return [...recipientNames].sort((a, b) => a.length - b.length)[0]!
}

/** Drops the zero buckets so a result reads as what was actually awarded. */
export function summariseAwardTypes(results: Record<string, number> | undefined): Record<string, number> {
  const types: Record<string, number> = {}
  for (const [key, value] of Object.entries(results ?? {})) {
    if (typeof value === 'number' && value > 0) types[key] = value
  }
  return types
}

/**
 * Builds evidence from the spending figures.
 *
 * PURE. Returns `[]` when the company holds no federal awards — an absence of
 * contracts is not something to record as a fact about them.
 */
export function usaSpendingEvidence(
  facts: UsaSpendingFacts | null,
  companyId: string,
  requested: readonly ResearchField[],
  retrievedAt: Date = new Date(),
): NormalizedEvidence[] {
  if (!facts || facts.awardCount <= 0) return []

  const wanted = new Set(requested)
  const evidence: NormalizedEvidence[] = []

  const push = (field: ResearchField, value: Record<string, unknown>, confidence: number) => {
    if (!wanted.has(field)) return
    evidence.push({
      field,
      entityType: 'company',
      entityId: companyId,
      value,
      sourceProvider: 'usaspending',
      // The public record for this recipient. A user can check the number.
      sourceUrl: `https://www.usaspending.gov/search?hash=&keywords=${encodeURIComponent(facts.recipientName)}`,
      // Government filing — spec §17's definition of HIGH.
      sourceConfidence: 'high',
      confidence,
      retrievedAt: retrievedAt.toISOString(),
      expiresAt: expiresAtFor(field, retrievedAt)?.toISOString() ?? null,
    })
  }

  push('federal_recipient_name', { value: facts.recipientName }, 0.9)
  push(
    'federal_awards_total',
    { amount: facts.obligatedAmount, currency: 'USD', since: EARLIEST_SEARCH_DATE },
    0.9,
  )
  push('federal_awards_count', { count: facts.awardCount }, 0.9)

  if (Object.keys(facts.awardTypes).length > 0) {
    push('federal_award_types', { value: facts.awardTypes }, 0.85)
  }

  return evidence
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>({ url: `${BASE}${path}`, method: 'POST', body, timeoutMs: 30_000 })
}

async function lookup(companyName: string): Promise<UsaSpendingFacts | null> {
  const autocomplete = await post<AutocompleteResponse>('/autocomplete/recipient/', {
    search_text: companyName,
    limit: 10,
  })

  const recipientNames = pickRecipients(companyName, autocomplete.results ?? [])
  const keyword = searchKeyword(recipientNames)
  if (!keyword) return null

  const timePeriod = [{ start_date: EARLIEST_SEARCH_DATE, end_date: today() }]

  /*
   * ONE keyword, taken from a verified registration — never the user's raw
   * company name, which would sweep in unrelated recipients, and never the
   * whole set, because this filter ANDs.
   */
  const summary = await post<SummaryResponse>('/search/transaction_spending_summary/', {
    filters: { keywords: [keyword], time_period: timePeriod },
  })

  const count = summary.results?.prime_awards_count ?? 0
  if (count <= 0) return null

  const byType = await post<AwardCountResponse>('/search/spending_by_award_count/', {
    filters: { keywords: [keyword], time_period: timePeriod },
    subawards: false,
  })

  return {
    recipientName: keyword,
    awardCount: count,
    obligatedAmount: summary.results?.prime_awards_obligation_amount ?? 0,
    awardTypes: summariseAwardTypes(byType.results),
  }
}

/** A company with no federal awards is a miss, not an outage. */
async function safeLookup(companyName: string): Promise<UsaSpendingFacts | null> {
  try {
    return await lookup(companyName)
  } catch (error) {
    if (error instanceof ProviderHttpError && error.code === 'ERR_PROVIDER_REJECTED') {
      return null
    }
    throw error
  }
}

export const usaSpendingProvider: IntelligenceProvider<UsaSpendingFacts | null> = {
  name: 'usaspending',
  category: 'company_profile',

  canHandle: (task: ResearchTask) =>
    task.entity.type === 'company' &&
    Boolean(task.entity.name) &&
    task.fields.some((field) => USASPENDING_FIELDS.includes(field)),

  // Free public API. The cost is latency and courtesy, not money.
  estimateCost: async () => 0,

  execute: (task) => safeLookup((task.entity as { name: string | null }).name ?? ''),

  normalize: (facts, task) => usaSpendingEvidence(facts, task.entity.id, task.fields),
}
