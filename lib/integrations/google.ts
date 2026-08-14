import 'server-only'

import { z } from 'zod'

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const GOOGLE_CALLBACK_PATH = '/api/integrations/google/callback'
const PRODUCTION_REDIRECT_URI = `https://app.outlio.io${GOOGLE_CALLBACK_PATH}`
const LOCAL_REDIRECT_URI = `http://localhost:3000${GOOGLE_CALLBACK_PATH}`

export const GOOGLE_OAUTH_COOKIE = 'outlio_google_oauth'
export const GOOGLE_OAUTH_COOKIE_MAX_AGE = 10 * 60
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
] as const

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().int().positive(),
  token_type: z.string().min(1).default('Bearer'),
  scope: z.string().optional(),
})

const userInfoSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
})

export type GoogleTokenSet = {
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresAt: string
  accountId: string
  accountEmail: string
  scopes: string[]
}

export class GoogleOAuthError extends Error {
  constructor(message: string, readonly reconnectRequired = false) {
    super(message)
    this.name = 'GoogleOAuthError'
  }
}

function configuredValue(name: 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET' | 'GOOGLE_REDIRECT_URI'): string | undefined {
  let value = process.env[name]?.trim()
  if (!value) return undefined
  if (value.startsWith(`${name}=`)) value = value.slice(name.length + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1).trim()
  return value || undefined
}

function clientCredentials() {
  const clientId = configuredValue('GOOGLE_CLIENT_ID')
  const clientSecret = configuredValue('GOOGLE_CLIENT_SECRET')
  if (!clientId || !clientSecret) throw new GoogleOAuthError('Google OAuth is not configured.')
  return { clientId, clientSecret }
}

export function googleRedirectUri(): string {
  const configured = configuredValue('GOOGLE_REDIRECT_URI')
  const redirectUri = configured || (process.env.NODE_ENV === 'production'
    ? PRODUCTION_REDIRECT_URI
    : LOCAL_REDIRECT_URI)
  let parsed: URL
  try {
    parsed = new URL(redirectUri)
  } catch {
    throw new GoogleOAuthError('GOOGLE_REDIRECT_URI must be an absolute URL.')
  }
  if (parsed.pathname !== GOOGLE_CALLBACK_PATH || parsed.search || parsed.hash) {
    throw new GoogleOAuthError('GOOGLE_REDIRECT_URI must use the Google callback route.')
  }
  if (
    redirectUri !== PRODUCTION_REDIRECT_URI &&
    !(process.env.NODE_ENV !== 'production' && redirectUri === LOCAL_REDIRECT_URI)
  ) {
    throw new GoogleOAuthError('GOOGLE_REDIRECT_URI is not an approved Outlio callback URL.')
  }
  return redirectUri
}

export function buildGoogleAuthorizationUrl(state: string): string {
  const { clientId } = clientCredentials()
  const url = new URL(GOOGLE_AUTHORIZE_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', googleRedirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', state)
  return url.toString()
}

export function isApprovedGoogleReturnOrigin(value: string): boolean {
  try {
    const origin = new URL(value).origin
    if (origin === 'https://app.outlio.io' || origin === 'https://outlio.io') return true
    return process.env.NODE_ENV !== 'production' && origin === 'http://localhost:3000'
  } catch {
    return false
  }
}

function scopesFrom(value: string | undefined): string[] {
  return value ? [...new Set(value.split(/\s+/).filter(Boolean))] : []
}

async function userInfo(accessToken: string): Promise<{ id: string; email: string }> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  const parsed = userInfoSchema.safeParse(await response.json().catch(() => null))
  if (!response.ok || !parsed.success) throw new GoogleOAuthError('Google did not identify the connected account.')
  return { id: parsed.data.sub, email: parsed.data.email }
}

async function requestTokens(
  parameters: Record<string, string>,
  existingRefreshToken?: string,
): Promise<Omit<GoogleTokenSet, 'accountId' | 'accountEmail'>> {
  const { clientId, clientSecret } = clientCredentials()
  let response: Response
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...parameters }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new GoogleOAuthError('Google could not be reached. Please try again.')
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const invalidGrant = Boolean(body && typeof body === 'object' && 'error' in body && body.error === 'invalid_grant')
    throw new GoogleOAuthError(
      invalidGrant ? 'Your Google authorization expired. Reconnect Google.' : 'Google rejected the OAuth request. Please try again.',
      invalidGrant,
    )
  }
  const parsed = tokenResponseSchema.safeParse(body)
  if (!parsed.success) throw new GoogleOAuthError('Google returned an invalid OAuth response.')
  const refreshToken = parsed.data.refresh_token ?? existingRefreshToken
  if (!refreshToken) throw new GoogleOAuthError('Google did not return a refresh token. Reconnect and approve access.')
  return {
    accessToken: parsed.data.access_token,
    refreshToken,
    tokenType: parsed.data.token_type,
    expiresAt: new Date(Date.now() + parsed.data.expires_in * 1000).toISOString(),
    scopes: scopesFrom(parsed.data.scope),
  }
}

export async function exchangeGoogleAuthorizationCode(code: string): Promise<GoogleTokenSet> {
  const tokens = await requestTokens({
    grant_type: 'authorization_code',
    code,
    redirect_uri: googleRedirectUri(),
  })
  const account = await userInfo(tokens.accessToken)
  return { ...tokens, accountId: account.id, accountEmail: account.email }
}

export async function refreshGoogleToken(refreshToken: string) {
  return requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken }, refreshToken)
}

export async function revokeGoogleToken(token: string): Promise<void> {
  const response = await fetch(GOOGLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!response?.ok) throw new GoogleOAuthError('Google could not revoke the connection.')
}
