import 'server-only'

const API_ORIGIN = 'https://api.fastspring.com'

function credentials(): string {
  const username = process.env.FASTSPRING_API_USERNAME?.trim()
  const password = process.env.FASTSPRING_API_PASSWORD?.trim()

  if (!username) throw new Error('Missing required environment variable FASTSPRING_API_USERNAME')
  if (!password) throw new Error('Missing required environment variable FASTSPRING_API_PASSWORD')

  return Buffer.from(`${username}:${password}`).toString('base64')
}

export function getFastSpringWebhookSecret(): string {
  const secret = process.env.FASTSPRING_WEBHOOK_SECRET?.trim()
  if (!secret) throw new Error('Missing required environment variable FASTSPRING_WEBHOOK_SECRET')
  return secret
}

/**
 * Authenticated call to the FastSpring API.
 *
 * The response body is never surfaced to a client — callers pull the one field
 * they need. A non-2xx becomes a generic error so an upstream message can never
 * leak account structure into a user-facing string.
 */
export async function fastSpringApi<T>(
  path: string,
  init: { search?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<T> {
  const url = new URL(path, API_ORIGIN)
  for (const [key, value] of Object.entries(init.search ?? {})) {
    url.searchParams.set(key, value)
  }

  const response = await fetch(url, {
    headers: { authorization: `Basic ${credentials()}`, accept: 'application/json' },
    cache: 'no-store',
    signal: init.signal,
  })

  if (!response.ok) {
    throw new Error(`FastSpring API request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}
