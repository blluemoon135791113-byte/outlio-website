import 'server-only'

/**
 * Embeddings, behind one interface.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS IS THE ONE PROVIDER THAT IS ALLOWED TO BE ABSENT.               ║
 * ║                                                                          ║
 * ║  Ollama is a separate install plus a multi-gigabyte model download. Most ║
 * ║  machines running Outlio today do not have it. Rather than gate Ask      ║
 * ║  Hubble behind that, `embed()` returns NULL when unavailable and         ║
 * ║  retrieval falls back to BM25 — arithmetic over text we already hold.    ║
 * ║                                                                          ║
 * ║  Absent embeddings mean a slightly worse ranker. They never mean a       ║
 * ║  failed answer, and no caller should treat null as an error.             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import type { DeadlineOptions, EmbedOptions, EmbeddingProvider } from '@/lib/hubble/providers/types'
import { ollamaConfig } from '@/lib/hubble/providers/ollama-config'

/** Small, fast, and good enough for passage ranking. */
const DEFAULT_MODEL = 'nomic-embed-text'
const DEFAULT_DIMENSIONS = 768

/** Local inference on CPU is not fast; this is generous but bounded. */
const TIMEOUT_MS = 20_000

function timeoutFor(options: DeadlineOptions, cap: number): number {
  if (options.deadlineAt === undefined) return cap
  return Math.max(1, Math.min(cap, options.deadlineAt - Date.now()))
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama'

  get model(): string {
    return process.env.OLLAMA_EMBED_MODEL?.trim() || DEFAULT_MODEL
  }

  get dimensions(): number {
    const raw = Number.parseInt(process.env.OLLAMA_EMBED_DIMENSIONS ?? '', 10)
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DIMENSIONS
  }

  private get baseUrl(): string | null {
    return ollamaConfig()?.baseUrl ?? null
  }

  /**
   * Configuration is explicit, never assumed.
   *
   * ⚠️ IT DOES NOT DEFAULT TO localhost:11434. Probing a local port on every
   * question would add a failed connection to the latency of every request on
   * the many machines where Ollama is not running. Setting `OLLAMA_URL` is how
   * an operator says it is there.
   */
  isConfigured(): boolean {
    return this.baseUrl !== null
  }

  /**
   * Whether the embedding MODEL is actually pulled.
   *
   * ╔══════════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ CONFIGURED IS NOT THE SAME AS USABLE, AND CONFLATING THEM COSTS.     ║
   * ║                                                                          ║
   * ║  Setting OLLAMA_URL against a running Ollama with no embedding model     ║
   * ║  pulled makes `isConfigured()` true while every `embed()` fails. The     ║
   * ║  fallback still answers, so nothing looks broken — the operator simply   ║
   * ║  never learns that the vectors they think they enabled are not running,  ║
   * ║  and every question pays a doomed request first.                         ║
   * ║                                                                          ║
   * ║  Resolved ONCE per process and cached: this is a deployment fact, not a  ║
   * ║  per-request one, and re-probing on every question is the cost this      ║
   * ║  exists to avoid.                                                        ║
   * ╚══════════════════════════════════════════════════════════════════════════╝
   */
  private available: Promise<boolean> | null = null

  async isUsable(options: DeadlineOptions = {}): Promise<boolean> {
    const base = this.baseUrl
    if (!base) return false
    if (options.deadlineAt !== undefined && options.deadlineAt <= Date.now()) return false

    this.available ??= (async () => {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutFor(options, 3_000))
        const response = await fetch(`${base}/api/tags`, {
          signal: controller.signal,
          headers: ollamaConfig()?.headers,
        })
        clearTimeout(timer)

        if (!response.ok) return false

        const payload = (await response.json()) as { models?: Array<{ name?: string }> }
        const wanted = this.model

        // Ollama reports `nomic-embed-text:latest` for `nomic-embed-text`.
        return (payload.models ?? []).some((entry) => {
          const name = entry.name ?? ''
          return name === wanted || name.split(':')[0] === wanted.split(':')[0]
        })
      } catch {
        return false
      }
    })()

    return this.available
  }

  async embed(
    texts: readonly string[],
    options: DeadlineOptions = {},
  ): Promise<number[][] | null> {
    const base = this.baseUrl
    if (!base || texts.length === 0) return null
    if (options.deadlineAt !== undefined && options.deadlineAt <= Date.now()) return null

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutFor(options, TIMEOUT_MS))

    try {
      const response = await fetch(`${base}/api/embed`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', ...ollamaConfig()?.headers },
        body: JSON.stringify({ model: this.model, input: [...texts] }),
      })

      if (!response.ok) return null

      const payload = (await response.json()) as { embeddings?: unknown }
      const embeddings = payload.embeddings

      if (!Array.isArray(embeddings) || embeddings.length !== texts.length) return null

      const vectors: number[][] = []
      for (const vector of embeddings) {
        if (!Array.isArray(vector) || vector.length === 0) return null
        if (!vector.every((value) => typeof value === 'number' && Number.isFinite(value))) return null
        vectors.push(vector as number[])
      }

      return vectors
    } catch {
      // Unreachable, timed out, or a model that is not pulled. All the same
      // outcome: no vectors, and lexical retrieval carries the question.
      return null
    } finally {
      clearTimeout(timer)
    }
  }
}

const GEMINI_MODEL = 'gemini-embedding-001'
const GEMINI_DIMENSIONS = 768
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
/** The API's documented cap on requests in one batchEmbedContents call. */
const GEMINI_BATCH = 100
/** How long a failed key probe is trusted before the next question re-probes. */
const PROBE_RETRY_MS = 60_000

/**
 * Gemini embeddings — the production embedder (2026-10-12).
 *
 * Ollama only ever ran on a developer's machine; on Vercel `OLLAMA_URL` points
 * at a loopback address nothing answers, so production had no vectors at all
 * and every question was ranked lexically.
 *
 * Keys, in order: `VECTOR_SEARCH_API` (a key dedicated to embeddings, usable
 * once the Generative Language API is enabled on its project), then
 * `GEMINI_API_KEY`. The first key that answers a probe is used for the life of
 * the process, so enabling the dedicated key takes effect on the next cold
 * start with no deploy.
 *
 * ⚠️ WHAT IS SENT: fetched public web passages and the user's question. Never
 * typed research evidence — those chunks carry no embedding by construction
 * (`researchEvidenceToChunks`), so a person's email or phone is never sent here.
 */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini'
  readonly dimensions = GEMINI_DIMENSIONS

  /*
   * Recorded with every stored vector. The size is part of it: the same model
   * truncated to a different size is a different vector space.
   */
  readonly model = `${GEMINI_MODEL}@${GEMINI_DIMENSIONS}`

  private get keys(): string[] {
    return [process.env.VECTOR_SEARCH_API, process.env.GEMINI_API_KEY]
      .map((key) => key?.trim() ?? '')
      .filter((key, index, all) => key !== '' && all.indexOf(key) === index)
  }

  isConfigured(): boolean {
    return this.keys.length > 0
  }

  /**
   * The key that answered, resolved once per process — see the note on
   * `OllamaEmbeddingProvider`.
   *
   * ⚠️ A FAILED PROBE IS NOT CACHED FOREVER. It runs inside the first
   * question's deadline, so one 429 or network blip at a cold start would
   * otherwise switch vectors off for the life of a long-lived instance,
   * silently. A failure is retried after PROBE_RETRY_MS; a success is kept.
   */
  private usableKey: Promise<string | null> | null = null
  private probeFailedAt: number | null = null

  async isUsable(options: DeadlineOptions = {}): Promise<boolean> {
    if (!this.isConfigured()) return false
    if (options.deadlineAt !== undefined && options.deadlineAt <= Date.now()) return false

    if (this.probeFailedAt !== null && Date.now() - this.probeFailedAt >= PROBE_RETRY_MS) {
      this.usableKey = null
      this.probeFailedAt = null
    }

    this.usableKey ??= (async () => {
      for (const key of this.keys) {
        const probe = await this.request(key, ['ping'], 'query', timeoutFor(options, 5_000))
        if (probe) return key
      }
      this.probeFailedAt = Date.now()
      // The reason is not logged: it would carry nothing safe beyond this.
      console.warn('[embedding] no Gemini key answered; ranking lexically until the next probe')
      return null
    })()

    return (await this.usableKey) !== null
  }

  async embed(texts: readonly string[], options: EmbedOptions = {}): Promise<number[][] | null> {
    if (texts.length === 0) return null
    if (!(await this.isUsable(options))) return null
    const key = (await this.usableKey)!

    const vectors: number[][] = []
    for (let index = 0; index < texts.length; index += GEMINI_BATCH) {
      if (options.deadlineAt !== undefined && options.deadlineAt <= Date.now()) return null
      const batch = await this.request(
        key,
        texts.slice(index, index + GEMINI_BATCH),
        options.purpose ?? 'document',
        timeoutFor(options, TIMEOUT_MS),
      )
      // All or nothing: a partial set would misalign vectors with passages.
      if (!batch) return null
      vectors.push(...batch)
    }
    return vectors
  }

  private async request(
    key: string,
    texts: readonly string[],
    purpose: 'query' | 'document',
    timeoutMs: number,
  ): Promise<number[][] | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(`${GEMINI_ENDPOINT}/${GEMINI_MODEL}:batchEmbedContents`, {
        method: 'POST',
        signal: controller.signal,
        // The key travels in a header, never the URL, so it cannot land in a
        // request log.
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: `models/${GEMINI_MODEL}`,
            content: { parts: [{ text }] },
            taskType: purpose === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
            outputDimensionality: GEMINI_DIMENSIONS,
          })),
        }),
      })
      if (!response.ok) return null

      const payload = (await response.json()) as { embeddings?: Array<{ values?: unknown }> }
      const embeddings = payload.embeddings
      if (!Array.isArray(embeddings) || embeddings.length !== texts.length) return null

      const vectors: number[][] = []
      for (const entry of embeddings) {
        const values = entry?.values
        if (!Array.isArray(values) || values.length !== GEMINI_DIMENSIONS) return null
        if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) return null
        vectors.push(values as number[])
      }
      return vectors
    } catch {
      // Unreachable, timed out, blocked key, or quota spent: no vectors, and
      // lexical retrieval carries the question.
      return null
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Gemini wherever a key is set — production and local alike, because local
 * development reads the PRODUCTION database (`npm run dev`), and two models
 * writing one store is exactly what `embed_model` exists to keep apart.
 * `EMBEDDING_PROVIDER=ollama` opts a machine back into local inference.
 */
export function resolveEmbeddingProvider(): EmbeddingProvider {
  if (process.env.EMBEDDING_PROVIDER?.trim().toLowerCase() === 'ollama') {
    return new OllamaEmbeddingProvider()
  }
  const gemini = new GeminiEmbeddingProvider()
  return gemini.isConfigured() ? gemini : new OllamaEmbeddingProvider()
}
