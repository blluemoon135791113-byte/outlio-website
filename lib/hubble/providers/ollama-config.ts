import 'server-only'

export type OllamaConfig = {
  baseUrl: string
  headers: Record<string, string>
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1'])

/**
 * Local Ollama may be unauthenticated. A remote instance must use HTTPS and a
 * bearer token; exposing Ollama's generation API directly to the internet is
 * not a launch configuration Hubble will silently accept.
 */
export function ollamaConfig(): OllamaConfig | null {
  const raw = process.env.OLLAMA_URL?.trim()
  if (!raw) return null

  try {
    const url = new URL(raw)
    const local = LOOPBACK.has(url.hostname)
    const token = process.env.OLLAMA_AUTH_TOKEN?.trim()

    if (local && (url.protocol === 'http:' || url.protocol === 'https:')) {
      return {
        baseUrl: url.origin,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }
    }

    if (url.protocol !== 'https:' || !token) return null
    return { baseUrl: url.origin, headers: { authorization: `Bearer ${token}` } }
  } catch {
    return null
  }
}
