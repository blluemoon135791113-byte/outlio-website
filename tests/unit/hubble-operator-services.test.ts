import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/hubble/net/guard', () => ({
  assertFetchable: vi.fn(async (url: string) => ({
    allowed: true as const,
    url,
    host: new URL(url).hostname,
  })),
}))

import { Crawl4AiPageFetcher, crawl4AiConfig } from '@/lib/hubble/fetch/crawl4ai'
import { SolrSearchProvider, solrConfig } from '@/lib/hubble/providers/solr'

const KEYS = [
  'CRAWL4AI_URL',
  'CRAWL4AI_API_TOKEN',
  'SOLR_URL',
  'SOLR_COLLECTION',
  'SOLR_AUTH_TOKEN',
  'SOLR_USERNAME',
  'SOLR_PASSWORD',
] as const

const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const key of KEYS) {
    const value = original[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('operator service configuration', () => {
  it('refuses unauthenticated public Solr and Crawl4AI endpoints', () => {
    process.env.SOLR_URL = 'https://solr.example/solr'
    process.env.SOLR_COLLECTION = 'hubble'
    process.env.CRAWL4AI_URL = 'https://crawl.example'
    delete process.env.SOLR_AUTH_TOKEN
    delete process.env.SOLR_USERNAME
    delete process.env.SOLR_PASSWORD
    delete process.env.CRAWL4AI_API_TOKEN

    expect(solrConfig()).toBeNull()
    expect(crawl4AiConfig()).toBeNull()
  })

  it('accepts unauthenticated loopback services for development', () => {
    process.env.SOLR_URL = 'http://127.0.0.1:8983/solr'
    process.env.SOLR_COLLECTION = 'hubble'
    process.env.CRAWL4AI_URL = 'http://127.0.0.1:11235'

    expect(solrConfig()?.collection).toBe('hubble')
    expect(crawl4AiConfig()?.baseUrl).toBe('http://127.0.0.1:11235')
  })
})

describe('Solr search', () => {
  it('maps indexed documents into Hubble search hits', async () => {
    process.env.SOLR_URL = 'https://solr.example/solr'
    process.env.SOLR_COLLECTION = 'hubble'
    process.env.SOLR_AUTH_TOKEN = 'secret'

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: 'Bearer secret' })
      expect(JSON.parse(String(init?.body))).toMatchObject({
        query: 'Acme funding',
        params: { defType: 'edismax' },
      })
      return Response.json({
        response: {
          docs: [{
            url_s: 'https://acme.example/news',
            title_txt: ['Acme raises a round'],
            content_txt: 'Acme announced its Series A.',
          }],
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(new SolrSearchProvider().search('Acme funding', 5)).resolves.toEqual([{
      url: 'https://acme.example/news',
      title: 'Acme raises a round',
      snippet: 'Acme announced its Series A.',
      publishedDate: null,
    }])
  })
})

describe('Crawl4AI page extraction', () => {
  it('uses the authenticated crawl API and returns rendered markdown', async () => {
    process.env.CRAWL4AI_URL = 'https://crawl.example'
    process.env.CRAWL4AI_API_TOKEN = 'crawl-secret'

    const content = `# Acme\n\n${'Rendered company information. '.repeat(20)}`
    const expectedContent = content.trim()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://crawl.example/crawl')
      expect(init?.headers).toMatchObject({ authorization: 'Bearer crawl-secret' })
      expect(JSON.parse(String(init?.body))).toMatchObject({
        urls: ['https://acme.example'],
      })
      return Response.json({
        success: true,
        results: [{
          success: true,
          url: 'https://acme.example',
          status_code: 200,
          markdown: { fit_markdown: content },
          metadata: { title: 'Acme' },
        }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(new Crawl4AiPageFetcher().fetchPage('https://acme.example')).resolves.toEqual({
      url: 'https://acme.example',
      status: 200,
      title: 'Acme',
      content: expectedContent,
      method: 'browser',
    })
  })
})
