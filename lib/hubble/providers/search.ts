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
import type { SearchHit, SearchProvider } from '@/lib/hubble/providers/types'
import { requestJson, setHostPacing } from '@/lib/intelligence/http'
import { hasTavilyCredentials, tavilySearch } from '@/lib/intelligence/providers/tavily'

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

  private get baseUrl(): string | null {
    const value = process.env.SEARXNG_URL?.trim()
    if (!value) return null
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
    } catch {
      return null
    }
  }

  isConfigured(): boolean {
    return this.baseUrl !== null
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const base = this.baseUrl
    if (!base) return []

    const url = new URL('/search', base)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('language', 'en')
    // General engines only: images and videos are not readable evidence.
    url.searchParams.set('categories', 'general')

    setHostPacing(url.hostname, 250)

    try {
      const payload = await requestJson<{
        results?: Array<{ url?: string; title?: string; content?: string; publishedDate?: string }>
      }>({ url: url.toString() })

      return (payload.results ?? [])
        .filter((result): result is { url: string } & typeof result => typeof result.url === 'string')
        .slice(0, limit)
        .map((result) => ({
          url: result.url,
          title: result.title?.trim() || null,
          snippet: result.content?.trim() || null,
          publishedDate: result.publishedDate ?? null,
        }))
    } catch {
      /*
       * ⚠️ NEVER THROWS. A search engine being down must lower an answer's
       * confidence, not turn the user's question into a 500.
       */
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

  async search(query: string, limit: number): Promise<SearchHit[]> {
    if (!this.isConfigured()) return []

    try {
      const results = await tavilySearch({ query, maxResults: limit })
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
export class SearchWaterfall implements SearchProvider {
  readonly name = 'waterfall'

  constructor(
    private readonly providers: readonly SearchProvider[] = [
      new SearxngSearchProvider(),
      new TavilySearchProvider(),
    ],
  ) {}

  isConfigured(): boolean {
    return this.providers.some((provider) => provider.isConfigured())
  }

  /** Which provider actually answered, for the usage record. */
  async searchWithSource(query: string, limit: number): Promise<{ hits: SearchHit[]; provider: string | null }> {
    for (const provider of this.providers) {
      if (!provider.isConfigured()) continue
      const hits = await provider.search(query, limit)
      if (hits.length > 0) return { hits, provider: provider.name }
    }
    return { hits: [], provider: null }
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    return (await this.searchWithSource(query, limit)).hits
  }
}

export function resolveSearchProvider(): SearchWaterfall {
  return new SearchWaterfall()
}
