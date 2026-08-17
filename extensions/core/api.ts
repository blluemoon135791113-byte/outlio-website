/**
 * Authenticated API client.
 *
 * Owns exactly one non-obvious behaviour: transparent access-token refresh.
 * Access tokens live 15 minutes, so a long capture session WILL cross an
 * expiry. Rather than make every caller handle that, a 401 triggers one
 * refresh and one replay.
 *
 * Deliberately one retry, not a loop. If the refresh itself fails the device
 * is revoked or the account is gone, and hammering the endpoint only delays
 * telling the user to reconnect.
 */
import { clearAuth, readAuth, writeAuth } from './storage'
import { ApiError, type ApiErrorCode, type SessionTotals } from './types'

/** Overridden at build time for local development. */
export const API_BASE = process.env.OUTLIO_API_BASE ?? 'https://outlio.io'

type Json = Record<string, unknown>

function codeFrom(status: number, body: Json | null): ApiErrorCode {
  const raw = typeof body?.error === 'string' ? body.error : null

  const known: ApiErrorCode[] = [
    'UNAUTHENTICATED', 'TOKEN_EXPIRED', 'DEVICE_REVOKED', 'EXTENSION_DISABLED',
    'SUBSCRIPTION_REQUIRED', 'ACCESS_DENIED', 'RATE_LIMITED', 'SESSION_CLOSED',
    'SESSION_NOT_FOUND', 'ERR_LIMIT_REACHED',
  ]

  if (raw && (known as string[]).includes(raw)) return raw as ApiErrorCode
  if (status === 429) return 'RATE_LIMITED'
  if (status === 401) return 'UNAUTHENTICATED'
  if (status === 403) return 'ACCESS_DENIED'
  return 'UNKNOWN'
}

async function parse(response: Response): Promise<Json | null> {
  try {
    return (await response.json()) as Json
  } catch {
    return null
  }
}

/** Exchanges the refresh token. Returns false when the device is finished. */
async function refresh(): Promise<boolean> {
  const auth = await readAuth()
  if (!auth) return false

  let response: Response
  try {
    response = await fetch(`${API_BASE}/api/extension/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        refreshToken: auth.refreshToken,
        deviceId: auth.deviceId,
      }),
    })
  } catch {
    // Offline. Keep the credentials — they may still be valid later.
    return false
  }

  if (!response.ok) {
    // 401 here means revoked or reused; the token will never work again.
    if (response.status === 401) await clearAuth()
    return false
  }

  const body = await parse(response)
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : null
  const refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken : null

  if (!accessToken || !refreshToken) return false

  await writeAuth({ accessToken, refreshToken, deviceId: auth.deviceId })
  return true
}

async function authed(
  path: string,
  init: RequestInit,
  allowRetry = true,
): Promise<Json> {
  const auth = await readAuth()
  if (!auth) throw new ApiError('UNAUTHENTICATED', 401)

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        'content-type': 'application/json',
        authorization: `Bearer ${auth.accessToken}`,
      },
    })
  } catch {
    throw new ApiError('NETWORK', 0, 'network unavailable')
  }

  if (response.ok) return (await parse(response)) ?? {}

  const body = await parse(response)
  const code = codeFrom(response.status, body)

  // One refresh, one replay. Anything else is terminal.
  if (allowRetry && (code === 'TOKEN_EXPIRED' || code === 'UNAUTHENTICATED')) {
    if (await refresh()) return authed(path, init, false)
  }

  if (code === 'DEVICE_REVOKED') await clearAuth()

  throw new ApiError(code, response.status)
}

export type MeResponse = {
  canCapture: boolean
  email: string | null
  plan: string | null
  device: { id: string; label: string }
  activeSession: SessionTotals | null
}

export async function fetchMe(): Promise<MeResponse> {
  const body = await authed('/api/extension/me', { method: 'GET' })
  const session = body.activeSession as Record<string, unknown> | null

  return {
    canCapture: body.canCapture === true,
    email: (body.email as string | null) ?? null,
    plan: (body.plan as string | null) ?? null,
    device: (body.device as { id: string; label: string }) ?? { id: '', label: 'This browser' },
    activeSession: session
      ? {
          id: String(session.id),
          pagesProcessed: Number(session.pagesProcessed ?? 0),
          leadsFound: Number(session.leadsFound ?? 0),
          leadsImported: Number(session.leadsImported ?? 0),
          duplicatesSkipped: Number(session.duplicatesSkipped ?? 0),
        }
      : null,
  }
}

function totalsFrom(body: Json): SessionTotals {
  return {
    id: String(body.sessionId ?? ''),
    pagesProcessed: Number(body.pagesProcessed ?? 0),
    leadsFound: Number(body.leadsFound ?? 0),
    leadsImported: Number(body.leadsImported ?? 0),
    duplicatesSkipped: Number(body.duplicatesSkipped ?? 0),
  }
}

export async function startSession(
  dedupeMode: 'remove_exact' | 'remove_likely' | 'review' | 'keep_all',
): Promise<SessionTotals> {
  return totalsFrom(
    await authed('/api/extension/session', {
      method: 'POST',
      body: JSON.stringify({ action: 'start', dedupeMode }),
    }),
  )
}

export async function finishSession(sessionId: string): Promise<SessionTotals> {
  return totalsFrom(
    await authed('/api/extension/session', {
      method: 'POST',
      body: JSON.stringify({ action: 'finish', sessionId }),
    }),
  )
}

export type CaptureResponse = {
  success: boolean
  duplicate: boolean
  queued?: boolean
}

export async function sendPage(input: {
  sessionId: string
  html: string
  sourceUrl: string
  pageName: string
  pageIdentifier: string | null
  contentHash: string
}): Promise<CaptureResponse> {
  const body = await authed('/api/extension/capture', {
    method: 'POST',
    body: JSON.stringify(input),
  })

  return {
    success: body.success === true,
    duplicate: body.duplicate === true,
    queued: body.queued === true,
  }
}

/**
 * Reports a website read from a company page the user opened.
 *
 * Deliberately not `sendPage`: nothing is captured, nothing is billed, and a
 * failure here must never disturb an active capture session — the caller
 * swallows the error, because a missed website is a blank column and a broken
 * session is lost work.
 */
export async function sendCompanyObservation(input: {
  companyId: string
  companyName: string | null
  websiteUrl: string
}): Promise<{ leadsUpdated: number }> {
  const body = await authed('/api/extension/company', {
    method: 'POST',
    body: JSON.stringify(input),
  })

  return { leadsUpdated: typeof body.leadsUpdated === 'number' ? body.leadsUpdated : 0 }
}

/** Exchanges a pairing code. The only unauthenticated call we make. */
export async function exchangePairingCode(
  code: string,
  state: string,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/extension/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, state }),
  })

  if (!response.ok) {
    const body = await parse(response)
    throw new ApiError(codeFrom(response.status, body), response.status)
  }

  const body = await parse(response)
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : null
  const refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken : null
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : null

  if (!accessToken || !refreshToken || !deviceId) {
    throw new ApiError('UNKNOWN', 500, 'pairing response incomplete')
  }

  await writeAuth({ accessToken, refreshToken, deviceId })
}
