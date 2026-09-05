import 'server-only'

/**
 * Tavily — the licensed search API behind web research and domain discovery.
 *
 * This module is the search PRIMITIVE only. It returns results with URLs and
 * snippets; deciding what those results mean belongs to the providers that call
 * it, so that interpretation stays testable without a network.
 *
 * ⚠️ The key is read from the environment inside the request and never
 * returned, logged, or placed in a URL.
 */
import { requestJson, setHostPacing } from '@/lib/intelligence/http'

const TAVILY_HOST = 'api.tavily.com'
const TAVILY_URL = `https://${TAVILY_HOST}/search`

// One request at a time, spaced. A research run over hundreds of companies is
// exactly the traffic shape that gets a search key throttled.
setHostPacing(TAVILY_HOST, 250)

export type SearchResult = {
  title: string
  url: string
  /** Snippet Tavily extracted. The only text we may quote a fact from. */
  content: string
  score: number
  publishedDate: string | null
}

export type TavilySearchOptions = {
  query: string
  maxResults?: number
  /** `advanced` costs more credits; reserve it for questions that need it. */
  depth?: 'basic' | 'advanced'
  includeDomains?: string[]
  excludeDomains?: string[]
  /** Restrict to recent results, for news and hiring signals. */
  days?: number
  /** Shared wall-clock deadline when called from Ask Hubble. */
  deadlineAt?: number
}

type TavilyResponse = {
  results?: Array<{
    title?: string
    url?: string
    content?: string
    score?: number
    published_date?: string
  }>
}

export function hasTavilyCredentials(): boolean {
  return Boolean(process.env.TAVILY_API_KEY)
}

/**
 * Runs one search.
 *
 * Returns `[]` rather than throwing when Tavily is not configured, so a
 * deployment without the key degrades to "unknown" instead of failing every
 * research job.
 */
export async function tavilySearch(options: TavilySearchOptions): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return []

  const payload = {
    // Sent both ways deliberately: Tavily accepts the bearer header on current
    // accounts and `api_key` in the body on older ones. Supporting both costs
    // nothing and avoids a silent auth failure on key rotation.
    api_key: apiKey,
    query: options.query,
    search_depth: options.depth ?? 'basic',
    max_results: Math.min(Math.max(options.maxResults ?? 5, 1), 20),
    include_answer: false,
    include_raw_content: false,
    ...(options.includeDomains?.length ? { include_domains: options.includeDomains } : {}),
    ...(options.excludeDomains?.length ? { exclude_domains: options.excludeDomains } : {}),
    ...(options.days ? { days: options.days, topic: 'news' } : {}),
  }

  const response = await requestJson<TavilyResponse>({
    url: TAVILY_URL,
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: payload,
    deadlineAt: options.deadlineAt,
  })

  return normalizeResults(response)
}

/** Exported so tests can exercise parsing against recorded responses. */
export function normalizeResults(response: TavilyResponse): SearchResult[] {
  return (response.results ?? [])
    .filter((result): result is { url: string } & typeof result => Boolean(result.url))
    .map((result) => ({
      title: (result.title ?? '').trim(),
      url: result.url,
      content: (result.content ?? '').trim(),
      score: typeof result.score === 'number' ? result.score : 0,
      publishedDate: normalizeDate(result.published_date),
    }))
}

/** Providers disagree on date format; anything unparseable becomes null. */
export function normalizeDate(value: string | undefined | null): string | null {
  if (!value) return null
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed).toISOString()
}
