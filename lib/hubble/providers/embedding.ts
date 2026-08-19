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
import type { EmbeddingProvider } from '@/lib/hubble/providers/types'

/** Small, fast, and good enough for passage ranking. */
const DEFAULT_MODEL = 'nomic-embed-text'
const DEFAULT_DIMENSIONS = 768

/** Local inference on CPU is not fast; this is generous but bounded. */
const TIMEOUT_MS = 20_000

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
    const value = process.env.OLLAMA_URL?.trim()
    if (!value) return null
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
    } catch {
      return null
    }
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

  async embed(texts: readonly string[]): Promise<number[][] | null> {
    const base = this.baseUrl
    if (!base || texts.length === 0) return null

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(`${base}/api/embed`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
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
