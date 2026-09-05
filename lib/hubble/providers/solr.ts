import 'server-only'

import { createHash } from 'node:crypto'

import type { DeadlineOptions, FetchedPage, SearchHit, SearchProvider } from '@/lib/hubble/providers/types'
import { requestJson, setHostPacing } from '@/lib/intelligence/http'

type SolrConfig = {
  baseUrl: string
  collection: string
  headers: Record<string, string>
}

function isLoopback(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

function authHeaders(): Record<string, string> | null {
  const token = process.env.SOLR_AUTH_TOKEN?.trim()
  if (token) return { authorization: `Bearer ${token}` }

  const username = process.env.SOLR_USERNAME?.trim()
  const password = process.env.SOLR_PASSWORD?.trim()
  if (!username || !password) return null
  return { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` }
}

/** Operator-owned Solr only. Public deployments are refused without auth. */
export function solrConfig(): SolrConfig | null {
  const rawUrl = process.env.SOLR_URL?.trim()
  const collection = process.env.SOLR_COLLECTION?.trim()
  if (!rawUrl || !collection || !/^[a-z0-9_.-]+$/i.test(collection)) return null

  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const headers = authHeaders()
    if (!isLoopback(url.hostname) && !headers) return null
    return {
      baseUrl: url.toString().replace(/\/+$/, ''),
      collection,
      headers: headers ?? {},
    }
  } catch {
    return null
  }
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) {
    const found = value.find((item): item is string => typeof item === 'string')
    return found?.trim() || null
  }
  return null
}

function endpoint(config: SolrConfig, suffix: string): string {
  return `${config.baseUrl}/${encodeURIComponent(config.collection)}${suffix}`
}

/** Search Hubble's own previously crawled public-page index. */
export class SolrSearchProvider implements SearchProvider {
  readonly name = 'solr'

  isConfigured(): boolean {
    return solrConfig() !== null
  }

  async search(query: string, limit: number, options: DeadlineOptions = {}): Promise<SearchHit[]> {
    const config = solrConfig()
    if (!config) return []

    const url = endpoint(config, '/query')
    setHostPacing(new URL(url).hostname, 100)

    try {
      const payload = await requestJson<{
        response?: { docs?: Array<Record<string, unknown>> }
      }>({
        url,
        method: 'POST',
        headers: config.headers,
        body: {
          query: query.slice(0, 400),
          limit: Math.min(Math.max(limit, 1), 20),
          fields: ['url_s', 'title_txt', 'content_txt'],
          params: {
            defType: 'edismax',
            qf: 'title_txt^4 content_txt^2 url_s',
            'q.op': 'AND',
          },
        },
        deadlineAt: options.deadlineAt,
        maxRetries: 1,
      })

      return (payload.response?.docs ?? []).flatMap((doc) => {
        const urlValue = firstString(doc.url_s)
        if (!urlValue) return []
        return [{
          url: urlValue,
          title: firstString(doc.title_txt),
          snippet: firstString(doc.content_txt)?.slice(0, 700) ?? null,
          publishedDate: null,
        }]
      })
    } catch {
      return []
    }
  }
}

/** Best-effort indexing. A Solr outage must never discard freshly fetched evidence. */
export async function indexPageInSolr(
  page: FetchedPage,
  options: DeadlineOptions = {},
): Promise<boolean> {
  const config = solrConfig()
  if (!config) return false

  const url = new URL(endpoint(config, '/update'))
  url.searchParams.set('commitWithin', '10000')
  url.searchParams.set('overwrite', 'true')
  setHostPacing(url.hostname, 100)

  try {
    await requestJson({
      url: url.toString(),
      method: 'POST',
      headers: config.headers,
      body: [{
        id: createHash('sha256').update(page.url).digest('hex'),
        url_s: page.url,
        title_txt: page.title ?? '',
        content_txt: page.content,
        crawl_method_s: page.method,
        crawled_at_dt: new Date().toISOString(),
      }],
      deadlineAt: options.deadlineAt,
      maxRetries: 1,
    })
    return true
  } catch {
    return false
  }
}
