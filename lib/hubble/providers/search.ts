import 'server-only'

/**
 * Compatibility shim.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WEB SEARCH MOVED TO `lib/search/`.                                      ║
 * ║                                                                          ║
 * ║  It used to live here, which meant Hubble owned search and the four      ║
 * ║  intelligence providers that also needed it each reached for an engine   ║
 * ║  directly. Nothing was shared: not the cache, not the daily quota, not   ║
 * ║  the ordering. A single research run could spend a dozen of the day's    ║
 * ║  100 free queries re-asking one company question.                        ║
 * ║                                                                          ║
 * ║  Engines now live in `lib/search/engines.ts`; caching, budget,           ║
 * ║  deduplication and ordering live in `lib/search/serp.ts`.                ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * This file re-exports the moved names so existing imports keep working.
 * Prefer importing from `@/lib/search` in new code.
 */
import { defaultSearchEngines } from '@/lib/search/engines'
import { SerpService } from '@/lib/search/serp'
import type { SearchProvider } from '@/lib/hubble/providers/types'

export {
  BraveSearchProvider,
  GoogleCseSearchProvider,
  MojeekSearchProvider,
  TavilySearchProvider,
} from '@/lib/search/engines'
export { resetSearchCircuitBreaker } from '@/lib/search/serp'
export { resolveSearchProvider } from '@/lib/search'

/**
 * The engine waterfall WITHOUT the shared cache.
 *
 * Retained because ordering and the circuit breaker are worth exercising in
 * isolation — a test that also has to satisfy a Postgres cache is testing two
 * things. Production goes through `resolveSearchProvider()`, which is the same
 * waterfall with caching, budget and deduplication on top.
 */
export class SearchWaterfall extends SerpService {
  constructor(engines: readonly SearchProvider[] = defaultSearchEngines()) {
    super(engines, { cache: false })
  }
}
