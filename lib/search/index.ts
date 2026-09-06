import 'server-only'

/**
 * The one entry point for web search in Outlio.
 *
 * Everything — Hubble's answer path, funding research, web research, company
 * profiles, contact discovery — resolves search through here, which is what
 * makes the cache, the daily budget and the request deduplication apply to all
 * of them rather than to whichever call site remembered.
 */
import { defaultSearchEngines } from '@/lib/search/engines'
import { SerpService, type SerpOptions, type SerpResult } from '@/lib/search/serp'

export { SerpService, resetSearchCircuitBreaker } from '@/lib/search/serp'
export type { SerpOptions, SerpResult, SerpTimeRange } from '@/lib/search/serp'

/**
 * Built once per process.
 *
 * The engine list reads configuration at construction, so a deployment that
 * gains a key needs a restart to use it — the same contract every other
 * provider in this codebase already has.
 */
let service: SerpService | null = null

export function resolveSearchProvider(): SerpService {
  service ??= new SerpService(defaultSearchEngines())
  return service
}

/** Exported for tests, which need a clean service after changing the env. */
export function resetSearchService(): void {
  service = null
}

/**
 * Whether ANY search engine is usable in this deployment.
 *
 * Providers gate on this rather than on one vendor's credentials. Before the
 * SERP service existed they gated on `hasGoogleCseCredentials()`, which meant a
 * deployment with Brave and no Google silently had no funding research, no web
 * research and no search-derived company profiles — three whole categories
 * dark because of a check that named a vendor.
 */
export function hasWebSearch(): boolean {
  return defaultSearchEngines().some((engine) => engine.isConfigured())
}

/** One query, hits only. The shape most callers want. */
export async function serpSearch(
  query: string,
  options: SerpOptions = {},
): Promise<SerpResult['hits']> {
  return (await resolveSearchProvider().run(query, options)).hits
}

/** Several phrasings of one question, merged and deduplicated by URL. */
export async function serpSearchMany(
  queries: readonly string[],
  options: SerpOptions & { maxQueries?: number; stopAfter?: number } = {},
): Promise<SerpResult['hits']> {
  return (await resolveSearchProvider().runMany(queries, options)).hits
}
