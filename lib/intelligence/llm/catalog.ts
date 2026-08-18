import 'server-only'

/**
 * Hubble Nova — the one model users see.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ONE NAME, MANY ENGINES.                                                 ║
 * ║                                                                          ║
 * ║  There is no model picker. "Hubble Nova" is a chain, not a vendor:       ║
 * ║  `resolveLlmProvider()` builds every vendor and                          ║
 * ║  `createFallbackLlmProvider` tries each configured one in turn.          ║
 * ║                                                                          ║
 * ║  WHY THIS IS THE RIGHT DEFAULT: when one account's credits run out the   ║
 * ║  call returns `unavailable`, and the chain moves to the next vendor      ║
 * ║  rather than failing the user's question. A picker made that the user's  ║
 * ║  problem to solve; they should never have had to know.                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Adding capacity is adding a key. No UI changes, no user action.
 */
import {
  LLM_VENDORS,
  createBackboardProvider,
  createCerebrasProvider,
  createGeminiProvider,
  createGroqProvider,
  createOpenRouterProvider,
  type LLMProvider,
  type LlmVendor,
} from '@/lib/intelligence/llm/provider'

/** What the UI shows. Never a vendor name. */
export const HUBBLE_MODEL_NAME = 'Hubble Nova'

export type HubbleModelStatus = {
  name: string
  /** How many vendors currently back it. */
  engineCount: number
  /** True when at least one engine can answer. */
  ready: boolean
}

function providerFor(vendor: LlmVendor): LLMProvider {
  switch (vendor) {
    case 'gemini':
      return createGeminiProvider()
    case 'groq':
      return createGroqProvider()
    case 'openrouter':
      return createOpenRouterProvider()
    case 'cerebras':
      return createCerebrasProvider()
    case 'backboard':
      return createBackboardProvider()
  }
}

/**
 * Whether Hubble Nova can answer, and how much redundancy is behind it.
 *
 * ⚠️ THE COUNT IS NEVER SHOWN AS A VENDOR LIST. Which providers we hold keys
 * for is our operational business, not something to publish in a dropdown.
 * The number is useful to a user only as "there is more than one".
 */
export function hubbleModelStatus(): HubbleModelStatus {
  const engineCount = LLM_VENDORS.filter((vendor) => providerFor(vendor).isConfigured()).length

  return {
    name: HUBBLE_MODEL_NAME,
    engineCount,
    ready: engineCount > 0,
  }
}
