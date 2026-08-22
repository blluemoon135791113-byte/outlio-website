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

export const LLM_VENDORS = ['gemini', 'groq', 'openrouter', 'cerebras', 'backboard'] as const
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
  /** Absolute budget deadline. Providers and fallbacks must all share it. */
  deadlineAt?: number
  /**
   * Runtime acceptance check owned by the caller's domain schema. JSON Schema
   * support varies by vendor; the router uses this to reject a syntactically
   * valid but unusable completion and continue to the next engine.
   */
  validate?: (value: unknown) => boolean
}

export type LlmResult =
  | { ok: true; json: unknown; vendor: LlmVendor; model: string; attempts?: LlmAttempt[] }
  | {
      ok: false
      code: 'not_configured' | 'unavailable' | 'unparseable'
      detail: string
      attempts?: LlmAttempt[]
    }

export type LlmAttempt = {
  vendor: LlmVendor
  model: string
  outcome: 'success' | 'not_configured' | 'unavailable' | 'unparseable'
  durationMs: number
  /** Sanitized operational detail; never contains a key or request body. */
  detail: string | null
}

export interface LLMProvider {
  readonly vendor: LlmVendor
  readonly model: string
  isConfigured(): boolean
  /** Returns parsed JSON. NEVER throws for a vendor problem. */
  generateJson(request: LlmRequest): Promise<LlmResult>
}

const GEMINI_HOST = 'generativelanguage.googleapis.com'
const GROQ_HOST = 'api.groq.com'
const OPENROUTER_HOST = 'openrouter.ai'
const CEREBRAS_HOST = 'api.cerebras.ai'
const BACKBOARD_HOST = 'app.backboard.io'

/**
 * Pin the production default so planner behaviour cannot drift under an alias.
 * Operators can still roll forward independently with `GEMINI_MODEL`.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash'
/** Current Cerebras public-endpoint default. Do not pin a retired model. */
export const DEFAULT_CEREBRAS_MODEL = 'gpt-oss-120b'

setHostPacing(GEMINI_HOST, 200)
setHostPacing(GROQ_HOST, 200)
setHostPacing(OPENROUTER_HOST, 200)
setHostPacing(CEREBRAS_HOST, 200)
setHostPacing(BACKBOARD_HOST, 200)

/** Long enough for a planning call, short enough not to stall a request. */
const LLM_TIMEOUT_MS = 30_000

function llmTimeout(request: LlmRequest): number {
  if (request.deadlineAt === undefined) return LLM_TIMEOUT_MS
  return Math.max(1, Math.min(LLM_TIMEOUT_MS, request.deadlineAt - Date.now()))
}

/**
 * OpenAI-compatible structured-output providers require every object to reject
 * unknown properties. Copy the caller schema and add that constraint at every
 * nesting level rather than relying on each call site to remember it.
 */
function strictJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strictJsonSchema)
  if (!value || typeof value !== 'object') return value

  const object = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      strictJsonSchema(child),
    ]),
  )

  if (object.type === 'object') object.additionalProperties = false
  return object
}

function supportsStrictSchema(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(supportsStrictSchema)
  if (!value || typeof value !== 'object') return true

  const object = value as Record<string, unknown>
  if (object.type === 'object') {
    if (!object.properties || typeof object.properties !== 'object') return false
    const propertyNames = Object.keys(object.properties as Record<string, unknown>)
    const required = Array.isArray(object.required) ? object.required : []
    if (!propertyNames.every((name) => required.includes(name))) return false
  }

  return Object.values(object).every(supportsStrictSchema)
}

function structuredResponseFormat(schema: Record<string, unknown>) {
  const strict = supportsStrictSchema(schema)
  return {
    type: 'json_schema',
    json_schema: {
      name: 'hubble_response',
      strict,
      schema: strict ? strictJsonSchema(schema) : schema,
    },
  }
}

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
          timeoutMs: llmTimeout(request),
          deadlineAt: request.deadlineAt,
          maxRetries: 0,
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
          timeoutMs: llmTimeout(request),
          deadlineAt: request.deadlineAt,
          maxRetries: 0,
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

// ---------------------------------------------------------------------------
// OpenRouter — the LLM router (OpenAI-compatible contract)
// ---------------------------------------------------------------------------

export function createOpenRouterProvider(
  model = process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini',
): LLMProvider {
  return {
    vendor: 'openrouter',
    model,

    isConfigured: () => Boolean(process.env.OPENROUTER_API_KEY),

    generateJson: async (request) => {
      const apiKey = process.env.OPENROUTER_API_KEY
      if (!apiKey) {
        return { ok: false, code: 'not_configured', detail: 'OPENROUTER_API_KEY is not set' }
      }

      try {
        const response = await requestJson<{
          choices?: Array<{ message?: { content?: string } }>
        }>({
          url: `https://${OPENROUTER_HOST}/api/v1/chat/completions`,
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}` },
          timeoutMs: llmTimeout(request),
          deadlineAt: request.deadlineAt,
          maxRetries: 0,
          body: {
            model,
            temperature: request.temperature ?? 0,
            max_tokens: request.maxOutputTokens ?? 2048,
            response_format: structuredResponseFormat(request.schema),
            provider: {
              allow_fallbacks: true,
              require_parameters: true,
              data_collection: 'deny',
            },
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

        return { ok: true, json, vendor: 'openrouter', model }
      } catch (error) {
        return { ok: false, code: 'unavailable', detail: describe(error) }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Cerebras — cloud inference (OpenAI-compatible contract)
// ---------------------------------------------------------------------------

export function createCerebrasProvider(
  model = process.env.CEREBRAS_MODEL ?? DEFAULT_CEREBRAS_MODEL,
): LLMProvider {
  return {
    vendor: 'cerebras',
    model,

    isConfigured: () => Boolean(process.env.CEREBRAS_API_KEY),

    generateJson: async (request) => {
      const apiKey = process.env.CEREBRAS_API_KEY
      if (!apiKey) {
        return { ok: false, code: 'not_configured', detail: 'CEREBRAS_API_KEY is not set' }
      }

      try {
        const response = await requestJson<{
          choices?: Array<{ message?: { content?: string } }>
        }>({
          url: `https://${CEREBRAS_HOST}/v1/chat/completions`,
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}` },
          timeoutMs: llmTimeout(request),
          deadlineAt: request.deadlineAt,
          maxRetries: 0,
          body: {
            model,
            temperature: request.temperature ?? 0,
            max_tokens: request.maxOutputTokens ?? 2048,
            response_format: structuredResponseFormat(request.schema),
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

        return { ok: true, json, vendor: 'cerebras', model }
      } catch (error) {
        return { ok: false, code: 'unavailable', detail: describe(error) }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Backboard — unified LLM + memory API
//
// Not OpenAI-compatible at the transport level: it authenticates with the
// X-API-Key header and answers over POST /threads/messages. The planning
// contract is the same — a system prompt, a user question, JSON output.
// ---------------------------------------------------------------------------

export function createBackboardProvider(
  model = process.env.BACKBOARD_MODEL ?? 'gpt-4o',
  provider = process.env.BACKBOARD_LLM_PROVIDER ?? 'openai',
): LLMProvider {
  return {
    vendor: 'backboard',
    model,

    isConfigured: () => Boolean(process.env.BACKBOARD_API_KEY),

    generateJson: async (request) => {
      const apiKey = process.env.BACKBOARD_API_KEY
      if (!apiKey) {
        return { ok: false, code: 'not_configured', detail: 'BACKBOARD_API_KEY is not set' }
      }

      try {
        const response = await requestJson<{ content?: string | null }>({
          url: `https://${BACKBOARD_HOST}/api/threads/messages`,
          method: 'POST',
          headers: { 'x-api-key': apiKey },
          timeoutMs: llmTimeout(request),
          deadlineAt: request.deadlineAt,
          maxRetries: 0,
          body: {
            content: request.user,
            system_prompt: request.system,
            llm_provider: provider,
            model_name: model,
            json_output: true,
            stream: false,
            memory: 'off',
            web_search: 'off',
          },
        })

        const text = response.content
        if (!text) return { ok: false, code: 'unparseable', detail: 'empty completion' }

        const json = safeParse(text)
        if (json === undefined) {
          return { ok: false, code: 'unparseable', detail: 'completion was not JSON' }
        }

        return { ok: true, json, vendor: 'backboard', model }
      } catch (error) {
        return { ok: false, code: 'unavailable', detail: describe(error) }
      }
    },
  }
}

const LLM_FAILED_AT = new Map<string, number>()
const LLM_COOLDOWN_MS = 60_000

function providerKey(provider: LLMProvider): string {
  return `${provider.vendor}:${provider.model}`
}

function llmCoolingDown(provider: LLMProvider): boolean {
  const key = providerKey(provider)
  const failedAt = LLM_FAILED_AT.get(key)
  if (failedAt === undefined) return false
  if (Date.now() - failedAt < LLM_COOLDOWN_MS) return true
  LLM_FAILED_AT.delete(key)
  return false
}

/** Exported for deterministic tests; production state is process-lifetime. */
export function resetLlmCircuitBreaker(): void {
  LLM_FAILED_AT.clear()
}

/**
 * Tries configured providers in order. A dead provider is cooled down for the
 * rest of the request burst, and malformed JSON falls through too: once the
 * provider has failed constrained output, retrying the same engine does not
 * make the router resilient.
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
      const attempts: LlmAttempt[] = []
      let lastFailure: LlmResult = {
        ok: false,
        code: 'not_configured',
        detail: 'No language model is configured',
      }

      for (const provider of candidates) {
        if (!provider.isConfigured()) continue
        if (llmCoolingDown(provider)) {
          lastFailure = {
            ok: false,
            code: 'unavailable',
            detail: 'Configured language models are cooling down after an upstream failure',
          }
          attempts.push({
            vendor: provider.vendor,
            model: provider.model,
            outcome: 'unavailable',
            durationMs: 0,
            detail: 'circuit breaker cooling down',
          })
          continue
        }
        if (request.deadlineAt !== undefined && request.deadlineAt <= Date.now()) {
          return { ok: false, code: 'unavailable', detail: 'LLM deadline exceeded' }
        }

        const attemptStarted = Date.now()
        const result = await provider.generateJson(request)
        attempts.push({
          vendor: provider.vendor,
          model: provider.model,
          outcome: result.ok ? 'success' : result.code,
          durationMs: Date.now() - attemptStarted,
          detail: result.ok ? null : result.detail,
        })
        if (result.ok) {
          if (request.validate && !request.validate(result.json)) {
            lastFailure = {
              ok: false,
              code: 'unparseable',
              detail: 'completion did not match the requested schema',
            }
            continue
          }
          LLM_FAILED_AT.delete(providerKey(provider))
          return { ...result, attempts }
        }

        lastFailure = result
        if (result.code === 'unavailable') {
          LLM_FAILED_AT.set(providerKey(provider), Date.now())
        }
      }

      return { ...lastFailure, attempts }
    },
  }
}

/**
 * The provider chain this deployment uses.
 *
 * Falls back both at configuration time and at request time. A configured but
 * retired model, exhausted vendor, or transient outage therefore does not take
 * planning down when the alternative vendor is available.
 *
 * `LLM_PROVIDER` names the preferred vendor and is hoisted to the front of the
 * chain; everything else stays in a fixed order. The fallback layer skips any
 * vendor whose key is absent, so an unset key degrades instead of failing.
 */
export function resolveLlmProvider(
  preferred: string | undefined = process.env.LLM_PROVIDER,
): LLMProvider {
  const providers: Record<LlmVendor, LLMProvider> = {
    gemini: createGeminiProvider(),
    groq: createGroqProvider(),
    openrouter: createOpenRouterProvider(),
    cerebras: createCerebrasProvider(),
    backboard: createBackboardProvider(),
  }

  const preferredVendor =
    preferred !== undefined && preferred in providers ? (preferred as LlmVendor) : undefined

  const candidates: LLMProvider[] = preferredVendor
    ? [
        providers[preferredVendor],
        ...LLM_VENDORS.filter((vendor) => vendor !== preferredVendor).map(
          (vendor) => providers[vendor],
        ),
      ]
    : LLM_VENDORS.map((vendor) => providers[vendor])

  return createFallbackLlmProvider(candidates)
}
