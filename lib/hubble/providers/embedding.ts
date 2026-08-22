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
import type { DeadlineOptions, EmbeddingProvider } from '@/lib/hubble/providers/types'
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

export function resolveEmbeddingProvider(): EmbeddingProvider {
  return new OllamaEmbeddingProvider()
}
