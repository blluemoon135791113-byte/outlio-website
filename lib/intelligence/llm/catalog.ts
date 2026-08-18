import 'server-only'

/**
 * The models a user may choose between.
 *
 * ⚠️ DERIVED FROM WHAT IS ACTUALLY CONFIGURED, never a hardcoded menu. A picker
 * offering GPT-4o on a deployment with no OpenAI key would let a user select a
 * model, run a query, and be told the planner was unavailable — with nothing to
 * connect the two.
 *
 * `openrouter` is the reason this list can grow without new code: one key makes
 * GPT-4o, Claude, DeepSeek and the rest reachable through the OpenAI-compatible
 * contract `provider.ts` already speaks.
 */
import {
  DEFAULT_GEMINI_MODEL,
  createBackboardProvider,
  createCerebrasProvider,
  createGeminiProvider,
  createGroqProvider,
  createOpenRouterProvider,
  type LlmVendor,
} from '@/lib/intelligence/llm/provider'

export type ModelChoice = {
  /** Sent back on a query; `resolveLlmProvider` understands it. */
  id: LlmVendor
  /** What the dropdown shows. */
  label: string
  /** The specific model behind the label, for the user who cares. */
  model: string
  /** A one-line reason to pick this one. */
  hint: string
  configured: boolean
}

/**
 * Every vendor, with its configured state resolved at request time.
 *
 * Order is deliberate: the fastest and cheapest first, because that is the
 * right default for a question a user is still refining.
 */
export function modelCatalog(): ModelChoice[] {
  const gemini = createGeminiProvider()
  const groq = createGroqProvider()
  const openrouter = createOpenRouterProvider()
  const cerebras = createCerebrasProvider()
  const backboard = createBackboardProvider()

  return [
    {
      id: 'gemini',
      label: 'Gemini Flash',
      model: process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
      hint: 'Fast, and the only one with constrained decoding',
      configured: gemini.isConfigured(),
    },
    {
      id: 'groq',
      label: 'Llama 3.3 70B',
      model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
      hint: 'Fastest to first token',
      configured: groq.isConfigured(),
    },
    {
      id: 'cerebras',
      label: 'Cerebras',
      model: cerebras.model,
      hint: 'Wafer-scale inference, very low latency',
      configured: cerebras.isConfigured(),
    },
    {
      id: 'openrouter',
      label: openRouterLabel(openrouter.model),
      model: openrouter.model,
      hint: 'Any model on OpenRouter, including GPT-4o and Claude',
      configured: openrouter.isConfigured(),
    },
    {
      id: 'backboard',
      label: prettyModel(backboard.model),
      model: backboard.model,
      hint: 'Routed through Backboard',
      configured: backboard.isConfigured(),
    },
  ]
}

/** `gpt-4o` → `GPT-4o`. Shared by the router-style vendors. */
function prettyModel(model: string): string {
  const name = model.split('/').pop() ?? model
  return name
    .split('-')
    .map((part) =>
      /^(gpt|ai|xl|hd|llm)$/i.test(part)
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join('-')
}

/** `openai/gpt-4o-mini` → `GPT-4o-Mini`. Falls back to the raw id. */
function openRouterLabel(model: string): string {
  return prettyModel(model)
}

/** Only the models a query could actually use. */
export function availableModels(): ModelChoice[] {
  return modelCatalog().filter((choice) => choice.configured)
}
