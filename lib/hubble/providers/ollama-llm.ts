import 'server-only'

/**
 * Ollama as an LLM provider, slotted into the existing vendor abstraction.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  LOCAL FIRST, AND THAT IS THE WHOLE POINT.                               ║
 * ║                                                                          ║
 * ║  Every other vendor in `lib/intelligence/llm/provider.ts` is a hosted    ║
 * ║  API: the question, the CRM record and the retrieved evidence all leave  ║
 * ║  the machine. This one does not. Nothing about a customer's prospects    ║
 * ║  reaches a third party.                                                  ║
 * ║                                                                          ║
 * ║  ⚠️ A `:cloud` MODEL IS NOT LOCAL. Ollama will happily serve             ║
 * ║  `glm-4.7:cloud`, which proxies to ollama.com — the data leaves anyway,  ║
 * ║  while looking local in every log. `isLocalModel` refuses those names    ║
 * ║  outright rather than let the privacy claim quietly become false.       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ A 7B MODEL IS NOT GEMINI. It is measurably weaker at the discipline this
 * product depends on — saying "unknown" instead of producing a plausible guess.
 * The schema validation and the source-tier confidence ceiling are what keep a
 * weaker model honest, and they matter MORE here, not less.
 */
import type { LlmRequest, LlmResult, LLMProvider, LlmVendor } from '@/lib/intelligence/llm/provider'

const DEFAULT_MODEL = 'qwen2.5:7b-instruct'

/**
 * Local inference is slow. A 7B model on CPU can take 30s+ for a long
 * synthesis, and cutting it off early would waste the research that preceded
 * it — the expensive part of the request.
 */
const TIMEOUT_MS = 120_000

/**
 * Cloud-suffixed models proxy to ollama.com. Local in name only.
 *
 * ⚠️ THE SEPARATOR IS EITHER `:` OR `-`. Ollama names them both ways —
 * `glm-4.7:cloud` but `qwen3-coder:480b-cloud` — and matching only `:cloud`
 * let the second through as "local" while it shipped every question to
 * ollama.com. Both spellings, or the privacy guarantee is a lie for half the
 * catalogue.
 */
export function isLocalModel(model: string): boolean {
  return !/[-:]cloud$/i.test(model.trim())
}

export class OllamaLlmProvider implements LLMProvider {
  /*
   * Declared as an existing vendor so this drops into the current resolver
   * without widening the `LlmVendor` union across the whole codebase. The
   * `model` string is what actually identifies it in logs.
   */
  readonly vendor: LlmVendor = 'openrouter'

  get model(): string {
    return process.env.OLLAMA_LLM_MODEL?.trim() || DEFAULT_MODEL
  }

  private get baseUrl(): string | null {
    const value = process.env.OLLAMA_URL?.trim()
    if (!value) return null
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
    } catch {
      return null
    }
  }

  isConfigured(): boolean {
    // ⚠️ A cloud-suffixed model counts as NOT configured: falling through to
    // the hosted waterfall is honest, silently proxying to ollama.com is not.
    return this.baseUrl !== null && isLocalModel(this.model)
  }

  private available: Promise<boolean> | null = null

  /**
   * Whether the model is actually PULLED, not merely named.
   *
   * ╔══════════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ CONFIGURED IS NOT USABLE — THE SAME TRAP AS THE EMBEDDING PROVIDER.  ║
   * ║                                                                          ║
   * ║  Setting OLLAMA_LLM_MODEL to a model that has not finished downloading   ║
   * ║  makes `isConfigured()` true while every call 404s. The waterfall would  ║
   * ║  then burn TWO failed local calls before falling back, on every single   ║
   * ║  question — pure latency, invisible in the result.                       ║
   * ║                                                                          ║
   * ║  Checked once per process and cached: a model being present is a         ║
   * ║  deployment fact, not a per-request one.                                  ║
   * ╚══════════════════════════════════════════════════════════════════════════╝
   */
  async isUsable(): Promise<boolean> {
    const base = this.baseUrl
    if (!base || !isLocalModel(this.model)) return false

    this.available ??= (async () => {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 3_000)
        const response = await fetch(`${base}/api/tags`, { signal: controller.signal })
        clearTimeout(timer)
        if (!response.ok) return false

        const payload = (await response.json()) as { models?: Array<{ name?: string }> }
        const wanted = this.model.split(':')[0]

        return (payload.models ?? []).some((entry) => (entry.name ?? '').split(':')[0] === wanted)
      } catch {
        return false
      }
    })()

    return this.available
  }

  async generateJson(request: LlmRequest): Promise<LlmResult> {
    const base = this.baseUrl
    if (!base) return { ok: false, code: 'not_configured', detail: 'OLLAMA_URL is not set' }

    if (!isLocalModel(this.model)) {
      return {
        ok: false,
        code: 'not_configured',
        detail: `${this.model} proxies to ollama.com and is not local`,
      }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          /*
           * ⚠️ `format` TAKES THE SCHEMA, NOT JUST "json".
           *
           * Ollama constrains decoding to the schema when given one, which is
           * the difference between a 7B model reliably returning the right
           * shape and it returning prose that has to be discarded. Passing
           * merely "json" would leave field names and enums to chance.
           */
          format: request.schema,
          options: {
            temperature: request.temperature ?? 0.1,
            num_predict: request.maxOutputTokens ?? 1200,
          },
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
        }),
      })

      if (!response.ok) {
        return { ok: false, code: 'unavailable', detail: `Ollama returned ${response.status}` }
      }

      const payload = (await response.json()) as { message?: { content?: string } }
      const content = payload.message?.content?.trim()

      if (!content) {
        return { ok: false, code: 'unparseable', detail: 'Ollama returned an empty message' }
      }

      try {
        return { ok: true, json: JSON.parse(content), vendor: this.vendor, model: this.model }
      } catch {
        return { ok: false, code: 'unparseable', detail: 'Ollama returned invalid JSON' }
      }
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError'
      return {
        ok: false,
        code: 'unavailable',
        detail: aborted ? `no response in ${TIMEOUT_MS}ms` : 'Ollama is unreachable',
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Ollama first, the configured hosted vendor second.
 *
 * ⚠️ THE FALLBACK IS NOT A DETAIL. Local inference dies for ordinary reasons —
 * a restart, a model still loading, an out-of-memory kill. Without a fallback
 * every one of those turns a question that already cost 40 seconds of real web
 * fetching into no answer at all. Ollama is tried twice before yielding,
 * because a cold model load frequently succeeds on the second attempt.
 */
export class LlmWaterfall implements LLMProvider {
  constructor(
    private readonly local: LLMProvider,
    private readonly hosted: LLMProvider,
  ) {}

  get vendor(): LlmVendor {
    return this.local.isConfigured() ? this.local.vendor : this.hosted.vendor
  }

  get model(): string {
    return this.local.isConfigured() ? this.local.model : this.hosted.model
  }

  isConfigured(): boolean {
    return this.local.isConfigured() || this.hosted.isConfigured()
  }

  async generateJson(request: LlmRequest): Promise<LlmResult> {
    /*
     * ⚠️ `isUsable`, NOT `isConfigured`. A named-but-unpulled model is
     * configured and useless; trying it twice per question is pure latency.
     */
    const probe = this.local as unknown as { isUsable?: () => Promise<boolean> }
    const localReady =
      this.local.isConfigured() &&
      (typeof probe.isUsable === 'function' ? await probe.isUsable() : true)

    if (localReady) {
      const first = await this.local.generateJson(request)
      if (first.ok) return first

      // A cold model load often fails once and succeeds immediately after.
      const second = await this.local.generateJson(request)
      if (second.ok) return second

      if (!this.hosted.isConfigured()) return second
    }

    return this.hosted.generateJson(request)
  }
}
