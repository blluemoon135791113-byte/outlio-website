import 'server-only'

/**
 * The only way an intelligence provider reaches the network.
 *
 * Every adapter goes through here so four things are true everywhere at once,
 * rather than being re-implemented (and forgotten) per vendor:
 *
 *   1. **Nothing hangs.** Every request has a timeout.
 *   2. **Transient failures retry, permanent ones do not.** Bounded exponential
 *      backoff on 429 and 5xx, honouring `Retry-After`. Same shape as the Clay
 *      adapter, which was written after a production export failed on 24
 *      consecutive 429s.
 *   3. **We are a polite client.** Per-host pacing, so a burst of company
 *      lookups cannot get a key throttled or banned.
 *   4. **Secrets never reach a log.** Errors carry a catalog code and a host —
 *      never a URL with a query string, an Authorization header, or a body.
 *      API keys routinely travel in query strings, so logging a full URL leaks
 *      the credential.
 */
import { setTimeout as sleep } from 'node:timers/promises'

/** Long enough for a slow search API, short enough not to stall a research run. */
export const DEFAULT_TIMEOUT_MS = 12_000
const MAX_RETRIES = 3
const MAX_BACKOFF_MS = 8_000
/** Refuse to buffer a response large enough to be a denial-of-service by itself. */
export const MAX_RESPONSE_BYTES = 2_000_000

export type HttpFailureCode =
  | 'ERR_PROVIDER_UNAVAILABLE'
  | 'ERR_PROVIDER_REJECTED'
  | 'ERR_PROVIDER_AUTH'
  | 'ERR_RATE_LIMITED'
  | 'ERR_TIMEOUT'
  | 'ERR_RESPONSE_TOO_LARGE'

export class ProviderHttpError extends Error {
  readonly code: HttpFailureCode
  readonly status: number | null
  /** Host only. Never the path or query — those carry keys and lead data. */
  readonly host: string

  constructor(code: HttpFailureCode, host: string, status: number | null = null) {
    super(`${code} from ${host}${status === null ? '' : ` (${status})`}`)
    this.name = 'ProviderHttpError'
    this.code = code
    this.status = status
    this.host = host
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'unknown-host'
  }
}

/**
 * Minimum gap between requests to one host.
 *
 * A single research run can touch hundreds of companies. Without pacing that
 * becomes a burst indistinguishable from an attack, and the first thing a
 * provider does is throttle the key.
 */
const hostPacing = new Map<string, number>()
const lastRequestAt = new Map<string, number>()

export function setHostPacing(host: string, minIntervalMs: number): void {
  hostPacing.set(host, Math.max(0, minIntervalMs))
}

async function paceHost(host: string): Promise<void> {
  const minInterval = hostPacing.get(host)
  if (!minInterval) return

  const last = lastRequestAt.get(host) ?? 0
  const wait = last + minInterval - Date.now()
  // Reserve the slot BEFORE awaiting, so concurrent callers queue behind each
  // other instead of all reading the same stale timestamp and firing together.
  lastRequestAt.set(host, Math.max(Date.now(), last + minInterval))
  if (wait > 0) await sleep(wait)
}

/** `Retry-After` is either seconds or an HTTP date. Both appear in the wild. */
function retryAfterMs(response: Response, attempt: number): number {
  const header = response.headers.get('retry-after')
  const backoff = Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS)

  if (header) {
    const seconds = Number.parseInt(header, 10)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_BACKOFF_MS)
    }
    const date = Date.parse(header)
    if (!Number.isNaN(date)) {
      return Math.min(Math.max(date - Date.now(), 0), MAX_BACKOFF_MS)
    }
  }

  return backoff
}

export type ProviderRequest = {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
  /** Bytes. Website fetches raise this; JSON APIs do not need to. */
  maxBytes?: number
}

/**
 * Identifies Outlio honestly to every host we contact.
 *
 * A contactable User-Agent is the difference between a well-behaved client and
 * an anonymous one, and it gives an operator who dislikes our traffic somewhere
 * to complain before they block us.
 */
export const USER_AGENT =
  'OutlioLeadEngine/1.0 (+https://outlio.io; business research; contact@outlio.io)'

async function readBounded(response: Response, maxBytes: number, host: string): Promise<string> {
  const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ProviderHttpError('ERR_RESPONSE_TOO_LARGE', host, response.status)
  }

  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  // Streamed, not `response.text()`: a lying or absent Content-Length must not
  // let a hostile host buffer unbounded memory into the worker.
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        throw new ProviderHttpError('ERR_RESPONSE_TOO_LARGE', host, response.status)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder('utf-8', { fatal: false }).decode(merged)
}

async function requestOnce(
  request: ProviderRequest,
  attempt: number,
): Promise<{ ok: true; text: string } | { ok: false; error: ProviderHttpError; retryMs?: number }> {
  const host = hostOf(request.url)
  const maxBytes = request.maxBytes ?? MAX_RESPONSE_BYTES

  await paceHost(host)

  let response: Response
  try {
    response = await fetch(request.url, {
      method: request.method ?? 'GET',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'application/json',
        ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...request.headers,
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      cache: 'no-store',
      redirect: 'follow',
    })
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === 'TimeoutError'
    return {
      ok: false,
      error: new ProviderHttpError(timedOut ? 'ERR_TIMEOUT' : 'ERR_PROVIDER_UNAVAILABLE', host),
      // A timeout is worth one more try; a DNS or TLS failure usually is not,
      // but retrying it is cheap and bounded.
      retryMs: Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS),
    }
  }

  if (response.ok) {
    return { ok: true, text: await readBounded(response, maxBytes, host) }
  }

  // Auth failures are permanent: retrying a rejected key wastes the run and can
  // look like credential stuffing.
  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: new ProviderHttpError('ERR_PROVIDER_AUTH', host, response.status) }
  }

  if (response.status === 429) {
    return {
      ok: false,
      error: new ProviderHttpError('ERR_RATE_LIMITED', host, response.status),
      retryMs: retryAfterMs(response, attempt),
    }
  }

  if (response.status >= 500) {
    return {
      ok: false,
      error: new ProviderHttpError('ERR_PROVIDER_UNAVAILABLE', host, response.status),
      retryMs: retryAfterMs(response, attempt),
    }
  }

  // 4xx other than the above: our request is wrong. Retrying will not fix it.
  return {
    ok: false,
    error: new ProviderHttpError('ERR_PROVIDER_REJECTED', host, response.status),
  }
}

/** Raw text, for HTML and non-JSON endpoints. Throws `ProviderHttpError`. */
export async function requestText(request: ProviderRequest): Promise<string> {
  let lastError: ProviderHttpError | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const result = await requestOnce(request, attempt)
    if (result.ok) return result.text

    lastError = result.error
    if (result.retryMs === undefined || attempt === MAX_RETRIES) break
    await sleep(result.retryMs)
  }

  throw lastError ?? new ProviderHttpError('ERR_PROVIDER_UNAVAILABLE', hostOf(request.url))
}

/**
 * JSON, parsed.
 *
 * A body that is not JSON is `ERR_PROVIDER_REJECTED` rather than a crash — some
 * providers answer an error with an HTML page, and that must not surface as a
 * parser stack trace.
 */
export async function requestJson<T = unknown>(request: ProviderRequest): Promise<T> {
  const text = await requestText(request)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ProviderHttpError('ERR_PROVIDER_REJECTED', hostOf(request.url))
  }
}
