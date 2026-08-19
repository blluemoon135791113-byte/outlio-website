import 'server-only'

/**
 * Chunking and retrieval — choosing the few passages the model gets to see.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  RETRIEVAL WORKS WITH NOTHING INSTALLED.                                  ║
 * ║                                                                          ║
 * ║  The spec asks for Ollama embeddings, and `embedText` uses them when     ║
 * ║  they exist. They frequently will not: Ollama is a separate install and  ║
 * ║  a several-gigabyte model download. So the DEFAULT ranker here is BM25,  ║
 * ║  which is pure arithmetic over the text we already hold — no service, no ║
 * ║  model, no network, no cost.                                             ║
 * ║                                                                          ║
 * ║  Vectors are an UPGRADE, not a dependency. Without them Hubble ranks     ║
 * ║  passages slightly worse; it never fails to answer. That is also the     ║
 * ║  "deterministic before AI" rule applied to retrieval itself.             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { sourceWeight } from '@/lib/hubble/source-quality'

export type Chunk = {
  /** Which page it came from, so a retrieved passage can be cited. */
  pageId: string
  url: string
  title: string | null
  ordinal: number
  content: string
  embedding?: number[] | null
}

export type ScoredChunk = Chunk & { score: number }

/**
 * Target chunk size in characters.
 *
 * Big enough that a passage carries its own context — a sentence fragment is
 * unciteable — and small enough that a dozen fit in a prompt without crowding
 * out the question.
 */
const TARGET_CHARS = 1_100
const OVERLAP_CHARS = 150
const MIN_CHUNK_CHARS = 120

/**
 * Splits text on paragraph boundaries, never mid-sentence where avoidable.
 *
 * ⚠️ OVERLAP IS NOT WASTE. A fact that straddles a boundary — "raised $12m"
 * ending one chunk and "in a Series A led by…" starting the next — is
 * retrievable from neither half alone without it.
 */
export function chunkText(text: string): string[] {
  const normalised = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (normalised.length === 0) return []
  if (normalised.length <= TARGET_CHARS) return [normalised]

  const paragraphs = normalised.split(/\n\n+/)
  const chunks: string[] = []
  let current = ''

  const push = () => {
    const value = current.trim()
    if (value.length >= MIN_CHUNK_CHARS) chunks.push(value)
    else if (value && chunks.length > 0) chunks[chunks.length - 1] += `\n\n${value}`
    else if (value) chunks.push(value)
  }

  for (const paragraph of paragraphs) {
    // A single paragraph longer than the target is split on sentences.
    if (paragraph.length > TARGET_CHARS) {
      push()
      current = ''
      const sentences = paragraph.split(/(?<=[.!?])\s+/)
      let buffer = ''
      for (const sentence of sentences) {
        if (buffer.length + sentence.length > TARGET_CHARS && buffer) {
          chunks.push(buffer.trim())
          buffer = buffer.slice(-OVERLAP_CHARS)
        }
        buffer += `${sentence} `
      }
      if (buffer.trim().length >= MIN_CHUNK_CHARS) chunks.push(buffer.trim())
      continue
    }

    if (current.length + paragraph.length > TARGET_CHARS && current) {
      push()
      current = `${current.slice(-OVERLAP_CHARS)}\n\n`
    }
    current += `${paragraph}\n\n`
  }

  push()
  return chunks.filter((chunk) => chunk.length > 0)
}

/* -------------------------------------------------------------------------- *
 * Lexical scoring — the always-available ranker
 * -------------------------------------------------------------------------- */

/** Words carrying no topical signal; scoring on them ranks noise. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that',
  'as', 'by', 'from', 'has', 'have', 'had', 'do', 'does', 'did', 'what', 'which',
  'who', 'whom', 'how', 'when', 'where', 'why', 'their', 'they', 'them', 'you',
  'your', 'we', 'our', 'us', 'about', 'into', 'than', 'then', 'there', 'these',
])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((token) => token.length > 1 && token.length < 40 && !STOPWORDS.has(token))
}

/** BM25 tuning constants, at their standard values. */
const K1 = 1.5
const B = 0.75

/**
 * BM25 over the candidate chunks.
 *
 * Chosen over naive term counting because it does the two things that matter
 * for this corpus: it discounts terms common across every page (every page on
 * a company site says the company's name) and it stops long pages from winning
 * on length alone.
 */
export function scoreLexical(query: string, chunks: readonly Chunk[]): ScoredChunk[] {
  const terms = tokenize(query)
  if (terms.length === 0 || chunks.length === 0) {
    return chunks.map((chunk) => ({ ...chunk, score: 0 }))
  }

  const docs = chunks.map((chunk) => tokenize(chunk.content))
  const avgLength = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length || 1

  // How many chunks contain each term at least once.
  const docFrequency = new Map<string, number>()
  for (const term of new Set(terms)) {
    docFrequency.set(term, docs.filter((doc) => doc.includes(term)).length)
  }

  return chunks.map((chunk, index) => {
    const doc = docs[index] ?? []
    const counts = new Map<string, number>()
    for (const token of doc) counts.set(token, (counts.get(token) ?? 0) + 1)

    let score = 0
    for (const term of new Set(terms)) {
      const frequency = counts.get(term) ?? 0
      if (frequency === 0) continue

      const n = docFrequency.get(term) ?? 0
      // +1 inside the log keeps the idf positive even for a ubiquitous term.
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5))
      const norm = frequency * (K1 + 1)
      const denom = frequency + K1 * (1 - B + (B * doc.length) / avgLength)
      score += idf * (norm / denom)
    }

    return { ...chunk, score }
  })
}

/* -------------------------------------------------------------------------- *
 * Vector scoring — used only when embeddings exist
 * -------------------------------------------------------------------------- */

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0

  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    normA += x * x
    normB += y * y
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  return magnitude === 0 ? 0 : dot / magnitude
}

/**
 * Ranks chunks for a question, using vectors when available and lexical always.
 *
 * ⚠️ HYBRID RATHER THAN EITHER/OR. Vectors find a passage that means the right
 * thing in different words; lexical reliably finds an exact rare token — a
 * product name, a person, a number — which embeddings are notoriously prone to
 * smoothing away. Combining them beats either alone, and it degrades cleanly
 * to pure lexical when `queryEmbedding` is null.
 */
export function retrieve(
  query: string,
  chunks: readonly Chunk[],
  queryEmbedding: number[] | null,
  limit: number,
  /**
   * The company's own domain, so its site outranks commentary about it.
   * Optional: retrieval still works without it, just without the promotion.
   */
  companyDomain: string | null = null,
): ScoredChunk[] {
  const lexical = scoreLexical(query, chunks)

  const maxLexical = Math.max(...lexical.map((chunk) => chunk.score), 0)
  const scored = lexical.map((chunk) => {
    // Normalised so the two scores are comparable before weighting.
    const lexicalScore = maxLexical > 0 ? chunk.score / maxLexical : 0

    /*
     * ⚠️ RELEVANCE IS NOT CREDIBILITY.
     *
     * Contact brokers auto-generate FAQ blocks echoing the question verbatim,
     * so they out-score the primary source that simply states the fact. See
     * source-quality.ts for the real case that motivated this.
     */
    const weight = sourceWeight(chunk.url, companyDomain)

    if (!queryEmbedding || !chunk.embedding || chunk.embedding.length === 0) {
      return { ...chunk, score: lexicalScore * weight }
    }

    const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding)
    return { ...chunk, score: (0.5 * lexicalScore + 0.5 * vectorScore) * weight }
  })

  return scored
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * Caps how much of one page can dominate the evidence set.
 *
 * ⚠️ WITHOUT THIS, ONE VERBOSE PAGE ANSWERS EVERY QUESTION. Its chunks fill
 * every slot, corroboration becomes impossible — a second source can never get
 * in — and every answer is sourced to a single URL.
 */
export function diversify(chunks: readonly ScoredChunk[], perPage: number, limit: number): ScoredChunk[] {
  const seen = new Map<string, number>()
  const kept: ScoredChunk[] = []

  for (const chunk of chunks) {
    const count = seen.get(chunk.pageId) ?? 0
    if (count >= perPage) continue
    seen.set(chunk.pageId, count + 1)
    kept.push(chunk)
    if (kept.length >= limit) break
  }

  return kept
}
