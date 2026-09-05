import 'server-only'

/**
 * GDELT DOC 2.0 — the fallback news source behind Tavily.
 *
 * Open API, no key and no account. That makes it the right second provider in
 * the `web_research` waterfall: when a paid search key is rate-limited, missing,
 * or out of credit, research degrades to a free source instead of to `unknown`.
 *
 * Coverage is global news only — it knows nothing about company websites,
 * pricing, or hiring pages, so it is a genuine fallback rather than a
 * replacement.
 */
import { requestJson, setHostPacing } from '@/lib/intelligence/http'
import type { SearchResult } from './tavily'
import { normalizeDate } from './tavily'

const GDELT_HOST = 'api.gdeltproject.org'
const GDELT_URL = `https://${GDELT_HOST}/api/v2/doc/doc`

// A free, shared, unauthenticated service. Pace it generously — being a good
// citizen here costs one second per company and keeps the source available.
/*
 * ⚠️ FIVE SECONDS, NOT ONE. GDELT's own 429 body says "Please limit requests to
 * one every 5 seconds". Paced at 1s we were rate-limited on nearly every
 * company in a 25-lead run, and because Tavily is the other funding provider —
 * currently over its plan limit — that meant a whole run of Unknown with
 * nothing on screen to say why.
 */
setHostPacing(GDELT_HOST, 5_000)

type GdeltResponse = {
  articles?: Array<{
    title?: string
    url?: string
    seendate?: string
    domain?: string
    sourcecountry?: string
  }>
}

/**
 * GDELT stamps articles `YYYYMMDDTHHMMSSZ`, which `Date.parse` rejects.
 * Converted to ISO 8601 before it reaches anything that expects a real date.
 */
export function parseGdeltDate(value: string | undefined): string | null {
  if (!value) return null
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value.trim())
  if (!match) return normalizeDate(value)
  const [, y, mo, d, h, mi, s] = match
  return normalizeDate(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`)
}

/** Exported for tests: parsing is exercised against recorded responses. */
export function normalizeGdeltArticles(response: GdeltResponse): SearchResult[] {
  return (response.articles ?? [])
    .filter((article): article is { url: string } & typeof article => Boolean(article.url))
    .map((article) => ({
      title: (article.title ?? '').trim(),
      url: article.url,
      // GDELT returns headlines, not snippets. The title is the only text we
      // may quote from, and a claim never rests on a headline alone.
      content: (article.title ?? '').trim(),
      score: 0,
      publishedDate: parseGdeltDate(article.seendate),
    }))
}

export type GdeltSearchOptions = {
  query: string
  maxResults?: number
  /** Recency window. GDELT accepts a span such as `3months`. */
  timespan?: string
}

export async function gdeltSearch(options: GdeltSearchOptions): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    // Quoted so a multi-word company name is matched as a phrase rather than
    // as a bag of common words.
    query: `"${options.query.replace(/"/g, '')}"`,
    mode: 'artlist',
    format: 'json',
    sort: 'datedesc',
    maxrecords: String(Math.min(Math.max(options.maxResults ?? 10, 1), 75)),
    timespan: options.timespan ?? '12months',
  })

  const response = await requestJson<GdeltResponse>({
    url: `${GDELT_URL}?${params.toString()}`,
  })

  return normalizeGdeltArticles(response)
}
