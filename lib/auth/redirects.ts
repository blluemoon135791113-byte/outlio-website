/**
 * Safe origins and paths for authentication redirects.
 *
 * Authentication links must never be built from an untrusted Host header in
 * production: doing so can send a one-time verification code to an attacker.
 */

const DEFAULT_APP_ORIGIN = 'https://app.outlio.io'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function parseOrigin(value: string, source: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${source} must be an absolute http(s) URL`)
  }

  const localHttp =
    process.env.NODE_ENV !== 'production' &&
    parsed.protocol === 'http:' &&
    LOCAL_HOSTS.has(parsed.hostname)

  if ((parsed.protocol !== 'https:' && !localHttp) || parsed.username || parsed.password) {
    throw new Error(`${source} must use HTTPS and must not contain credentials`)
  }

  return parsed
}

/** Returns a configured canonical origin, with a localhost-only dev fallback. */
export function appOrigin(requestOrigin?: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) return parseOrigin(configured, 'NEXT_PUBLIC_APP_URL').origin

  if (process.env.NODE_ENV !== 'production' && requestOrigin) {
    const parsed = parseOrigin(requestOrigin, 'Request origin')
    if (LOCAL_HOSTS.has(parsed.hostname)) return parsed.origin
  }

  return DEFAULT_APP_ORIGIN
}

/**
 * Allows only a same-origin path. Backslashes and control characters are
 * rejected because different URL parsers have historically normalized them in
 * surprising ways.
 */
export function safeRedirectPath(value: unknown, fallback = '/dashboard'): string {
  if (typeof value !== 'string') return fallback
  if (!value.startsWith('/') || value.startsWith('//')) return fallback
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback

  try {
    const parsed = new URL(value, 'https://app.invalid')
    if (parsed.origin !== 'https://app.invalid') return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}
