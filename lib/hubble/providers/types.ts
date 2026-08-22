import 'server-only'

/**
 * The four things Hubble depends on, as interfaces.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  EVERY ONE OF THESE IS REPLACEABLE WITHOUT TOUCHING HUBBLE.              ║
 * ║                                                                          ║
 * ║  SearXNG today, something else tomorrow. Ollama when it is installed,    ║
 * ║  a hosted model when it is not. That is the entire reason these are      ║
 * ║  interfaces rather than direct calls: the orchestration in `ask.ts` must ║
 * ║  never learn the name of a vendor.                                       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * `LLMProvider` is deliberately NOT redefined here — `lib/intelligence/llm/
 * provider.ts` already owns that abstraction and already has working vendors.
 * A second, parallel LLM interface would be the duplication this file exists
 * to prevent.
 */

/* -------------------------------------------------------------------------- *
 * Search
 * -------------------------------------------------------------------------- */

export type SearchHit = {
  url: string
  title: string | null
  /** The engine's snippet. A hint for ranking — never quoted as fact. */
  snippet: string | null
  publishedDate: string | null
}

export type DeadlineOptions = { deadlineAt?: number }

export interface SearchProvider {
  readonly name: string
  isConfigured(): boolean
  /**
   * Returns hits, or an EMPTY ARRAY when the provider is unavailable.
   *
   * ⚠️ NEVER THROWS FOR AN UPSTREAM PROBLEM. A search engine being down must
   * degrade the answer's confidence, not turn the user's question into a 500.
   */
  search(query: string, limit: number, options?: DeadlineOptions): Promise<SearchHit[]>
}

/* -------------------------------------------------------------------------- *
 * Page fetching
 * -------------------------------------------------------------------------- */

export type FetchedPage = {
  url: string
  status: number
  title: string | null
  /** Readable text, boilerplate removed. Never raw HTML — CLAUDE.md rule 3. */
  content: string
  /** Which fetcher was used. Browser use must be visible, never silent. */
  method: 'fetch' | 'browser'
}

export type FetchFailure = {
  url: string
  code: 'blocked' | 'http_error' | 'not_html' | 'too_large' | 'timeout' | 'empty'
  detail: string
}

export interface PageFetcher {
  readonly name: string
  /** Never throws. A page that cannot be read is a failure value, not an error. */
  fetchPage(url: string, options?: DeadlineOptions): Promise<FetchedPage | FetchFailure>
}

export function isFetchFailure(
  value: FetchedPage | FetchFailure,
): value is FetchFailure {
  return 'code' in value
}

/* -------------------------------------------------------------------------- *
 * Embeddings
 * -------------------------------------------------------------------------- */

export interface EmbeddingProvider {
  readonly name: string
  readonly model: string
  /** Dimensions, so a model change is detectable rather than silently corrupting. */
  readonly dimensions: number
  isConfigured(): boolean
  /**
   * Whether the model is actually pulled and answering.
   *
   * ⚠️ SEPARATE FROM `isConfigured()` ON PURPOSE. A URL pointing at a running
   * Ollama with no embedding model pulled is configured but not usable, and
   * treating the two as one makes every question pay a doomed request.
   */
  isUsable(options?: DeadlineOptions): Promise<boolean>
  /**
   * Embeds a batch. Returns null when unavailable.
   *
   * ⚠️ NULL IS A SUPPORTED OUTCOME, NOT A FAILURE. Ollama may not be
   * installed. Retrieval falls back to lexical scoring, which needs no service
   * at all. Hubble degrades to a worse ranker, never to no answer.
   */
  embed(texts: readonly string[], options?: DeadlineOptions): Promise<number[][] | null>
}

/* -------------------------------------------------------------------------- *
 * Budgets
 * -------------------------------------------------------------------------- */

/**
 * The ceiling on one question.
 *
 * ⚠️ WITHOUT THIS, ONE QUESTION IS AN UNBOUNDED CRAWL. The planner chooses what
 * to research; these numbers decide how much of it may actually happen. Every
 * limit is enforced by the orchestrator, not trusted to the model.
 */
export type ResearchBudget = {
  /** Search passes. The current orchestrator performs one bounded pass. */
  maxSearchRounds: number
  maxQueriesPerRound: number
  maxPagesFetched: number
  /** Browser fetches are the expensive path and are capped hard. */
  maxBrowserFetches: number
  maxLlmCalls: number
  maxChunksToModel: number
  /** Wall-clock ceiling for the whole question. */
  maxTotalMs: number
  /** Time protected from crawling so the answer model always gets a turn. */
  synthesisReserveMs: number
  /** Simultaneous fetches. Politeness to the sites being read. */
  concurrency: number
}

export const DEFAULT_BUDGET: ResearchBudget = {
  maxSearchRounds: 1,
  maxQueriesPerRound: 4,
  maxPagesFetched: 8,
  maxBrowserFetches: 2,
  maxLlmCalls: 3,
  maxChunksToModel: 12,
  maxTotalMs: 90_000,
  synthesisReserveMs: 25_000,
  concurrency: 3,
}

/**
 * Retrieval must stop before the request deadline. Without a protected tail,
 * slow search and browser rendering can consume the entire request and leave
 * the answer model a 1ms timeout.
 */
export function retrievalDeadline(startedAt: number, budget: ResearchBudget): number {
  const reserve = Math.max(0, Math.min(budget.synthesisReserveMs, budget.maxTotalMs))
  return startedAt + budget.maxTotalMs - reserve
}

/** What a question actually consumed. Recorded on every answer. */
export type ResearchUsage = {
  searches: number
  pagesFetched: number
  browserFetches: number
  cacheHits: number
  llmCalls: number
  elapsedMs: number
}

export function emptyUsage(): ResearchUsage {
  return {
    searches: 0,
    pagesFetched: 0,
    browserFetches: 0,
    cacheHits: 0,
    llmCalls: 0,
    elapsedMs: 0,
  }
}

/* -------------------------------------------------------------------------- *
 * Answers
 * -------------------------------------------------------------------------- */

/**
 * How much a claim can be trusted.
 *
 * ⚠️ `estimated` MUST REACH THE USER AS "ESTIMATED". Presenting an inferred
 * revenue figure or a guessed pain point as fact is the failure mode this whole
 * layer is built to avoid, and CLAUDE.md rule 4 forbids it outright.
 */
export const ANSWER_STATUSES = ['verified', 'corroborated', 'estimated', 'unknown'] as const
export type AnswerStatus = (typeof ANSWER_STATUSES)[number]

export type AnswerSource = {
  url: string
  title: string | null
  /** The passage the claim rests on, so "why?" has a real answer. */
  quote: string | null
}
