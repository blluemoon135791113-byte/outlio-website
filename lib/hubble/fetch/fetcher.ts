import 'server-only'

/**
 * The page fetcher: plain HTTP first, a browser only when forced.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ NOT A CRAWLER, AND NEVER POINTED AT LINKEDIN.                        ║
 * ║                                                                          ║
 * ║  CLAUDE.md rule 1 forbids any request to linkedin.com from our servers.  ║
 * ║  `BANNED_HOSTS` enforces that here rather than trusting every caller to  ║
 * ║  remember it — a search result linking to a LinkedIn profile is refused  ║
 * ║  like any other blocked URL.                                             ║
 * ║                                                                          ║
 * ║  It fetches specific URLs a plan selected. It does not follow links off  ║
 * ║  a page, and there is no queue of discovered URLs feeding back into it.  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Every failure is a VALUE, never a throw: one unreachable page must lower an
 * answer's confidence, not turn the user's question into a 500.
 */
import { extractReadable } from '@/lib/hubble/extract/readable'
import { assertFetchable } from '@/lib/hubble/net/guard'
import type { FetchFailure, FetchedPage, PageFetcher } from '@/lib/hubble/providers/types'
import { USER_AGENT } from '@/lib/intelligence/http'

/** 12s is long enough for a slow marketing site, short enough not to stall. */
const TIMEOUT_MS = 12_000

/**
 * ⚠️ A HARD CEILING, ENFORCED WHILE STREAMING.
 *
 * `content-length` is a claim by the server, not a fact — a hostile or
 * misconfigured host can omit it and send gigabytes. The read loop below
 * aborts once this many bytes have actually arrived.
 */
const MAX_BYTES = 3_000_000

/** Never requested, whatever a search engine returns. */
const BANNED_HOSTS = [/(^|\.)linkedin\.com$/i, /(^|\.)licdn\.com$/i, /(^|\.)lnkd\.in$/i]

/** Below this, a "page" is a cookie wall or an error, not content. */
const MIN_USEFUL_CHARS = 200

function bannedHost(host: string): boolean {
  return BANNED_HOSTS.some((pattern) => pattern.test(host))
}

/**
 * Reads the body with a byte ceiling.
 *
 * `response.text()` would buffer the whole thing before we could object, which
 * is precisely the failure mode MAX_BYTES exists to prevent.
 */
async function readCapped(response: Response): Promise<string | null> {
  const body = response.body
  if (!body) return null

  const reader = body.getReader()
  const decoder = new TextDecoder()
  const parts: string[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BYTES) return null
      parts.push(decoder.decode(value, { stream: true }))
    }
  } finally {
    // Releasing matters: an abandoned reader holds the socket open.
    reader.releaseLock()
  }

  return parts.join('')
}

/**
 * Whether a page is worth a browser.
 *
 * ⚠️ THE ONLY REASON TO PAY FOR PLAYWRIGHT. A page whose HTML already carries
 * its text does not need one, and rendering everything would make Hubble
 * dramatically slower and heavier for no additional facts.
 */
export function needsBrowser(html: string, extractedChars: number): boolean {
  if (extractedChars >= MIN_USEFUL_CHARS) return false

  // A shell that ships an app and no content is the classic SPA signature.
  return /<div[^>]+id=["'](root|app|__next)["']/i.test(html) || /<app-root/i.test(html)
}

export class HttpPageFetcher implements PageFetcher {
  readonly name = 'fetch'

  async fetchPage(rawUrl: string): Promise<FetchedPage | FetchFailure> {
    const verdict = await assertFetchable(rawUrl)
    if (!verdict.allowed) {
      return { url: rawUrl, code: 'blocked', detail: verdict.reason }
    }
    if (bannedHost(verdict.host)) {
      // Rule 1. Not a network decision — a product one.
      return { url: rawUrl, code: 'blocked', detail: 'linkedin.com is never fetched' }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(verdict.url, {
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en',
        },
        /*
         * ⚠️ REDIRECTS ARE FOLLOWED BY THE RUNTIME, WHICH SKIPS OUR GUARD.
         *
         * A public URL that 302s to 169.254.169.254 would defeat every check
         * above. Handling them manually means each hop is screened.
         */
        redirect: 'manual',
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) {
          return { url: rawUrl, code: 'http_error', detail: 'redirect without location' }
        }
        const next = new URL(location, verdict.url).toString()
        // One hop only: a redirect chain is a loop waiting to happen.
        const hop = await assertFetchable(next)
        if (!hop.allowed || bannedHost(hop.host)) {
          return { url: rawUrl, code: 'blocked', detail: `redirect to ${hop.allowed ? hop.host : 'blocked target'}` }
        }
        return this.fetchOnce(hop.url)
      }

      return this.finish(response, verdict.url)
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError'
      return {
        url: rawUrl,
        code: aborted ? 'timeout' : 'http_error',
        detail: aborted ? `no response in ${TIMEOUT_MS}ms` : 'request failed',
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /** A single request with no further redirect following. */
  private async fetchOnce(url: string): Promise<FetchedPage | FetchFailure> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
        redirect: 'error',
      })
      return this.finish(response, url)
    } catch {
      return { url, code: 'http_error', detail: 'request failed after redirect' }
    } finally {
      clearTimeout(timer)
    }
  }

  private async finish(response: Response, url: string): Promise<FetchedPage | FetchFailure> {
    if (!response.ok) {
      return { url, code: 'http_error', detail: `HTTP ${response.status}` }
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      // A PDF or an image is not something this extractor can read.
      return { url, code: 'not_html', detail: contentType || 'unknown content type' }
    }

    const html = await readCapped(response)
    if (html === null) {
      return { url, code: 'too_large', detail: `over ${MAX_BYTES} bytes` }
    }

    const readable = extractReadable(html, url)

    if (readable.text.length < MIN_USEFUL_CHARS) {
      return {
        url,
        code: 'empty',
        // Recorded so the orchestrator can decide whether a browser is worth it.
        detail: needsBrowser(html, readable.text.length)
          ? 'content is JavaScript-rendered'
          : 'page carried no readable text',
      }
    }

    return {
      url,
      status: response.status,
      title: readable.title,
      content: readable.text,
      method: 'fetch',
    }
  }
}

export const httpPageFetcher = new HttpPageFetcher()
