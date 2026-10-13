/**
 * Gemini embeddings — the production embedder.
 *
 * Pinned: the dedicated key is tried first and a blocked key falls through to
 * the next; the key travels in a header, never the URL; questions and passages
 * are embedded with their own task types; a malformed or partial response is
 * no vectors rather than misaligned ones; nothing configured is null, never a
 * throw; the resolver prefers Gemini unless a machine opts into Ollama; and a
 * stored vector from another model is never ranked against a Gemini query.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Call = { url: string; key: string | null; body: { requests: Array<Record<string, unknown>> } }
let calls: Call[] = []
let blockedKeys = new Set<string>()
let respond: (call: Call) => unknown = (call) => ({
  embeddings: call.body.requests.map(() => ({ values: Array.from({ length: 768 }, () => 0.1) })),
})

beforeEach(() => {
  calls = []
  blockedKeys = new Set()
  respond = (call) => ({
    embeddings: call.body.requests.map(() => ({ values: Array.from({ length: 768 }, () => 0.1) })),
  })
  vi.stubEnv('VECTOR_SEARCH_API', 'dedicated-key')
  vi.stubEnv('GEMINI_API_KEY', 'gemini-key')
  vi.stubEnv('EMBEDDING_PROVIDER', '')
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>
    const call: Call = { url, key: headers['x-goog-api-key'] ?? null, body: JSON.parse(String(init.body)) }
    calls.push(call)
    if (call.key && blockedKeys.has(call.key)) return new Response('{"error":{}}', { status: 403 })
    return new Response(JSON.stringify(respond(call)), { status: 200 })
  }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const load = () => import('@/lib/hubble/providers/embedding')

describe('GeminiEmbeddingProvider', () => {
  it('uses the dedicated key first and keeps every key out of the URL', async () => {
    const { GeminiEmbeddingProvider } = await load()
    const provider = new GeminiEmbeddingProvider()

    await expect(provider.embed(['passage one', 'passage two'])).resolves.toHaveLength(2)
    expect(calls.every((call) => call.key === 'dedicated-key')).toBe(true)
    expect(calls.every((call) => !call.url.includes('key'))).toBe(true)
  })

  it('falls through to GEMINI_API_KEY when the dedicated key is blocked', async () => {
    blockedKeys.add('dedicated-key')
    const { GeminiEmbeddingProvider } = await load()
    const provider = new GeminiEmbeddingProvider()

    await expect(provider.isUsable()).resolves.toBe(true)
    await provider.embed(['passage'])
    expect(calls.at(-1)!.key).toBe('gemini-key')
  })

  it('is not usable when every key is blocked, and embeds nothing', async () => {
    blockedKeys.add('dedicated-key')
    blockedKeys.add('gemini-key')
    const { GeminiEmbeddingProvider } = await load()
    const provider = new GeminiEmbeddingProvider()

    await expect(provider.isUsable()).resolves.toBe(false)
    await expect(provider.embed(['passage'])).resolves.toBeNull()
  })

  it('embeds a question and passages with their own task types, at 768 dims', async () => {
    const { GeminiEmbeddingProvider } = await load()
    const provider = new GeminiEmbeddingProvider()

    await provider.embed(['who founded acme?'], { purpose: 'query' })
    await provider.embed(['Acme was founded in 2019.'])

    const [query, passage] = calls.slice(-2).map((call) => call.body.requests[0]!)
    expect(query!.taskType).toBe('RETRIEVAL_QUERY')
    expect(passage!.taskType).toBe('RETRIEVAL_DOCUMENT')
    expect(passage!.outputDimensionality).toBe(768)
    expect(provider.model).toBe('gemini-embedding-001@768')
  })

  it('batches past the API cap of 100 per call, in order', async () => {
    let counter = 0
    respond = (call) => ({
      embeddings: call.body.requests.map(() => ({
        values: Array.from({ length: 768 }, () => (counter += 1)),
      })),
    })
    const { GeminiEmbeddingProvider } = await load()
    const provider = new GeminiEmbeddingProvider()
    await provider.isUsable()
    calls = []

    const vectors = await provider.embed(Array.from({ length: 230 }, (_, i) => `p${i}`))
    expect(calls.map((call) => call.body.requests.length)).toEqual([100, 100, 30])
    expect(vectors).toHaveLength(230)
  })

  it('returns no vectors rather than misaligned ones on a short or malformed reply', async () => {
    const { GeminiEmbeddingProvider } = await load()
    const provider = new GeminiEmbeddingProvider()
    await provider.isUsable()

    respond = () => ({ embeddings: [{ values: Array.from({ length: 768 }, () => 0.1) }] })
    await expect(provider.embed(['a', 'b'])).resolves.toBeNull()

    respond = (call) => ({ embeddings: call.body.requests.map(() => ({ values: [0.1, 0.2] })) })
    await expect(provider.embed(['a'])).resolves.toBeNull()
  })

  it('re-probes after a failed cold-start probe instead of staying off for good', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    blockedKeys.add('dedicated-key')
    blockedKeys.add('gemini-key')
    const { GeminiEmbeddingProvider } = await load()
    const provider = new GeminiEmbeddingProvider()
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(provider.isUsable()).resolves.toBe(false)
    blockedKeys.clear()
    // Inside the retry window the failure is trusted: no new request.
    const before = calls.length
    await expect(provider.isUsable()).resolves.toBe(false)
    expect(calls.length).toBe(before)

    vi.setSystemTime(Date.now() + 61_000)
    await expect(provider.isUsable()).resolves.toBe(true)
    vi.useRealTimers()
  })

  it('with no key configured is null, never a throw', async () => {
    vi.stubEnv('VECTOR_SEARCH_API', '')
    vi.stubEnv('GEMINI_API_KEY', '')
    const { GeminiEmbeddingProvider } = await load()
    const provider = new GeminiEmbeddingProvider()

    expect(provider.isConfigured()).toBe(false)
    await expect(provider.isUsable()).resolves.toBe(false)
    await expect(provider.embed(['x'])).resolves.toBeNull()
    expect(calls).toHaveLength(0)
  })
})

describe('resolveEmbeddingProvider', () => {
  it('prefers Gemini whenever a key is set', async () => {
    const { resolveEmbeddingProvider } = await load()
    expect(resolveEmbeddingProvider().name).toBe('gemini')
  })

  it('lets a machine opt back into Ollama', async () => {
    vi.stubEnv('EMBEDDING_PROVIDER', 'ollama')
    const { resolveEmbeddingProvider } = await load()
    expect(resolveEmbeddingProvider().name).toBe('ollama')
  })

  it('falls back to Ollama when no Gemini key exists', async () => {
    vi.stubEnv('VECTOR_SEARCH_API', '')
    vi.stubEnv('GEMINI_API_KEY', '')
    const { resolveEmbeddingProvider } = await load()
    expect(resolveEmbeddingProvider().name).toBe('ollama')
  })
})

describe('stored vectors from another model', () => {
  it('are dropped before ranking — two 768-dim spaces must never be compared', async () => {
    const rows = [
      { id: '1', page_id: 'p', ordinal: 0, content: 'a', embedding: [0.1], embed_model: 'gemini-embedding-001@768', hubble_pages: { url: 'https://a.example', title: null, expires_at: null } },
      { id: '2', page_id: 'p', ordinal: 1, content: 'b', embedding: [0.2], embed_model: 'nomic-embed-text', hubble_pages: { url: 'https://a.example', title: null, expires_at: null } },
    ]
    vi.doMock('@/lib/supabase/admin', () => {
      const chain: Record<string, unknown> = {}
      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        limit: () => Promise.resolve({ data: rows, error: null }),
      })
      return { createAdminClient: () => ({ from: () => chain }) }
    })
    const { loadCachedChunks } = await import('@/lib/hubble/store')

    const chunks = await loadCachedChunks('user', 'company', 'gemini-embedding-001@768')
    expect(chunks.map((chunk) => chunk.embedding)).toEqual([[0.1], null])
    vi.doUnmock('@/lib/supabase/admin')
  })
})
