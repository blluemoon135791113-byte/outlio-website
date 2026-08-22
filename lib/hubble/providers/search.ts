import 'server-only'

/**
 * Web search, behind one interface.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  SEARXNG WHEN IT EXISTS, TAVILY WHEN IT DOES NOT.                        ║
 * ║                                                                          ║
 * ║  SearXNG is the free, self-hosted, no-API-key option and is preferred    ║
 * ║  whenever `SEARXNG_URL` is set. It is not installed on every machine,    ║
 * ║  and a Hubble that cannot search until someone runs Docker is a Hubble   ║
 * ║  nobody can try. Tavily is already configured in this project, so the    ║
 * ║  waterfall makes the feature work today and go free later WITHOUT a      ║
 * ║  code change — only an environment variable.                             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import type { DeadlineOptions, SearchHit, SearchProvider } from '@/lib/hubble/providers/types'
import { requestJson, setHostPacing } from '@/lib/intelligence/http'
import { hasTavilyCredentials, tavilySearch } from '@/lib/intelligence/providers/tavily'

type SearxngConfig = {
  baseUrl: string
  authToken: string | null
  engines: string[]
}

/**
 * Resolves the operator-owned SearXNG endpoint once, with the same public-host
 * authentication rule for Hubble and the core Intelligence pipeline.
 */
function searxngConfig(): SearxngConfig | null {
  const value = process.env.SEARXNG_URL?.trim()
  if (!value) return null

  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

    const isLoopback =
      url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
    const authToken = process.env.SEARXNG_AUTH_TOKEN?.trim() || null
    if (!isLoopback && !authToken) return null

    const engines = (process.env.SEARXNG_ENGINES ?? '')
      .split(',')
      .map((engine) => engine.trim())
      .filter(Boolean)
      .slice(0, 8)

    return { baseUrl: url.origin, authToken, engines }
  } catch {
    return null
  }
}

export function hasSearxngCredentials(): boolean {
  return searxngConfig() !== null
}

/**
 * Shared, throwing SearXNG request used by provider adapters that must
 * distinguish "no results" from "the search service failed".
 */
export async function searxngSearch(
  query: string,
  limit: number,
  options: DeadlineOptions & { timeRange?: 'day' | 'week' | 'month' | 'year' } = {},
): Promise<SearchHit[]> {
  const config = searxngConfig()
  if (!config) return []

  const url = new URL('/search', config.baseUrl)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('language', 'en')
  url.searchParams.set('categories', 'general')
  if (config.engines.length > 0) url.searchParams.set('engines', config.engines.join(','))
  if (options.timeRange) url.searchParams.set('time_range', options.timeRange)

  setHostPacing(url.hostname, 750)

  const payload = await requestJson<{
    results?: Array<{ url?: string; title?: string; content?: string; publishedDate?: string }>
    unresponsive_engines?: Array<[string, string]>
  }>({
    url: url.toString(),
    headers: config.authToken ? { authorization: `Bearer ${config.authToken}` } : undefined,
    deadlineAt: options.deadlineAt,
  })

  if ((payload.results?.length ?? 0) === 0 && (payload.unresponsive_engines?.length ?? 0) > 0) {
    // Zero hits because every selected engine was throttled is an outage, not
    // evidence that the company has no results. The executor records this as
    // provider_unavailable so the UI never presents it as “not found”.
    throw new Error('SearXNG upstream engines unavailable')
  }

  return (payload.results ?? [])
    .filter((result): result is { url: string } & typeof result => typeof result.url === 'string')
    .slice(0, limit)
    .map((result) => ({
      url: result.url,
      title: result.title?.trim() || null,
      snippet: result.content?.trim() || null,
      publishedDate: result.publishedDate ?? null,
    }))
}

/**
 * A self-hosted SearXNG instance.
 *
 * ⚠️ THE URL IS OPERATOR-SUPPLIED AND POINTS AT INFRASTRUCTURE WE TRUST.
 *
 * It is deliberately exempt from the SSRF guard — a localhost SearXNG is the
 * normal deployment, and the guard exists to stop *model-chosen* URLs, not an
 * operator's own configuration. Nothing user-supplied ever reaches this value.
 */
export class SearxngSearchProvider implements SearchProvider {
  readonly name = 'searxng'

  /**
   * A remote instance MUST carry a token; a loopback one need not.
   *
   * ╔══════════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ REFUSING TO CALL AN UNAUTHENTICATED PUBLIC INSTANCE IS THE POINT.    ║
   * ║                                                                          ║
   * ║  SearXNG has no authentication of its own. If `SEARXNG_URL` points at a  ║
   * ║  public host and no token is set, either the instance is open to the     ║
   * ║  world — a free search API for whoever finds it — or it will reject      ║
   * ║  every one of our requests. Both are worth failing loudly at config      ║
   * ║  time rather than discovering through empty results, because a search    ║
   * ║  provider that returns nothing looks exactly like a company nobody has   ║
   * ║  written about.                                                          ║
   * ║                                                                          ║
   * ║  Loopback is exempt: a developer's own container on 127.0.0.1 is not     ║
   * ║  reachable by anyone else.                                               ║
   * ╚══════════════════════════════════════════════════════════════════════════╝
   */
  isConfigured(): boolean {
    return hasSearxngCredentials()
  }

  async search(query: string, limit: number, options: DeadlineOptions = {}): Promise<SearchHit[]> {
    try {
      return await searxngSearch(query, limit, options)
    } catch {
      /*
       * ⚠️ NEVER THROWS. A search engine being down must lower an answer's
       * confidence, not turn the user's question into a 500.
       */
      return []
    }
  }
}

/**
 * Google Programmable Search — free, no card, and it reuses a project you have.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THE ONLY GENUINELY FREE OPTION THAT NEEDS NO SERVER AND NO CARD.        ║
 * ║                                                                          ║
 * ║  Brave's "free" tier requires a card on file. SearXNG is free but is a   ║
 * ║  server you must deploy and defend. Google's Custom Search JSON API is   ║
 * ║  100 queries a day at no cost, no billing account, and it runs on        ║
 * ║  Vercel unchanged.                                                       ║
 * ║                                                                          ║
 * ║  ⚠️ 100/DAY IS THE REAL CONSTRAINT. A Hubble question spends 3-4         ║
 * ║  searches, so that is roughly 25-30 questions a day. Enough to build     ║
 * ║  and demo on; NOT enough for customer load. The cache is what stretches  ║
 * ║  it — a repeat question costs zero searches, and research is shared      ║
 * ║  across every lead at the same company.                                  ║
 * ║                                                                          ║
 * ║  Two settings, both free: enable the Custom Search API on the project,   ║
 * ║  and create a search engine set to search the entire web. A `cx` scoped  ║
 * ║  to specific sites returns almost nothing and looks like a broken key.   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
export class GoogleCseSearchProvider implements SearchProvider {
  readonly name = 'google-cse'

  /** Falls back to the Maps key: same project, and one key can serve both. */
  private get apiKey(): string | null {
    return process.env.GOOGLE_CSE_API_KEY?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim() || null
  }

  private get engineId(): string | null {
    return process.env.GOOGLE_CSE_ID?.trim() || null
  }

  isConfigured(): boolean {
    // ⚠️ BOTH are required. A key without an engine id is not a usable
    // configuration, and treating it as one would spend a waterfall slot on a
    // provider that can only ever return 400s.
    return this.apiKey !== null && this.engineId !== null
  }

  async search(query: string, limit: number, options: DeadlineOptions = {}): Promise<SearchHit[]> {
    const apiKey = this.apiKey
    const engineId = this.engineId
    if (!apiKey || !engineId) return []

    const url = new URL('https://www.googleapis.com/customsearch/v1')
    url.searchParams.set('key', apiKey)
    url.searchParams.set('cx', engineId)
    url.searchParams.set('q', query.slice(0, 400))
    // Google caps `num` at 10 and errors above it.
    url.searchParams.set('num', String(Math.min(Math.max(limit, 1), 10)))

    setHostPacing('www.googleapis.com', 300)

    try {
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
          // Google's JSON API does not return a publication date.
          publishedDate: null,
        }))
    } catch {
      /*
       * Includes the daily quota being spent, which returns 429. Silence is
       * correct here — the waterfall moves on — but it is also why the quota
       * note above matters: an exhausted tier looks exactly like a company
       * nobody has written about.
       */
      return []
    }
  }
}

/**
 * Brave Search — a real search index, on a free tier, with nothing to host.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WHY THIS EXISTS ALONGSIDE SEARXNG.                                      ║
 * ║                                                                          ║
 * ║  SearXNG is free but is a SERVER: it has to be deployed, kept alive, and ║
 * ║  protected, because an unauthenticated public instance gets its IP       ║
 * ║  blocked by the very engines it proxies. Brave has none of that — one    ║
 * ║  key, 2,000 queries a month, and it runs on Vercel unchanged.            ║
 * ║                                                                          ║
 * ║  ⚠️ 2,000/MONTH IS ~66/DAY. Each Hubble question spends 3-4 of them, so  ║
 * ║  that is roughly 15-20 questions a day before the tier is exhausted.     ║
 * ║  The cache is what makes that workable: a repeat question costs zero,    ║
 * ║  and company research is shared across every lead at that company.       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
export class BraveSearchProvider implements SearchProvider {
  readonly name = 'brave'

  private get apiKey(): string | null {
    return process.env.BRAVE_API_KEY?.trim() || null
  }

  isConfigured(): boolean {
    return this.apiKey !== null
  }

  async search(query: string, limit: number, options: DeadlineOptions = {}): Promise<SearchHit[]> {
    const apiKey = this.apiKey
    if (!apiKey) return []

    const url = new URL('https://api.search.brave.com/res/v1/web/search')
    url.searchParams.set('q', query.slice(0, 400))
    // Brave caps at 20; asking for more is an error, not a bigger page.
    url.searchParams.set('count', String(Math.min(Math.max(limit, 1), 20)))
    url.searchParams.set('result_filter', 'web')
    url.searchParams.set('safesearch', 'off')

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
          // Brave's description is a snippet, and may carry HTML emphasis tags.
          snippet: result.description?.replace(/<[^>]+>/g, '').trim() || null,
          publishedDate: result.age ?? null,
        }))
    } catch {
      // Never throws: a search engine being down lowers confidence, it does
      // not turn the user's question into a 500.
      return []
    }
  }
}

/** Tavily, adapted to the same interface. Already configured in this project. */
export class TavilySearchProvider implements SearchProvider {
  readonly name = 'tavily'

  isConfigured(): boolean {
    return hasTavilyCredentials()
  }

  async search(query: string, limit: number, options: DeadlineOptions = {}): Promise<SearchHit[]> {
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
 * Tries each configured provider in order and returns the first with results.
 *
 * Order is deliberate: the free one first. An operator who stands up SearXNG
 * stops paying Tavily without touching code.
 */
/**
 * When a provider last failed, so we stop paying for it repeatedly.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ A DEAD PROVIDER IS NOT FREE TO ASK. IT IS THE MOST EXPENSIVE ONE.    ║
 * ║                                                                          ║
 * ║  Measured: a SearXNG whose container is stopped takes 3.5 SECONDS to     ║
 * ║  fail, because the HTTP layer retries with backoff — correct behaviour   ║
 * ║  for a flaky host, wasteful for one that is simply gone. A question runs ║
 * ║  3-4 queries, so that is ~14 seconds per question spent on a provider    ║
 * ║  that cannot answer, before the one that can is even tried.              ║
 * ║                                                                          ║
 * ║  Module-level so the cooldown outlives a single request. Short, because  ║
 * ║  a restarted container should be picked up again quickly, not after an   ║
 * ║  hour of unnecessary fallback to a paid provider.                        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
const FAILED_AT = new Map<string, number>()
const COOLDOWN_MS = 60_000

function isCoolingDown(name: string): boolean {
  const failedAt = FAILED_AT.get(name)
  if (failedAt === undefined) return false

  if (Date.now() - failedAt > COOLDOWN_MS) {
    FAILED_AT.delete(name)
    return false
  }
  return true
}

/** Exported for tests; resets what is otherwise process-lifetime state. */
export function resetSearchCircuitBreaker(): void {
  FAILED_AT.clear()
}

export class SearchWaterfall implements SearchProvider {
  readonly name = 'waterfall'

  constructor(
    /*
     * ⚠️ ORDER IS COST, CHEAPEST FIRST.
     *
     * SearXNG is unmetered when someone has deployed one. Google CSE is free
     * with no card. Brave is free only with a card on file. Tavily is paid.
     * Standing up SearXNG later demotes the rest automatically, and none of
     * it needs a code change — only an env var.
     */
    private readonly providers: readonly SearchProvider[] = [
      new SearxngSearchProvider(),
      new GoogleCseSearchProvider(),
      new BraveSearchProvider(),
      new TavilySearchProvider(),
    ],
  ) {}

  isConfigured(): boolean {
    return this.providers.some((provider) => provider.isConfigured())
  }

  /** Which provider actually answered, for the usage record. */
  async searchWithSource(
    query: string,
    limit: number,
    options: DeadlineOptions = {},
  ): Promise<{ hits: SearchHit[]; provider: string | null }> {
    for (const provider of this.providers) {
      if (!provider.isConfigured()) continue
      // Skipped without a request: the point is to not pay the timeout again.
      if (isCoolingDown(provider.name)) continue

      const hits = await provider.search(query, limit, options)

      if (hits.length > 0) {
        // Recovered — clear any earlier failure rather than wait out the cooldown.
        FAILED_AT.delete(provider.name)
        return { hits, provider: provider.name }
      }

      /*
       * ⚠️ ZERO HITS IS TREATED AS A FAILURE, and that is a deliberate
       * over-reach. A genuinely obscure query can return nothing from a
       * healthy provider, and this will briefly sideline it. That costs one
       * minute of using the next provider down; the alternative costs 3.5
       * seconds on every query for as long as a host stays down.
       */
      FAILED_AT.set(provider.name, Date.now())
    }
    return { hits: [], provider: null }
  }

  async search(query: string, limit: number, options: DeadlineOptions = {}): Promise<SearchHit[]> {
    return (await this.searchWithSource(query, limit, options)).hits
  }
}

export function resolveSearchProvider(): SearchWaterfall {
  return new SearchWaterfall()
}
