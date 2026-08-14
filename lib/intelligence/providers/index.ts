import 'server-only'

/**
 * The live provider registry.
 *
 * ⚠️ ORDER IS THE WATERFALL. The first provider in a category that returns an
 * acceptable answer wins and the rest are never called, so this list is a cost
 * decision as much as a quality one.
 *
 * The defaults below encode two rules:
 *
 *   1. **A stated fact beats an inferred one.** Wikidata says what a company's
 *      website IS; `domain-discovery` notices that a domain looks like the
 *      company's name. Wikidata therefore runs first, and the heuristic only
 *      sees companies Wikidata has never heard of — which, for a Sales
 *      Navigator list, will be most of them.
 *
 *   2. **A free source is the last line, not the first.** GDELT sits behind
 *      Tavily in both waterfalls: worse coverage, but it needs no key, so a
 *      missing or throttled search key degrades research to a free source
 *      instead of to `unknown`.
 *
 * `INTELLIGENCE_PROVIDER_ORDER` overrides any of this without a deploy.
 */
import { createRegistry, parseProviderOrder, type ProviderRegistry } from '@/lib/intelligence/registry'
import {
  eraseProviderType,
  type AnyIntelligenceProvider,
  type ToolCategory,
} from '@/lib/intelligence/types'
import { domainDiscoveryProvider } from './domain-discovery'
import { gdeltFundingProvider, tavilyFundingProvider } from './funding'
import { pageSpeedTechProvider } from './pagespeed'
import { gdeltWebResearchProvider, tavilyWebResearchProvider } from './web-research'
import { wikidataProvider } from './wikidata'

/** Every provider that exists, regardless of whether it is configured. */
export const ALL_PROVIDERS: readonly AnyIntelligenceProvider[] = [
  eraseProviderType(wikidataProvider),
  eraseProviderType(domainDiscoveryProvider),
  eraseProviderType(tavilyFundingProvider),
  eraseProviderType(gdeltFundingProvider),
  eraseProviderType(tavilyWebResearchProvider),
  eraseProviderType(gdeltWebResearchProvider),
  eraseProviderType(pageSpeedTechProvider),
]

export const DEFAULT_PROVIDER_ORDER: Partial<Record<ToolCategory, string[]>> = {
  company_profile: ['wikidata', 'tavily-domain-discovery'],
  funding: ['tavily-funding', 'gdelt-funding'],
  web_research: ['tavily-web', 'gdelt-web'],
  tech_stack: ['pagespeed-tech'],
}

/**
 * Builds the registry for this deployment.
 *
 * An environment override is MERGED over the defaults per category, not
 * substituted wholesale: naming one category must not silently disable every
 * other waterfall.
 *
 * Providers whose credentials are absent stay registered. They decline through
 * `canHandle`, which keeps the reason visible as "no provider could answer"
 * rather than making a category vanish from the configuration.
 */
export function buildLiveRegistry(
  env: string | undefined = process.env.INTELLIGENCE_PROVIDER_ORDER,
): ProviderRegistry {
  return createRegistry(ALL_PROVIDERS, {
    ...DEFAULT_PROVIDER_ORDER,
    ...parseProviderOrder(env),
  })
}

/**
 * Which providers are actually usable right now.
 *
 * Exposed so an operator can see at a glance why a category is returning
 * `unknown` — almost always a missing key rather than a bug.
 */
export function providerReadiness(): Array<{
  name: string
  category: ToolCategory
  configured: boolean
}> {
  return ALL_PROVIDERS.map((provider) => ({
    name: provider.name,
    category: provider.category,
    configured: isConfigured(provider.name),
  }))
}

function isConfigured(name: string): boolean {
  switch (name) {
    case 'tavily-domain-discovery':
    case 'tavily-funding':
    case 'tavily-web':
      return Boolean(process.env.TAVILY_API_KEY)
    case 'pagespeed-tech':
      return Boolean(process.env.PAGESPEED_API_KEY)
    // Wikidata and GDELT are open APIs and need no credential.
    default:
      return true
  }
}
