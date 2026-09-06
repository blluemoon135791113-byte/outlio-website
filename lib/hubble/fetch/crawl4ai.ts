import 'server-only'

import { assertFetchable } from '@/lib/hubble/net/guard'
import type { DeadlineOptions, FetchFailure, FetchedPage, PageFetcher } from '@/lib/hubble/providers/types'
import { requestJson, setHostPacing } from '@/lib/intelligence/http'

const MIN_USEFUL_CHARS = 200
const MAX_CONTENT_CHARS = 750_000
const BANNED_HOSTS = [/(^|\.)linkedin\.com$/i, /(^|\.)licdn\.com$/i, /(^|\.)lnkd\.in$/i]

type Crawl4AiConfig = { baseUrl: string; headers: Record<string, string> }

function isLoopback(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

export function crawl4AiConfig(): Crawl4AiConfig | null {
  const rawUrl = process.env.CRAWL4AI_URL?.trim()
  if (!rawUrl) return null

  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const token = process.env.CRAWL4AI_API_TOKEN?.trim()
    if (!isLoopback(url.hostname) && !token) return null
    return {
      baseUrl: url.toString().replace(/\/+$/, ''),
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }
  } catch {
    return null
  }
}

export function hasCrawl4AiCredentials(): boolean {
  return crawl4AiConfig() !== null
}

function markdownText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const markdown = value as Record<string, unknown>
  for (const key of ['fit_markdown', 'raw_markdown', 'markdown_with_citations']) {
    if (typeof markdown[key] === 'string' && markdown[key]) return markdown[key]
  }
  return ''
}

function titleFrom(result: Record<string, unknown>, content: string): string | null {
  const metadata = result.metadata
  if (metadata && typeof metadata === 'object') {
    const title = (metadata as Record<string, unknown>).title
    if (typeof title === 'string' && title.trim()) return title.trim()
  }
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return heading || null
}

/** Browser-backed extraction for pages whose server HTML has no readable text. */
export class Crawl4AiPageFetcher implements PageFetcher {
  readonly name = 'crawl4ai'

  isConfigured(): boolean {
    return hasCrawl4AiCredentials()
  }

  async fetchPage(
    rawUrl: string,
    options: DeadlineOptions = {},
  ): Promise<FetchedPage | FetchFailure> {
    const config = crawl4AiConfig()
    if (!config) return { url: rawUrl, code: 'empty', detail: 'Crawl4AI is not configured' }

    const verdict = await assertFetchable(rawUrl)
    if (!verdict.allowed) return { url: rawUrl, code: 'blocked', detail: verdict.reason }
    if (BANNED_HOSTS.some((pattern) => pattern.test(verdict.host))) {
      return { url: rawUrl, code: 'blocked', detail: 'linkedin.com is never fetched' }
    }

    const endpoint = `${config.baseUrl}/crawl`
    setHostPacing(new URL(endpoint).hostname, 500)

    try {
      const payload = await requestJson<{
        success?: boolean
        results?: Array<Record<string, unknown>>
      }>({
        url: endpoint,
        method: 'POST',
        headers: config.headers,
        body: {
          urls: [verdict.url],
          browser_config: {
            type: 'BrowserConfig',
            params: { headless: true, text_mode: true },
          },
          crawler_config: {
            type: 'CrawlerRunConfig',
            params: {
              stream: false,
              cache_mode: 'bypass',
              word_count_threshold: 10,
              remove_overlay_elements: true,
              process_iframes: false,
            },
          },
        },
        timeoutMs: 25_000,
        deadlineAt: options.deadlineAt,
        maxRetries: 0,
        maxBytes: 3_000_000,
      })

      const result = payload.results?.find((item) => item.success !== false)
      if (!payload.success || !result) {
        return { url: rawUrl, code: 'empty', detail: 'Crawl4AI returned no successful result' }
      }

      const content = markdownText(result.markdown).trim().slice(0, MAX_CONTENT_CHARS)
      if (content.length < MIN_USEFUL_CHARS) {
        return { url: rawUrl, code: 'empty', detail: 'Crawl4AI returned no readable text' }
      }

      const status = typeof result.status_code === 'number' ? result.status_code : 200
      return {
        url: typeof result.url === 'string' ? result.url : verdict.url,
        status,
        title: titleFrom(result, content),
        content,
        method: 'browser',
        /*
         * ⚠️ EMPTY, AND HONESTLY SO. Crawl4AI returns rendered markdown, not
         * the DOM, so there is no JSON-LD or link graph left to read. A
         * browser fetch trades deterministic structure for JavaScript
         * execution; pretending otherwise would put made-up facts here.
         */
        structured: {},
      }
    } catch {
      return { url: rawUrl, code: 'http_error', detail: 'Crawl4AI request failed' }
    }
  }
}

export const crawl4AiPageFetcher = new Crawl4AiPageFetcher()
