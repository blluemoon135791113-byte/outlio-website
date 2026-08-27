import 'server-only'

/**
 * The SERP service — one place every web search in Outlio goes through.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WHY THIS IS CENTRAL RATHER THAN PER-PROVIDER.                           ║
 * ║                                                                          ║
 * ║  Before this file, five call sites each reached for an engine directly:  ║
 * ║  Hubble's answer path, the funding waterfall, web research, company      ║
 * ║  profiles, and contact discovery. Each had its own idea of ordering and  ║
 * ║  none of them shared a cache. A single research run over 25 leads at 6   ║
 * ║  companies could issue the SAME company query a dozen times and spend a  ║
 * ║  dozen of the day's 100 free queries on one answer.                      ║
 * ║                                                                          ║
 * ║  Four things only a central service can do, all of them required by the  ║
 * ║  enrichment brief:                                                       ║
 * ║                                                                          ║
 * ║    1. CACHE   — a repeated question costs nothing, across processes.     ║
 * ║    2. DEDUPE  — concurrent identical queries collapse into one request.  ║
 * ║    3. BUDGET  — the daily tier is counted, so exhaustion is visible      ║
 * ║                 rather than looking like "no results".                   ║
 * ║    4. ORDER   — one waterfall, cheapest first, with one circuit breaker. ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ NEVER THROWS. A search engine being down lowers an answer's confidence;
 * it does not turn a user's question into a 500. Every failure path here
 * returns empty hits and records which engine (if any) answered.
 */
import { reserveSearch } from '@/lib/search/budget'
import {
  dedupeQueries,
  filterHits,
  mergeHits,
  normalizeQuery,
  rankHits,
  searchCacheKey,
  type DomainFilter,
} from '@/lib/search/query'
import { readProviderCache, writeProviderCache } from '@/lib/intelligence/provider-state'
import type { SearchHit, SearchProvider } from '@/lib/hubble/providers/types'
import type { Json } from '@/types/database'

export type SerpTimeRange = 'day' | 'week' | 'month' | 'year'

export type SerpOptions = DomainFilter & {
  limit?: number
  timeRange?: SerpTimeRange
  deadlineAt?: number
  /** Hits on these domains are ranked first — normally the employer's own. */
  preferDomains?: readonly string[]
  /** Bypass the cache READ. The write still happens. */
  fresh?: boolean
}

export type SerpResult = {
  hits: SearchHit[]
  /** Which engine answered, or `null` when none could. */
  engine: string | null
  /** True when no external request was made. */
  cached: boolean
}

/* -------------------------------------------------------------------------- *
 * Cache
 * -------------------------------------------------------------------------- */

/**
 * How long a result set stays reusable.
 *
 * Long, and deliberately so: the free tier is 100 queries a DAY, and a search
 * result page for "Acme Corp funding" does not change hour to hour. The cost of
 * a slightly stale ranking is far below the cost of a false "not found" caused
 * by an exhausted quota.
 */
const HIT_TTL_MS = Number(process.env.SERP_CACHE_HOURS ?? 168) * 3_600_000

/**
 * Empty results expire FAST.
 *
 * An empty answer is ambiguous — it means either "nothing exists" or "the
 * engine was having a bad minute". Caching that for a week would turn one
 * transient outage into seven days of confident wrong answers.
 */
const EMPTY_TTL_MS = Number(process.env.SERP_EMPTY_CACHE_HOURS ?? 6) * 3_600_000

type CachedSearch = { hits: SearchHit[]; engine: string | null }

/** Cache reads NEVER fail loudly — a broken cache degrades to a live search. */
async function readCache(key: string): Promise<CachedSearch | null> {
  try {
    const entry = await readProviderCache<CachedSearch>('serp', key)
    if (!entry || !Array.isArray(entry.value?.hits)) return null
    return entry.value
  } catch {
    return null
  }
}

async function writeCache(key: string, value: CachedSearch): Promise<void> {
  try {
    const now = new Date()
    const ttl = value.hits.length > 0 ? HIT_TTL_MS : EMPTY_TTL_MS
    await writeProviderCache('serp', key, value as unknown as Json, now, new Date(now.getTime() + ttl))
  } catch {
    // A cache that cannot be written is a performance problem, never a
    // correctness one. The caller already has its answer.
  }
}

/* -------------------------------------------------------------------------- *
 * Circuit breaker
 * -------------------------------------------------------------------------- */

/**
 * When an engine last failed, so we stop paying its timeout repeatedly.
 *
 * ⚠️ A DEAD ENGINE IS THE MOST EXPENSIVE ONE TO ASK. Measured: a host that is
 * simply gone takes ~3.5s to fail, because the HTTP layer retries with
 * backoff — right for a flaky host, wasteful for one that is gone. A question
 * runs three or four queries, so that is ~14 seconds per question spent on an
 * engine that cannot answer, before the one that can is even tried.
 *
 * Module-level so the cooldown outlives one request. Short, so a restarted
 * container is picked up again quickly rather than after an hour of fallback.
 */
const FAILED_AT = new Map<string, number>()
const COOLDOWN_MS = 60_000

function isCoolingDown(name: string, now: number): boolean {
  const failedAt = FAILED_AT.get(name)
  if (failedAt === undefined) return false
  if (now - failedAt > COOLDOWN_MS) {
    FAILED_AT.delete(name)
    return false
  }
  return true
}

/** Exported for tests; resets what is otherwise process-lifetime state. */
export function resetSearchCircuitBreaker(): void {
  FAILED_AT.clear()
  INFLIGHT.clear()
}

/* -------------------------------------------------------------------------- *
 * In-flight deduplication
 * -------------------------------------------------------------------------- */

/**
 * Identical queries already in flight share one request.
 *
 * The Postgres cache cannot help here: within a single research run, twenty
 * leads at six companies issue their company queries CONCURRENTLY, so every one
 * of them misses the cache, and all twenty reach the engine before the first
 * response has been written back. This map is what turns those twenty requests
 * into six.
 */
const INFLIGHT = new Map<string, Promise<CachedSearch>>()

/* -------------------------------------------------------------------------- *
 * The service
 * -------------------------------------------------------------------------- */

export type SerpServiceOptions = {
  /** Disable the shared cache. Used by tests and by callers that must be live. */
  cache?: boolean
}

export class SerpService implements SearchProvider {
  readonly name = 'serp'

  constructor(
    /**
     * ⚠️ ORDER IS COST, CHEAPEST FIRST.
     *
     * Reusable local knowledge, then the operator's own research service, then
     * capped free tiers, then anything metered. Injected rather than imported
     * so this class stays testable without touching a network.
     */
    private readonly engines: readonly SearchProvider[],
    private readonly options: SerpServiceOptions = {},
  ) {}

  isConfigured(): boolean {
    return this.engines.some((engine) => engine.isConfigured())
  }

  /** `SearchProvider` compatibility — hits only. */
  async search(query: string, limit: number, options: SerpOptions = {}): Promise<SearchHit[]> {
    return (await this.run(query, { ...options, limit })).hits
  }

  /** One query, with provenance about how it was answered. */
  async run(query: string, options: SerpOptions = {}): Promise<SerpResult> {
    const normalized = normalizeQuery(query)
    const limit = Math.min(Math.max(options.limit ?? 8, 1), 20)
    if (!normalized) return { hits: [], engine: null, cached: false }

    const key = searchCacheKey(normalized, limit, options.timeRange)
    const useCache = this.options.cache !== false

    if (useCache && !options.fresh) {
      const cached = await readCache(key)
      if (cached) {
        return { ...this.shape(cached.hits, options), engine: cached.engine, cached: true }
      }
    }

    // Collapse concurrent duplicates. Keyed identically to the cache, so a
    // waiter receives exactly what the cache would have served it.
    const existing = INFLIGHT.get(key)
    if (existing) {
      const shared = await existing
      return { ...this.shape(shared.hits, options), engine: shared.engine, cached: true }
    }

    const request = this.execute(normalized, limit, options)
      .then(async (result) => {
        if (useCache) await writeCache(key, result)
        return result
      })
      .finally(() => {
        INFLIGHT.delete(key)
      })

    INFLIGHT.set(key, request)

    const result = await request
    return { ...this.shape(result.hits, options), engine: result.engine, cached: false }
  }

  /**
   * Several queries, merged and deduplicated by URL.
   *
   * This is the shape contact discovery actually needs: four phrasings of "find
   * this person's email", of which any one might be the one that works. Queries
   * are deduplicated first, so a caller that generates overlapping phrasings
   * does not pay for the overlap.
   */
  async runMany(
    queries: readonly string[],
    options: SerpOptions & { maxQueries?: number; stopAfter?: number } = {},
  ): Promise<SerpResult> {
    const wanted = dedupeQueries(queries).slice(0, options.maxQueries ?? 4)
    const ceiling = options.stopAfter ?? 24

    const groups: SearchHit[][] = []
    const engines: string[] = []
    let cached = true

    for (const query of wanted) {
      const result = await this.run(query, options)
      if (result.engine) engines.push(result.engine)
      if (!result.cached) cached = false
      groups.push(result.hits)
      // Bound memory and downstream parsing even when several phrasings return
      // near-identical directory results.
      if (mergeHits(...groups).length >= ceiling) break
    }

    const merged = mergeHits(...groups).slice(0, ceiling)
    return {
      hits: this.shape(merged, options).hits,
      engine: engines[0] ?? null,
      cached: cached && wanted.length > 0,
    }
  }

  /** Domain filtering and preferred-domain ranking, applied after retrieval. */
  private shape(hits: readonly SearchHit[], options: SerpOptions): { hits: SearchHit[] } {
    return { hits: rankHits(filterHits(hits, options), options.preferDomains ?? []) }
  }

  /** The waterfall itself: breaker, budget, engine, in that order. */
  private async execute(
    query: string,
    limit: number,
    options: SerpOptions,
  ): Promise<CachedSearch> {
    for (const engine of this.engines) {
      if (!engine.isConfigured()) continue
      // Skipped without a request: the point is not to pay the timeout again.
      if (isCoolingDown(engine.name, Date.now())) continue

      const reservation = await reserveSearch(engine.name)
      if (!reservation.allowed) continue

      // Not an inline literal: engines accept a wider option type than the
      // `SearchProvider` interface declares, and an excess property on a fresh
      // literal would not type-check.
      const engineOptions: { deadlineAt?: number; timeRange?: SerpTimeRange } = {
        deadlineAt: options.deadlineAt,
        timeRange: options.timeRange,
      }

      let hits: SearchHit[] = []
      try {
        hits = await engine.search(query, limit, engineOptions)
      } catch {
        // A `SearchProvider` is contractually silent about upstream failure,
        // but a thrown error must not escape the service either.
        hits = []
      }

      if (hits.length > 0) {
        // Recovered — clear any earlier failure rather than wait out the cooldown.
        FAILED_AT.delete(engine.name)
        return { hits, engine: engine.name }
      }

      /*
       * ⚠️ ZERO HITS IS TREATED AS A FAILURE, and that is a deliberate
       * over-reach. A genuinely obscure query can return nothing from a healthy
       * engine, and this will briefly sideline it. That costs one minute of
       * using the next engine down; the alternative costs seconds on every
       * query for as long as a host stays down.
       */
      FAILED_AT.set(engine.name, Date.now())
    }

    return { hits: [], engine: null }
  }
}
