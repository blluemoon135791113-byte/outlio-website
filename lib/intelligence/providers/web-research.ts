import 'server-only'

/**
 * Web research — recent news, hiring signals, and competitors.
 *
 * Two providers in one category, tried in order: Tavily first (snippets, better
 * relevance), GDELT second (free, headlines only). The waterfall in
 * `execute.ts` stops at whichever answers.
 *
 * ⚠️ NOTHING HERE INFERS. A signal exists only when a retrieved document says
 * so, and every claim carries the URL it came from. No documents means the
 * field is `unknown` — not "no news", not "not hiring".
 */
import { expiresAtFor } from '@/lib/intelligence/ttl'
import type {
  CompanyEntity,
  IntelligenceProvider,
  NormalizedEvidence,
  ResearchField,
  ResearchTask,
  SourceConfidence,
} from '@/lib/intelligence/types'
import { gdeltSearch } from './gdelt'
import { hasTavilyCredentials, tavilySearch, type SearchResult } from './tavily'

/** Roles whose hiring indicates go-to-market investment (spec §20). */
const SALES_HIRING_TERMS = [
  'sdr',
  'sales development',
  'account executive',
  'business development',
  'sales manager',
  'head of sales',
  'revenue',
  'growth marketer',
  'demand generation',
]

const HIRING_TERMS = ['hiring', 'we are hiring', 'join our team', 'careers', 'job opening', 'now hiring']

export type WebDocument = SearchResult

/**
 * One item of evidence distilled from retrieved documents.
 *
 * `documents` is deliberately part of the value: a user asking "why?" gets the
 * exact articles, not a summary they have to trust.
 */
export type WebFinding = {
  field: ResearchField
  value: Record<string, unknown>
  sourceUrl: string
  sourceConfidence: SourceConfidence
  confidence: number
}

function documentSummary(documents: readonly WebDocument[], limit = 5) {
  return documents.slice(0, limit).map((doc) => ({
    title: doc.title,
    url: doc.url,
    publishedDate: doc.publishedDate,
  }))
}

/** Only counts a term when it appears in the retrieved text, never a guess. */
function matchesAny(text: string, terms: readonly string[]): string[] {
  const haystack = text.toLowerCase()
  return terms.filter((term) => haystack.includes(term))
}

/**
 * Turns retrieved documents into findings.
 *
 * PURE — every branch is testable against recorded search responses, which is
 * the only way to prove the "no document, no claim" rule holds.
 */
export function findingsFromDocuments(
  field: ResearchField,
  documents: readonly WebDocument[],
): WebFinding[] {
  if (documents.length === 0) return []

  const first = documents[0]!

  if (field === 'recent_news') {
    return [
      {
        field,
        value: {
          articleCount: documents.length,
          mostRecent: documents[0]?.publishedDate ?? null,
          articles: documentSummary(documents),
        },
        sourceUrl: first.url,
        // A news article is a reputable secondary source, not the company
        // speaking. MEDIUM by definition (spec §17).
        sourceConfidence: 'medium',
        confidence: 0.7,
      },
    ]
  }

  if (field === 'hiring_signals') {
    const hits = documents.filter(
      (doc) => matchesAny(`${doc.title} ${doc.content}`, HIRING_TERMS).length > 0,
    )
    // No document mentions hiring → we did not learn that they are NOT hiring.
    // Returning nothing keeps the field `unknown`, which is the honest answer.
    if (hits.length === 0) return []

    const salesRoles = [
      ...new Set(hits.flatMap((doc) => matchesAny(`${doc.title} ${doc.content}`, SALES_HIRING_TERMS))),
    ]

    return [
      {
        field,
        value: {
          hiring: true,
          salesHiring: salesRoles.length > 0,
          roles: salesRoles,
          postings: documentSummary(hits),
        },
        sourceUrl: hits[0]!.url,
        sourceConfidence: 'medium',
        confidence: salesRoles.length > 0 ? 0.75 : 0.6,
      },
    ]
  }

  if (field === 'competitors') {
    return [
      {
        field,
        value: { mentions: documentSummary(documents, 8) },
        sourceUrl: first.url,
        // Competitor lists from search results are the weakest thing here: a
        // comparison page is marketing, not a market definition.
        sourceConfidence: 'low',
        confidence: 0.4,
      },
    ]
  }

  return []
}

function queryFor(field: ResearchField, company: CompanyEntity): string {
  const name = company.name ?? company.domain ?? ''
  switch (field) {
    case 'hiring_signals':
      return `${name} hiring jobs careers sales`
    case 'competitors':
      return `${name} competitors alternatives comparison`
    default:
      return `${name} news announcement`
  }
}

const WEB_FIELDS: ResearchField[] = ['recent_news', 'hiring_signals', 'competitors']

/** Field → how far back it is worth looking. */
const RECENCY_DAYS: Partial<Record<ResearchField, number>> = {
  recent_news: 180,
  hiring_signals: 60,
}

export type WebResearchOutput = Array<{ field: ResearchField; documents: WebDocument[] }>

function toEvidence(
  providerName: string,
  task: ResearchTask,
  output: WebResearchOutput,
): NormalizedEvidence[] {
  const retrievedAt = new Date()

  return output.flatMap(({ field, documents }) =>
    findingsFromDocuments(field, documents).map((finding) => ({
      field: finding.field,
      entityType: 'company' as const,
      entityId: task.entity.id,
      value: finding.value,
      sourceProvider: providerName,
      sourceUrl: finding.sourceUrl,
      sourceConfidence: finding.sourceConfidence,
      confidence: finding.confidence,
      retrievedAt: retrievedAt.toISOString(),
      expiresAt: expiresAtFor(finding.field, retrievedAt)?.toISOString() ?? null,
    })),
  )
}

export const tavilyWebResearchProvider: IntelligenceProvider<WebResearchOutput> = {
  name: 'tavily-web',
  category: 'web_research',

  canHandle: (task) =>
    task.entity.type === 'company' &&
    task.fields.some((field) => WEB_FIELDS.includes(field)) &&
    Boolean((task.entity as CompanyEntity).name ?? (task.entity as CompanyEntity).domain) &&
    hasTavilyCredentials(),

  estimateCost: async (task) =>
    1_000 * task.fields.filter((field) => WEB_FIELDS.includes(field)).length,

  execute: async (task) => {
    const company = task.entity as CompanyEntity
    const wanted = task.fields.filter((field) => WEB_FIELDS.includes(field))

    const output: WebResearchOutput = []
    // Sequential, not parallel: the shared host pacing would serialise these
    // anyway, and one query at a time keeps the failure of one field from
    // cancelling the others.
    for (const field of wanted) {
      const documents = await tavilySearch({
        query: queryFor(field, company),
        maxResults: 6,
        days: RECENCY_DAYS[field],
      })
      output.push({ field, documents })
    }

    return output
  },

  normalize: (output, task) => toEvidence('tavily-web', task, output),
}

export const gdeltWebResearchProvider: IntelligenceProvider<WebResearchOutput> = {
  name: 'gdelt-web',
  category: 'web_research',

  // No credential check: GDELT is open, which is the point of having it second.
  // It only knows news, so it never claims hiring or competitor questions.
  canHandle: (task) =>
    task.entity.type === 'company' &&
    task.fields.includes('recent_news') &&
    Boolean((task.entity as CompanyEntity).name),

  estimateCost: async () => 0,

  execute: async (task) => {
    const company = task.entity as CompanyEntity
    const documents = await gdeltSearch({ query: company.name ?? '', maxResults: 10 })
    return [{ field: 'recent_news' as ResearchField, documents }]
  },

  normalize: (output, task) => toEvidence('gdelt-web', task, output),
}
