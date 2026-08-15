import 'server-only'

/**
 * The LLM abstraction.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WHAT THE MODEL IS FOR, AND WHAT IT IS NOT FOR.                          ║
 * ║                                                                          ║
 * ║  FOR:  understanding a question, turning it into structured criteria,    ║
 * ║        deciding whether clarification is needed, explaining a result.    ║
 * ║                                                                          ║
 * ║  NOT FOR: stating a fact. It never supplies funding figures, headcounts, ║
 * ║        technologies, emails, or dates. Those come from providers with a  ║
 * ║        source URL attached, or they stay `unknown` (spec §5, §16).       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Vendor-neutral on purpose: Outlio owns the orchestration, and a model is
 * replaceable infrastructure like any other provider (spec §4).
 */
import { requestJson, setHostPacing, ProviderHttpError } from '@/lib/intelligence/http'

export const LLM_VENDORS = ['gemini', 'groq'] as const
export type LlmVendor = (typeof LLM_VENDORS)[number]

export type LlmRequest = {
  /** Rules and context. Never contains lead records. */
  system: string
  /** The user's question, verbatim. */
  user: string
  /** JSON Schema the response must satisfy. */
  schema: Record<string, unknown>
  /** Low by default: planning is classification, not creative writing. */
  temperature?: number
  maxOutputTokens?: number
}

export type LlmResult =
  | { ok: true; json: unknown; vendor: LlmVendor; model: string }
  | { ok: false; code: 'not_configured' | 'unavailable' | 'unparseable'; detail: string }

export interface LLMProvider {
  readonly vendor: LlmVendor
  readonly model: string
  isConfigured(): boolean
  /** Returns parsed JSON. NEVER throws for a vendor problem. */
  generateJson(request: LlmRequest): Promise<LlmResult>
}

const GEMINI_HOST = 'generativelanguage.googleapis.com'
const GROQ_HOST = 'api.groq.com'

/**
 * Pin the production default so planner behaviour cannot drift under an alias.
 * Operators can still roll forward independently with `GEMINI_MODEL`.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash'

setHostPacing(GEMINI_HOST, 200)
setHostPacing(GROQ_HOST, 200)

/** Long enough for a planning call, short enough not to stall a request. */
const LLM_TIMEOUT_MS = 30_000

function safeParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text)
  } catch {
    // Models occasionally wrap JSON in a markdown fence despite being told not
    // to. Recovering that is worth one attempt; anything else is a failure.
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
    if (!fenced?.[1]) return undefined
    try {
      return JSON.parse(fenced[1])
    } catch {
      return undefined
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof ProviderHttpError) return `${error.code} from ${error.host}`
  return 'llm request failed'
}

// ---------------------------------------------------------------------------
// Gemini — the default
// ---------------------------------------------------------------------------

export function createGeminiProvider(
  model = process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
): LLMProvider {
  return {
    vendor: 'gemini',
    model,

    isConfigured: () => Boolean(process.env.GEMINI_API_KEY),

    generateJson: async (request) => {
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey) {
        return { ok: false, code: 'not_configured', detail: 'GEMINI_API_KEY is not set' }
      }

      try {
        const response = await requestJson<{
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        }>({
          url: `https://${GEMINI_HOST}/v1beta/models/${model}:generateContent`,
          method: 'POST',
          // The key goes in a header, never the query string — a URL with a
          // key in it ends up in logs and error messages.
          headers: { 'x-goog-api-key': apiKey },
          timeoutMs: LLM_TIMEOUT_MS,
          body: {
            systemInstruction: { parts: [{ text: request.system }] },
            contents: [{ role: 'user', parts: [{ text: request.user }] }],
            generationConfig: {
              temperature: request.temperature ?? 0,
              maxOutputTokens: request.maxOutputTokens ?? 2048,
              // Constrained decoding: the model cannot return prose at all.
              responseMimeType: 'application/json',
              responseSchema: request.schema,
            },
          },
        })

        const text = response.candidates?.[0]?.content?.parts?.[0]?.text
        if (!text) return { ok: false, code: 'unparseable', detail: 'empty completion' }

        const json = safeParse(text)
        if (json === undefined) {
          return { ok: false, code: 'unparseable', detail: 'completion was not JSON' }
        }

        return { ok: true, json, vendor: 'gemini', model }
      } catch (error) {
        return { ok: false, code: 'unavailable', detail: describe(error) }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Groq — the configured alternative
// ---------------------------------------------------------------------------

export function createGroqProvider(
  model = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
): LLMProvider {
  return {
    vendor: 'groq',
    model,

    isConfigured: () => Boolean(process.env.GROQ_API_KEY),

    generateJson: async (request) => {
      const apiKey = process.env.GROQ_API_KEY
      if (!apiKey) {
        return { ok: false, code: 'not_configured', detail: 'GROQ_API_KEY is not set' }
      }

      try {
        const response = await requestJson<{
          choices?: Array<{ message?: { content?: string } }>
        }>({
          url: `https://${GROQ_HOST}/openai/v1/chat/completions`,
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}` },
          timeoutMs: LLM_TIMEOUT_MS,
          body: {
            model,
            temperature: request.temperature ?? 0,
            max_tokens: request.maxOutputTokens ?? 2048,
            // Groq's OpenAI-compatible API guarantees syntactic JSON but not
            // the shape, so the schema is repeated in the prompt and Zod is
            // still the thing that decides.
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
          },
        })

        const text = response.choices?.[0]?.message?.content
        if (!text) return { ok: false, code: 'unparseable', detail: 'empty completion' }

        const json = safeParse(text)
        if (json === undefined) {
          return { ok: false, code: 'unparseable', detail: 'completion was not JSON' }
        }

        return { ok: true, json, vendor: 'groq', model }
      } catch (error) {
        return { ok: false, code: 'unavailable', detail: describe(error) }
      }
    },
  }
}

/**
 * Tries the preferred configured provider, then a configured alternative when
 * the first vendor is unavailable. An invalid completion stays with the same
 * vendor so the planner's schema-feedback retry can correct it without buying
 * an unnecessary second-vendor call.
 */
export function createFallbackLlmProvider(candidates: LLMProvider[]): LLMProvider {
  const primary = candidates.find((provider) => provider.isConfigured()) ?? candidates[0]

  if (!primary) {
    throw new Error('createFallbackLlmProvider requires at least one provider')
  }

  return {
    vendor: primary.vendor,
    model: primary.model,
    isConfigured: () => candidates.some((provider) => provider.isConfigured()),
    generateJson: async (request) => {
      let lastFailure: LlmResult = {
        ok: false,
        code: 'not_configured',
        detail: 'No language model is configured',
      }

      for (const provider of candidates) {
        if (!provider.isConfigured()) continue

        const result = await provider.generateJson(request)
        if (result.ok) return result

        lastFailure = result
        if (result.code === 'unparseable') return result
      }

      return lastFailure
    },
  }
}

/**
 * The provider chain this deployment uses.
 *
 * Falls back both at configuration time and at request time. A configured but
 * retired model, exhausted vendor, or transient outage therefore does not take
 * planning down when the alternative vendor is available.
 */
export function resolveLlmProvider(
  preferred: string | undefined = process.env.LLM_PROVIDER,
): LLMProvider {
  const candidates: LLMProvider[] =
    preferred === 'groq'
      ? [createGroqProvider(), createGeminiProvider()]
      : [createGeminiProvider(), createGroqProvider()]

  return createFallbackLlmProvider(candidates)
}
