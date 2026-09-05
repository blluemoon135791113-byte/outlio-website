import 'server-only'

/**
 * Funding, derived from news coverage.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS IS NOT A FUNDING DATABASE.                                         ║
 * ║                                                                          ║
 * ║  There is no Crunchbase or Harmonic here. Every number below is read     ║
 * ║  out of a sentence in a retrieved article, and is therefore:             ║
 * ║                                                                          ║
 * ║    • always MEDIUM source confidence, never HIGH                         ║
 * ║    • always accompanied by the URL it was read from                      ║
 * ║    • absent entirely when no article states it                           ║
 * ║                                                                          ║
 * ║  It answers "has this company been reported as raising?" — not "what is  ║
 * ║  this company's complete funding history?". Coverage is whatever the     ║
 * ║  press wrote about, which is thin for small and non-US companies.        ║
 * ║  Do not present it as authoritative.                                     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Extraction is DETERMINISTIC — regex over the source text. The LLM is never
 * the origin of a number (spec §5: it must not fabricate funding).
 */
import { normalizeCompanyName } from '@/lib/companies/normalize'
import { searchTimeRange } from '@/lib/intelligence/filters'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import type {
  CompanyEntity,
  IntelligenceProvider,
  NormalizedEvidence,
  ResearchTask,
} from '@/lib/intelligence/types'
import { hasWebSearch, serpSearch } from '@/lib/search'
import { gdeltSearch } from './gdelt'
import { hasTavilyCredentials, tavilySearch, type SearchResult } from './tavily'

/** An article must look like a funding announcement before anything is read. */
const FUNDING_TERMS = [
  'raise',
  'raised',
  'raises',
  'raising',
  'funding',
  'funding round',
  'investment round',
  'led by',
  'closes',
  'closed a',
  'secures',
  'secured',
]

const ROUND_PATTERNS: Array<{ pattern: RegExp; round: string }> = [
  { pattern: /\bpre[-\s]?seed\b/i, round: 'Pre-Seed' },
  { pattern: /\bseed\s+(?:round|funding|financing)\b/i, round: 'Seed' },
  { pattern: /\bseries\s+([a-j])\b/i, round: 'Series' },
  { pattern: /\bseed\b/i, round: 'Seed' },
]

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
}

const MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
}

export type FundingFacts = {
  round: string | null
  amount: number | null
  currency: string | null
  /** The announcement date. A proxy for the round date, and labelled as such. */
  announcedAt: string | null
  investors: string[]
  sourceUrl: string
  sourceTitle: string
}

/** Search result publication date, kept conservative and deterministic. */
export function extractAnnouncementDate(
  document: Pick<SearchResult, 'title' | 'content' | 'url' | 'publishedDate'>,
  now: Date = new Date(),
): string | null {
  if (document.publishedDate) {
    const parsed = Date.parse(document.publishedDate)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }

  const text = `${document.title} ${document.content}`
  // Relative ages are trustworthy only when the search engine prefixes the
  // snippet with them. An arbitrary "three days ago" inside article prose may
  // describe the funding event rather than the publication date.
  const relative = /^\s*(\d{1,3})\s+(hour|day|week)s?\s+ago\b/i.exec(document.content)
  if (relative) {
    const amount = Number.parseInt(relative[1]!, 10)
    const date = new Date(now)
    date.setUTCHours(
      date.getUTCHours() - amount * (relative[2]!.toLowerCase() === 'week' ? 168 : relative[2]!.toLowerCase() === 'day' ? 24 : 1),
    )
    return date.toISOString()
  }

  const absolute = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+20\d{2}\b/i.exec(text)
  if (absolute) {
    // Date-only search snippets have no timezone. Treating them as the server's
    // local midnight moves the day backwards in UTC on positive offsets.
    const parsed = Date.parse(`${absolute[0]} UTC`)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }

  const urlDate = /\/(20\d{2})\/(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])(?:\/|$)/.exec(
    document.url,
  )
  if (urlDate) return `${urlDate[1]}-${urlDate[2]}-${urlDate[3]}T00:00:00.000Z`

  return null
}

function looksLikeFundingNews(text: string): boolean {
  const haystack = text.toLowerCase()
  return FUNDING_TERMS.some((term) => haystack.includes(term))
}

/**
 * Tokens that turn a company name into a DIFFERENT legal entity.
 *
 * "Stripe Press raises $8M" is not Stripe raising $8M, and attributing it would
 * put another company's round on these leads. Only consulted when the token is
 * not part of the company's own name — "Acme Ventures" as the company still
 * matches "acme ventures raises".
 */
const DISTINCT_ENTITY_SUFFIXES = new Set([
  'press',
  'labs',
  'ventures',
  'capital',
  'partners',
  'foundation',
  'studios',
  'media',
  'health',
  'bank',
  'university',
])

/**
 * The article must actually be about THIS company.
 *
 * Without this, a search for a common company name attaches another company's
 * round to these leads — the single most damaging error this module could make.
 */
export function mentionsCompany(companyName: string | null, text: string): boolean {
  const normalized = normalizeCompanyName(companyName)
  if (!normalized) return false

  const haystack = normalizeCompanyName(text) ?? ''
  if (!haystack) return false

  // Word-boundary match on the normalized forms, so "Acme" does not match
  // "Acmetric" while "Acme Systems" still matches "acme systems raises".
  const match = new RegExp(`(^|\\s)${escapeRegExp(normalized)}(\\s|$)`).exec(haystack)
  if (!match) return false

  const ownTokens = new Set(normalized.split(' '))
  const rest = haystack.slice(match.index + match[0].length).trim()
  const nextToken = rest.split(' ')[0] ?? ''

  // The name matched, but what follows names a different entity built on it.
  if (DISTINCT_ENTITY_SUFFIXES.has(nextToken) && !ownTokens.has(nextToken)) return false

  return true
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function extractRound(text: string): string | null {
  for (const { pattern, round } of ROUND_PATTERNS) {
    const match = pattern.exec(text)
    if (!match) continue
    if (round === 'Series') return `Series ${match[1]!.toUpperCase()}`
    return round
  }
  return null
}

/**
 * Reads a monetary amount, returning whole units of the stated currency.
 *
 * Deliberately conservative: an amount with no currency marker is ignored,
 * because a bare "raised 5 million" could be any currency and guessing USD
 * would silently misprice half of a European list.
 */
export function extractAmount(text: string): { amount: number; currency: string } | null {
  // $5M / €10.5 million / £2bn
  const symbolic =
    /([$€£¥])\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(k|m|mm|bn|b|thousand|million|billion)?/i
  const symbolMatch = symbolic.exec(text)
  if (symbolMatch) {
    const currency = CURRENCY_SYMBOLS[symbolMatch[1]!]
    const value = Number.parseFloat(symbolMatch[2]!.replace(/,/g, ''))
    const multiplier = symbolMatch[3] ? (MULTIPLIERS[symbolMatch[3].toLowerCase()] ?? 1) : 1
    if (currency && Number.isFinite(value)) {
      return { amount: Math.round(value * multiplier), currency }
    }
  }

  // USD 5,000,000 / EUR 10 million
  const coded = /\b(USD|EUR|GBP|CAD|AUD|JPY|CHF|SEK|INR)\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(k|m|mm|bn|b|thousand|million|billion)?/i
  const codedMatch = coded.exec(text)
  if (codedMatch) {
    const value = Number.parseFloat(codedMatch[2]!.replace(/,/g, ''))
    const multiplier = codedMatch[3] ? (MULTIPLIERS[codedMatch[3].toLowerCase()] ?? 1) : 1
    if (Number.isFinite(value)) {
      return { amount: Math.round(value * multiplier), currency: codedMatch[1]!.toUpperCase() }
    }
  }

  return null
}

/** "led by Acme Ventures" / "backed by X and Y". Conservative by design. */
export function extractInvestors(text: string): string[] {
  const investors = new Set<string>()

  for (const match of text.matchAll(/\b(?:led by|backed by|with participation from)\s+([^.;]{3,120})/gi)) {
    const clause = match[1]!
    for (const part of clause.split(/,| and /i)) {
      const name = part.trim().replace(/[)\]]+$/, '')
      // A name, not a sentence fragment. Capitalised and short.
      if (name.length >= 3 && name.length <= 60 && /^[A-Z0-9]/.test(name)) {
        investors.add(name)
      }
    }
  }

  return [...investors].slice(0, 10)
}

/**
 * Reads funding facts out of retrieved documents.
 *
 * PURE. Returns `null` unless a document both mentions this company AND states
 * an amount — a headline that says "raises Series A" with no figure gives a
 * round but no amount, and that is reported honestly rather than filled in.
 */
export function extractFunding(
  companyName: string | null,
  documents: readonly SearchResult[],
  wantedFields: readonly ResearchTask['fields'][number][] = [],
): FundingFacts | null {
  let best: { facts: FundingFacts; score: number } | null = null

  for (const doc of documents) {
    const text = `${doc.title}. ${doc.content}`.trim()
    if (!looksLikeFundingNews(text)) continue
    if (!mentionsCompany(companyName, text)) continue

    const round = extractRound(text)
    const money = extractAmount(text)
    const investors = extractInvestors(text)
    const announcedAt = extractAnnouncementDate(doc)

    // An investor-only task may find a sourced participant list in an article
    // whose headline does not repeat the amount or stage.
    if (!round && !money && investors.length === 0) continue

    const facts: FundingFacts = {
      round,
      amount: money?.amount ?? null,
      currency: money?.currency ?? null,
      announcedAt,
      investors,
      sourceUrl: doc.url,
      sourceTitle: doc.title,
    }

    const wanted = new Set(wantedFields)
    const score =
      (wanted.has('funding_round') && facts.round ? 1 : 0) +
      (wanted.has('funding_amount') && facts.amount !== null ? 1 : 0) +
      (wanted.has('funding_currency') && facts.currency ? 1 : 0) +
      (wanted.has('funding_date') && facts.announcedAt ? 1 : 0) +
      (wanted.has('funding_investors') && facts.investors.length > 0 ? 1 : 0)

    // No field preference preserves the original first-valid-document API.
    if (wanted.size === 0) return facts
    if (!best || score > best.score) best = { facts, score }
  }

  return best?.facts ?? null
}

function toEvidence(
  providerName: string,
  task: ResearchTask,
  facts: FundingFacts | null,
): NormalizedEvidence[] {
  if (!facts) return []

  const retrievedAt = new Date()
  const wanted = new Set(task.fields)

  const base = {
    entityType: 'company' as const,
    entityId: task.entity.id,
    sourceProvider: providerName,
    sourceUrl: facts.sourceUrl,
    // MEDIUM is the ceiling for press-derived facts. Never HIGH.
    sourceConfidence: 'medium' as const,
    retrievedAt: retrievedAt.toISOString(),
  }

  const evidence: NormalizedEvidence[] = []
  const push = (
    field: NormalizedEvidence['field'],
    value: Record<string, unknown>,
    confidence: number,
  ) => {
    if (!wanted.has(field)) return
    evidence.push({
      ...base,
      field,
      value,
      confidence,
      expiresAt: expiresAtFor(field, retrievedAt)?.toISOString() ?? null,
    })
  }

  if (facts.round) {
    push('funding_round', { round: facts.round, headline: facts.sourceTitle }, 0.65)
  }

  if (facts.amount !== null && facts.currency) {
    push('funding_amount', { amount: facts.amount, currency: facts.currency }, 0.6)
    push('funding_currency', { currency: facts.currency }, 0.6)
  }

  if (facts.announcedAt) {
    push(
      'funding_date',
      {
        // Named for what it is. The round closed at some point before it was
        // written about, and pretending otherwise would make date filters wrong.
        announcedAt: facts.announcedAt,
        isAnnouncementDate: true,
      },
      0.5,
    )
  }

  if (facts.investors.length > 0) {
    push('funding_investors', { investors: facts.investors }, 0.5)
  }

  return evidence
}

function fundingQuery(task: ResearchTask): string {
  const company = task.entity as CompanyEntity
  const parts = [`"${(company.name ?? '').replace(/"/g, '')}"`]
  const round = task.filters?.funding_round
  if (typeof round === 'string') parts.push(`"${round.replace(/"/g, '')}"`)
  parts.push(task.fields.includes('funding_investors') ? 'funding investors' : 'raises funding')
  return parts.join(' ')
}

export const searchFundingProvider: IntelligenceProvider<FundingFacts | null> = {
  name: 'search-funding',
  category: 'funding',

  canHandle: (task) =>
    task.entity.type === 'company' &&
    Boolean((task.entity as CompanyEntity).name) &&
    hasWebSearch(),

  estimateCost: async () => 0,

  execute: async (task) => {
    const company = task.entity as CompanyEntity
    const hits = await serpSearch(fundingQuery(task), {
      limit: 10,
      timeRange: searchTimeRange(task.filters ?? {}),
    })
    const documents: SearchResult[] = hits.map((hit) => ({
      title: hit.title ?? '',
      url: hit.url,
      content: hit.snippet ?? '',
      score: 0,
      publishedDate: hit.publishedDate,
    }))
    return extractFunding(company.name, documents, task.fields)
  },

  normalize: (facts, task) => toEvidence('search-funding', task, facts),
}

export const tavilyFundingProvider: IntelligenceProvider<FundingFacts | null> = {
  name: 'tavily-funding',
  category: 'funding',

  canHandle: (task) =>
    task.entity.type === 'company' &&
    Boolean((task.entity as CompanyEntity).name) &&
    hasTavilyCredentials(),

  estimateCost: async () => 1_000,

  execute: async (task) => {
    const company = task.entity as CompanyEntity
    const documents = await tavilySearch({
      query: fundingQuery(task),
      maxResults: 8,
      depth: 'advanced',
    })
    return extractFunding(company.name, documents, task.fields)
  },

  normalize: (facts, task) => toEvidence('tavily-funding', task, facts),
}

export const gdeltFundingProvider: IntelligenceProvider<FundingFacts | null> = {
  name: 'gdelt-funding',
  category: 'funding',

  canHandle: (task) =>
    task.entity.type === 'company' &&
    Boolean((task.entity as CompanyEntity).name) &&
    // GDELT is paced at one request per five seconds and is unsuitable for a
    // list-wide run when the operator-owned search service is available.
    !hasWebSearch(),

  estimateCost: async () => 0,

  execute: async (task) => {
    const company = task.entity as CompanyEntity
    const documents = await gdeltSearch({
      query: company.name ?? '',
      maxResults: 25,
      timespan: '24months',
    })
    return extractFunding(company.name, documents, task.fields)
  },

  normalize: (facts, task) => toEvidence('gdelt-funding', task, facts),
}
