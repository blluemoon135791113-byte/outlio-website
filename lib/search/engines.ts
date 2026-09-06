import 'server-only'

/**
 * The search engines themselves, behind one interface.
 *
 * Every engine is replaceable without any caller learning its name. Ordering,
 * caching, budget and deduplication are NOT here — they belong to
 * `lib/search/serp.ts`, and keeping them out of the engines is what lets a new
 * engine be added in twenty lines.
 */
import { requestJson, requestText, setHostPacing } from '@/lib/intelligence/http'
import { googleCseSearch, hasGoogleCseCredentials } from '@/lib/intelligence/providers/google-cse'
import { hasTavilyCredentials, tavilySearch } from '@/lib/intelligence/providers/tavily'
import { McpWebResearchSearchProvider } from '@/lib/hubble/providers/mcp-web-research'
import { SolrSearchProvider } from '@/lib/hubble/providers/solr'
import type { DeadlineOptions, SearchHit, SearchProvider } from '@/lib/hubble/providers/types'
import type { SerpTimeRange } from '@/lib/search/serp'

/** Deadline plus the one retrieval knob some engines can honour. */
export type EngineOptions = DeadlineOptions & { timeRange?: SerpTimeRange }

/**
 * Google Programmable Search — free, no card, and it reuses a project you have.
 *
 * The request itself lives in `lib/intelligence/providers/google-cse.ts`; this
 * is only the `SearchProvider` adapter around it. There used to be two separate
 * implementations of this call, one here and one there, which is exactly how
 * two callers end up with different `num` caps and different quota behaviour.
 */
export class GoogleCseSearchProvider implements SearchProvider {
  readonly name = 'google-cse'

  isConfigured(): boolean {
    // ⚠️ BOTH key and engine id are required. A key without a `cx` is not a
    // usable configuration, and treating it as one spends a waterfall slot on
    // an engine that can only ever return 400s.
    return hasGoogleCseCredentials()
  }

  async search(query: string, limit: number, options: EngineOptions = {}): Promise<SearchHit[]> {
    try {
      return await googleCseSearch(query, limit, {
        timeRange: options.timeRange,
        deadlineAt: options.deadlineAt,
      })
    } catch {
      /*
       * Includes the daily quota being spent, which returns 429. The budget
       * layer in `lib/search/budget.ts` is what stops that from silently
       * looking like "this company does not exist".
       */
      return []
    }
  }
}

/**
 * Brave Search — a real index on a free tier, with nothing to host.
 *
 * ~2,000 queries a month (≈66/day). Exists alongside Google CSE because the two
 * caps are independent: exhausting one still leaves the other.
 */
export class BraveSearchProvider implements SearchProvider {
  readonly name = 'brave'

  private get apiKey(): string | null {
    return process.env.BRAVE_API_KEY?.trim() || null
  }

  isConfigured(): boolean {
    return this.apiKey !== null
  }

  async search(query: string, limit: number, options: EngineOptions = {}): Promise<SearchHit[]> {
    const apiKey = this.apiKey
    if (!apiKey) return []

    const url = new URL('https://api.search.brave.com/res/v1/web/search')
    url.searchParams.set('q', query.slice(0, 400))
    // Brave caps at 20; asking for more is an error, not a bigger page.
    url.searchParams.set('count', String(Math.min(Math.max(limit, 1), 20)))
    url.searchParams.set('result_filter', 'web')
    url.searchParams.set('safesearch', 'off')
    if (options.timeRange) {
      const freshness = { day: 'pd', week: 'pw', month: 'pm', year: 'py' } as const
      url.searchParams.set('freshness', freshness[options.timeRange])
    }

    // One request per second on the free tier; exceeding it returns 429.
    setHostPacing('api.search.brave.com', 1_100)

    try {
      const payload = await requestJson<{
        web?: { results?: Array<{ url?: string; title?: string; description?: string; age?: string }> }
      }>({
        url: url.toString(),
        headers: {
          accept: 'application/json',
          'accept-encoding': 'gzip',
          'x-subscription-token': apiKey,
        },
        deadlineAt: options.deadlineAt,
      })

      return (payload.web?.results ?? [])
        .filter((result): result is { url: string } & typeof result => typeof result.url === 'string')
        .slice(0, limit)
        .map((result) => ({
          url: result.url,
          title: result.title?.trim() || null,
          // Brave's description is a snippet and may carry HTML emphasis tags.
          snippet: result.description?.replace(/<[^>]+>/g, '').trim() || null,
          publishedDate: result.age ?? null,
        }))
    } catch {
      return []
    }
  }
}

/** Tavily, adapted to the same interface. Metered — budgeted accordingly. */
export class TavilySearchProvider implements SearchProvider {
  readonly name = 'tavily'

  isConfigured(): boolean {
    return hasTavilyCredentials()
  }

  async search(query: string, limit: number, options: EngineOptions = {}): Promise<SearchHit[]> {
    if (!this.isConfigured()) return []

    try {
      const results = await tavilySearch({ query, maxResults: limit, deadlineAt: options.deadlineAt })
      return results.map((result) => ({
        url: result.url,
        title: result.title || null,
        // Tavily's own extracted snippet — the only text a fact may be quoted
        // from before the page itself is fetched.
        snippet: result.content || null,
        publishedDate: result.publishedDate,
      }))
    } catch {
      return []
    }
  }
}

/**
 * Mojeek — an independent index with no key and no quota.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THE KEYLESS BOTTOM TIER. OFF BY DEFAULT.                                ║
 * ║                                                                          ║
 * ║  Every other live engine above is capped. When those caps are spent, the ║
 * ║  honest options are "no answer" or "an uncapped index". This is the      ║
 * ║  second one, and it is what stops a spent quota from reading as a        ║
 * ║  company nobody has written about.                                       ║
 * ║                                                                          ║
 * ║  ⚠️ CONSTRAINTS, NOT NEGOTIABLE:                                         ║
 * ║   · Honest User-Agent. No rotation, no disguise, no proxy.               ║
 * ║   · Paced at one request per two seconds.                                ║
 * ║   · A block or a challenge is recorded as ZERO RESULTS and the engine    ║
 * ║     steps aside. Nothing here works around a refusal — that is the       ║
 * ║     difference between a fallback and evasion.                           ║
 * ║   · Opt-in via SERP_KEYLESS_FALLBACK=true, so no deployment starts       ║
 * ║     scraping a search engine because a variable was missing.             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
export class MojeekSearchProvider implements SearchProvider {
  readonly name = 'mojeek'

  isConfigured(): boolean {
    return process.env.SERP_KEYLESS_FALLBACK === 'true'
  }

  async search(query: string, limit: number, options: EngineOptions = {}): Promise<SearchHit[]> {
    if (!this.isConfigured()) return []

    const url = new URL('https://www.mojeek.com/search')
    url.searchParams.set('q', query.slice(0, 400))
    if (options.timeRange) {
      const since = { day: 'd', week: 'w', month: 'm', year: 'y' } as const
      url.searchParams.set('since', since[options.timeRange])
    }

    setHostPacing('www.mojeek.com', 2_000)

    let html: string
    try {
      html = await requestText({
        url: url.toString(),
        headers: { accept: 'text/html' },
        deadlineAt: options.deadlineAt,
      })
    } catch {
      return []
    }

    // Parsed with cheerio, server-side only. Uploaded or fetched HTML is never
    // rendered in a browser (CLAUDE.md rule 3).
    const { load } = await import('cheerio')
    const $ = load(html)
    const hits: SearchHit[] = []

    for (const element of $('ul.results-standard > li').toArray()) {
      const node = $(element)
      const href = node.find('a.title, h2 > a').first().attr('href')
      if (!href) continue

      let absolute: string
      try {
        absolute = new URL(href, 'https://www.mojeek.com').toString()
      } catch {
        continue
      }
      // A result pointing back at the engine is navigation, not a result.
      if (new URL(absolute).hostname.endsWith('mojeek.com')) continue

      hits.push({
        url: absolute,
        title: node.find('a.title, h2 > a').first().text().trim() || null,
        snippet: node.find('p.s').first().text().trim() || null,
        publishedDate: null,
      })
      if (hits.length >= limit) break
    }

    return hits
  }
}

/**
 * The default engine order for this deployment.
 *
 * ⚠️ ORDER IS COST, CHEAPEST FIRST. Reusable local knowledge, then the
 * operator's own research service, then capped free tiers, then the keyless
 * index, then anything metered.
 *
 * Mojeek sits ABOVE Tavily deliberately: an uncapped free index should be
 * exhausted before a metered vendor is billed.
 */
export function defaultSearchEngines(): SearchProvider[] {
  return [
    new SolrSearchProvider(),
    new McpWebResearchSearchProvider(),
    new GoogleCseSearchProvider(),
    new BraveSearchProvider(),
    new MojeekSearchProvider(),
    new TavilySearchProvider(),
  ]
}
