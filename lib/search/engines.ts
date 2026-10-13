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
import { hasTavilyCredentials, tavilySearch } from '@/lib/intelligence/providers/tavily'
import { SolrSearchProvider } from '@/lib/hubble/providers/solr'
import type { DeadlineOptions, SearchHit, SearchProvider } from '@/lib/hubble/providers/types'
import type { SerpTimeRange } from '@/lib/search/serp'

/** Deadline plus the one retrieval knob some engines can honour. */
export type EngineOptions = DeadlineOptions & { timeRange?: SerpTimeRange }

/** `after:YYYY-MM-DD` for a relative window, for engines that take operators. */
function afterOperator(range: SerpTimeRange | undefined, now = Date.now()): string | null {
  if (!range) return null
  const days = { day: 1, week: 7, month: 31, year: 366 }[range]
  return `after:${new Date(now - days * 86_400_000).toISOString().slice(0, 10)}`
}

/**
 * Diffbot Web Search — the primary engine (2026-10-13).
 *
 * Diffbot's own crawled index (the largest outside Google and Bing), reranked
 * for factual relevance and primary sources. Free plan: 100,000 queries a
 * month at 60 a minute, no card — so it cannot bill. Official API, honest
 * key; nothing here is scraped.
 */
export class DiffbotSearchProvider implements SearchProvider {
  readonly name = 'diffbot'

  private get token(): string | null {
    return process.env.DIFFBOT_API_KEY?.trim() || null
  }

  isConfigured(): boolean {
    return this.token !== null
  }

  async search(query: string, limit: number, options: EngineOptions = {}): Promise<SearchHit[]> {
    const token = this.token
    if (!token) return []

    const url = new URL('https://llm.diffbot.com/api/v1/web_search')
    const after = afterOperator(options.timeRange)
    url.searchParams.set('text', [query.slice(0, 400), after].filter(Boolean).join(' '))
    url.searchParams.set('size', String(Math.min(Math.max(limit, 1), 20)))

    // 60 queries a minute on the free plan.
    setHostPacing('llm.diffbot.com', 1_050)

    const payload = await requestJson<{
      search_results?: Array<{ pageUrl?: string; title?: string; content?: string; date?: string }>
    }>({
      url: url.toString(),
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      deadlineAt: options.deadlineAt,
    })

    return (Array.isArray(payload.search_results) ? payload.search_results : [])
      .filter((result): result is { pageUrl: string } & typeof result => typeof result.pageUrl === 'string')
      .slice(0, limit)
      .map((result) => ({
        url: result.pageUrl,
        title: result.title?.trim() || null,
        snippet: result.content?.trim() || null,
        publishedDate: result.date ?? null,
      }))
  }
}

/**
 * You.com — keyless, and an OFFICIAL free tier, not a scrape.
 *
 * About 100 queries a day per IP with no key or account. It answers Outlio's
 * honest User-Agent (tested 2026-10-13), which DuckDuckGo and Mojeek do not.
 * The cap is per IP and serverless egress IPs are shared, so a 429 is an
 * ordinary miss and the waterfall moves on.
 *
 * `SERP_YOUCOM=off` removes it.
 */
export class YouComSearchProvider implements SearchProvider {
  readonly name = 'youcom'

  isConfigured(): boolean {
    return process.env.SERP_YOUCOM?.trim().toLowerCase() !== 'off'
  }

  async search(query: string, limit: number, options: EngineOptions = {}): Promise<SearchHit[]> {
    if (!this.isConfigured()) return []

    const url = new URL('https://api.you.com/v1/agents/search')
    url.searchParams.set('query', query.slice(0, 400))
    url.searchParams.set('count', String(Math.min(Math.max(limit, 1), 20)))
    if (options.timeRange) url.searchParams.set('freshness', options.timeRange)

    setHostPacing('api.you.com', 1_000)

    const payload = await requestJson<{
      results?: { web?: Array<{ url?: string; title?: string; description?: string; snippets?: unknown }> }
    }>({
      url: url.toString(),
      headers: { accept: 'application/json' },
      deadlineAt: options.deadlineAt,
      // A throttled keyless call is a miss, not something to retry into.
      maxRetries: 0,
      /*
       * Measured 2026-10-13: a throttled call can hang ~12s before returning
       * nothing. It sits second in the waterfall, so every fallback would
       * pay that wait; a healthy answer takes ~1.5-2s.
       */
      timeoutMs: 6_000,
    })

    return (Array.isArray(payload.results?.web) ? payload.results.web : [])
      .filter((result): result is { url: string } & typeof result => typeof result.url === 'string')
      .slice(0, limit)
      .map((result) => {
        const snippets = Array.isArray(result.snippets)
          ? result.snippets.filter((part): part is string => typeof part === 'string')
          : []
        return {
          url: result.url,
          title: result.title?.trim() || null,
          snippet: [result.description, ...snippets].filter(Boolean).join(' ').trim() || null,
          publishedDate: null,
        }
      })
  }
}

/**
 * Exa — neural search over its own index.
 *
 * Free tier: $10 of credit every month with no payment method (~1,400 basic
 * searches at $7/1k). With no card on file an exhausted month is refused,
 * never billed; the daily budget keeps one busy day from spending the month.
 */
export class ExaSearchProvider implements SearchProvider {
  readonly name = 'exa'

  private get apiKey(): string | null {
    return process.env.EXA_API_KEY?.trim() || null
  }

  isConfigured(): boolean {
    return this.apiKey !== null
  }

  async search(query: string, limit: number, options: EngineOptions = {}): Promise<SearchHit[]> {
    const apiKey = this.apiKey
    if (!apiKey) return []

    const after = afterOperator(options.timeRange)
    const payload = await requestJson<{
      results?: Array<{ url?: string; title?: string; highlights?: unknown; publishedDate?: string }>
    }>({
      url: 'https://api.exa.ai/search',
      method: 'POST',
      headers: { accept: 'application/json', 'x-api-key': apiKey },
      body: {
        query: query.slice(0, 400),
        // 10 results is the price point; more costs extra per result.
        numResults: Math.min(Math.max(limit, 1), 10),
        type: 'auto',
        contents: { highlights: { numSentences: 2 } },
        ...(after ? { startPublishedDate: `${after.slice('after:'.length)}T00:00:00.000Z` } : {}),
      },
      deadlineAt: options.deadlineAt,
    })

    return (Array.isArray(payload.results) ? payload.results : [])
      .filter((result): result is { url: string } & typeof result => typeof result.url === 'string')
      .slice(0, limit)
      .map((result) => {
        const highlights = Array.isArray(result.highlights)
          ? result.highlights.filter((part): part is string => typeof part === 'string')
          : []
        return {
          url: result.url,
          title: result.title?.trim() || null,
          snippet: highlights.join(' ').trim() || null,
          publishedDate: result.publishedDate ?? null,
        }
      })
  }
}

/**
 * Brave Search — a real index on a free tier, with nothing to host.
 *
 * ~2,000 queries a month (≈66/day).
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

    return (Array.isArray(payload.web?.results) ? payload.web.results : [])
      .filter((result): result is { url: string } & typeof result => typeof result.url === 'string')
      .slice(0, limit)
      .map((result) => ({
        url: result.url,
        title: result.title?.trim() || null,
        // Brave's description is a snippet and may carry HTML emphasis tags.
        snippet: result.description?.replace(/<[^>]+>/g, '').trim() || null,
        publishedDate: result.age ?? null,
      }))
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

    const results = await tavilySearch({ query, maxResults: limit, deadlineAt: options.deadlineAt })
    return results.map((result) => ({
      url: result.url,
      title: result.title || null,
      // Tavily's own extracted snippet — the only text a fact may be quoted
      // from before the page itself is fetched.
      snippet: result.content || null,
      publishedDate: result.publishedDate,
    }))
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

    const html = await requestText({
      url: url.toString(),
      headers: { accept: 'text/html' },
      deadlineAt: options.deadlineAt,
    })

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
 * ⚠️ ORDER IS COST, CHEAPEST FIRST. Reusable local knowledge, then the free
 * tiers that refill monthly and need no card (largest allowance first), then
 * card-backed or metered vendors.
 *
 *   Diffbot  — 100,000/month free     You.com — ~100/day keyless
 *   Exa      — $10/month free credit  Tavily  — 1,000/month free
 *
 * Every engine here is an official API answering an honest identity. When
 * one is exhausted or throttled it returns nothing, the breaker sidelines it
 * for a minute, and the next one answers.
 *
 * Mojeek sits ABOVE Tavily deliberately: an uncapped free index should be
 * exhausted before a metered vendor is billed.
 *
 * ⚠️ REMOVED 2026-10-12, AND WHY — do not re-add without re-checking:
 *   · Google Custom Search JSON API: closed to new customers in 2025 and
 *     discontinued on 2027-01-01. It could never be enabled on this account.
 *   · The web-research MCP engine (SearXNG first, DuckDuckGo behind it): it
 *     only ever ran on localhost, and the hosted SearXNG (outlio-searxng on
 *     Fly) no longer answers. On Vercel it was a dead slot every query paid
 *     for. The MCP's lead-research stage (`lib/intelligence/run.ts`) is a
 *     separate client and is untouched.
 */
export function defaultSearchEngines(): SearchProvider[] {
  return [
    new SolrSearchProvider(),
    new DiffbotSearchProvider(),
    new YouComSearchProvider(),
    new ExaSearchProvider(),
    new BraveSearchProvider(),
    new MojeekSearchProvider(),
    new TavilySearchProvider(),
  ]
}
