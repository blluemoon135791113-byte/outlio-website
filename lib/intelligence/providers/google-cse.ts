import 'server-only'

/**
 * Google Programmable Search (Custom Search JSON API) — the free live-search
 * source for the intelligence waterfalls.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 *  ⚠️ CLOSED TO NEW CUSTOMERS. Google no longer grants access to the Custom
 *  Search JSON API, so this provider cannot be switched on for an account
 *  that does not already have it. A key without that access returns
 *  `403 PERMISSION_DENIED` on every call, which this provider swallows into
 *  an empty result — so the symptom is silence, not an error.
 *
 *  The code stays because an account WITH existing access still works, and
 *  because deleting a provider is not how you record that an upstream closed.
 *  On this deployment search runs through the web-research MCP (SearXNG with
 *  a DuckDuckGo fallback), which sits ABOVE this provider in
 *  `defaultSearchEngines()`.
 *
 *  Where it does work: 100 queries a day at no cost, no card, no server.
 *  Two settings, both free: enable the Custom Search API on a Google project,
 *  and create a search engine set to search THE ENTIRE WEB. A `cx` scoped to
 *  specific sites returns almost nothing and looks like a broken key.
 *
 *  ⚠️ 100/DAY IS THE REAL CONSTRAINT. The cache is what stretches it: a
 *  repeat question costs zero searches, and company research is shared
 *  across every lead at the same company.
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { requestJson, setHostPacing } from '@/lib/intelligence/http'

setHostPacing('www.googleapis.com', 300)

export function hasGoogleCseCredentials(): boolean {
  const apiKey = process.env.GOOGLE_CSE_API_KEY?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim() || null
  const engineId = process.env.GOOGLE_CSE_ID?.trim() || null
  return apiKey !== null && engineId !== null
}

export type GoogleTimeRange = 'day' | 'week' | 'month' | 'year'

export type GoogleSearchHit = {
  url: string
  title: string | null
  snippet: string | null
  publishedDate: string | null
}

/**
 * Web search via the Custom Search JSON API.
 *
 * `timeRange` maps onto Google's `dateRestrict` (d1/w1/m1/y1). Throws on
 * failure — callers distinguish "no results" from "the search failed", and
 * the daily-quota 429 surfacing as an outage is deliberate: an exhausted tier
 * must never read as "the company has no results".
 */
export async function googleCseSearch(
  query: string,
  limit: number,
  options: { timeRange?: GoogleTimeRange; deadlineAt?: number } = {},
): Promise<GoogleSearchHit[]> {
  const apiKey =
    process.env.GOOGLE_CSE_API_KEY?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim() || null
  const engineId = process.env.GOOGLE_CSE_ID?.trim() || null
  if (!apiKey || !engineId) return []

  const url = new URL('https://www.googleapis.com/customsearch/v1')
  url.searchParams.set('key', apiKey)
  url.searchParams.set('cx', engineId)
  url.searchParams.set('q', query.slice(0, 400))
  // Google caps `num` at 10 and errors above it.
  url.searchParams.set('num', String(Math.min(Math.max(limit, 1), 10)))
  if (options.timeRange) {
    const days = { day: 'd1', week: 'w1', month: 'm1', year: 'y1' } as const
    url.searchParams.set('dateRestrict', days[options.timeRange])
  }

  const payload = await requestJson<{
    items?: Array<{ link?: string; title?: string; snippet?: string }>
  }>({
    url: url.toString(),
    headers: { accept: 'application/json' },
    deadlineAt: options.deadlineAt,
  })

  return (payload.items ?? [])
    .filter((item): item is { link: string } & typeof item => typeof item.link === 'string')
    .slice(0, limit)
    .map((item) => ({
      url: item.link,
      title: item.title?.trim() || null,
      snippet: item.snippet?.trim() || null,
      // The JSON API does not return a publication date.
      publishedDate: null,
    }))
}
