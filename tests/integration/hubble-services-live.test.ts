/**
 * Opt-in smoke tests for Hubble's operator-owned retrieval services.
 *
 *   RUN_HUBBLE_SERVICES=1 npx vitest run tests/integration/hubble-services-live.test.ts
 *
 * These make real local/remote calls but consume no paid-provider credits.
 * The Solr test creates one uniquely named document and deletes that exact
 * test document in `finally`, even when its assertion fails.
 */
import { describe, expect, it } from 'vitest'

import { Crawl4AiPageFetcher, crawl4AiConfig } from '@/lib/hubble/fetch/crawl4ai'
import { isFetchFailure } from '@/lib/hubble/providers/types'
import { OllamaEmbeddingProvider } from '@/lib/hubble/providers/embedding'
import {
  SearxngSearchProvider,
  hasSearxngCredentials,
} from '@/lib/hubble/providers/search'
import { SolrSearchProvider, solrConfig } from '@/lib/hubble/providers/solr'

const enabled = process.env.RUN_HUBBLE_SERVICES === '1'
const describeIf = enabled ? describe : describe.skip

if (!enabled) {
  console.warn('[hubble-services-live] SKIPPED. Set RUN_HUBBLE_SERVICES=1 to call services.')
}

describeIf('Hubble operator services', () => {
  it('has every required endpoint configured', () => {
    expect(hasSearxngCredentials(), 'SEARXNG_URL is missing or unsafe').toBe(true)
    expect(new OllamaEmbeddingProvider().isConfigured(), 'OLLAMA_URL is missing or invalid').toBe(true)
    expect(solrConfig(), 'SOLR_URL/SOLR_COLLECTION are missing or unsafe').not.toBeNull()
    expect(crawl4AiConfig(), 'CRAWL4AI_URL or its required token is missing').not.toBeNull()
  })

  it('gets live SearXNG results', async () => {
    const results = await new SearxngSearchProvider().search('OpenAI official website', 3)
    expect(results.length, 'SearXNG returned no usable JSON results').toBeGreaterThan(0)
    expect(results.every((result) => result.url.startsWith('http'))).toBe(true)
  }, 30_000)

  it('generates a real Ollama embedding', async () => {
    const provider = new OllamaEmbeddingProvider()
    expect(await provider.isUsable(), `Ollama model ${provider.model} is not pulled`).toBe(true)
    const vectors = await provider.embed(['Hubble service smoke test'])
    expect(vectors).not.toBeNull()
    expect(vectors?.[0]?.length).toBe(provider.dimensions)
  }, 30_000)

  it('indexes, finds, and removes one Solr test document', async () => {
    const config = solrConfig()
    expect(config).not.toBeNull()
    if (!config) return

    const id = `outlio-hubble-smoke-${Date.now()}`
    const collectionUrl = `${config.baseUrl}/${encodeURIComponent(config.collection)}`
    const headers = { 'content-type': 'application/json', ...config.headers }

    try {
      const indexed = await fetch(`${collectionUrl}/update?commit=true`, {
        method: 'POST',
        headers,
        body: JSON.stringify([{
          id,
          url_s: `https://example.com/${id}`,
          title_txt: 'Outlio Hubble smoke test',
          content_txt: `unique ${id}`,
        }]),
      })
      expect(indexed.ok, `Solr indexing returned HTTP ${indexed.status}`).toBe(true)

      const hits = await new SolrSearchProvider().search(`unique ${id}`, 3)
      expect(hits.some((hit) => hit.url.endsWith(id))).toBe(true)
    } finally {
      await fetch(`${collectionUrl}/update?commit=true`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ delete: { id } }),
      }).catch(() => undefined)
    }
  }, 30_000)

  it('renders a real page through Crawl4AI', async () => {
    const page = await new Crawl4AiPageFetcher().fetchPage(
      'https://www.iana.org/help/example-domains',
    )
    expect(isFetchFailure(page) ? page : null).toBeNull()
    if (isFetchFailure(page)) return
    expect(page.method).toBe('browser')
    expect(page.content.length).toBeGreaterThan(200)
  }, 60_000)
})
