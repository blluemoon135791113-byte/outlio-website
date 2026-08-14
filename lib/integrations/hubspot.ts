import 'server-only'

import { z } from 'zod'

const HUBSPOT_AUTHORIZE_URL = 'https://app.hubspot.com/oauth/authorize'
const HUBSPOT_TOKEN_URL = 'https://api.hubapi.com/oauth/2026-03/token'
const HUBSPOT_REVOKE_URL = 'https://api.hubapi.com/oauth/2026-03/token/revoke'
const HUBSPOT_CALLBACK_PATH = '/api/integrations/hubspot/callback'
const PRODUCTION_REDIRECT_URI = `https://app.outlio.io${HUBSPOT_CALLBACK_PATH}`
const LOCAL_REDIRECT_URI = `http://localhost:3000${HUBSPOT_CALLBACK_PATH}`

export const HUBSPOT_OAUTH_COOKIE = 'outlio_hubspot_oauth'
export const HUBSPOT_OAUTH_COOKIE_MAX_AGE = 10 * 60

export const HUBSPOT_REQUIRED_SCOPES = [
  'oauth',
  'crm.objects.contacts.write',
  'crm.schemas.contacts.write',
] as const
export const HUBSPOT_OPTIONAL_SCOPES = ['crm.objects.contacts.read'] as const

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().int().positive(),
  token_type: z.string().min(1).default('bearer'),
  hub_id: z.union([z.string(), z.number()]).optional(),
  scopes: z.union([z.array(z.string()), z.string()]).optional(),
})

export type HubSpotTokenSet = {
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresAt: string
  accountId: string | null
  scopes: string[]
}

export class HubSpotOAuthError extends Error {
  constructor(
    message: string,
    readonly reconnectRequired = false,
  ) {
    super(message)
    this.name = 'HubSpotOAuthError'
  }
}

function configuredValue(name: 'HUBSPOT_CLIENT_ID' | 'HUBSPOT_CLIENT_SECRET' | 'HUBSPOT_REDIRECT_URI'): string | undefined {
  let value = process.env[name]?.trim()
  if (!value) return undefined
  if (value.startsWith(`${name}=`)) value = value.slice(name.length + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1).trim()
  return value || undefined
}

function clientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = configuredValue('HUBSPOT_CLIENT_ID')
  const clientSecret = configuredValue('HUBSPOT_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    throw new HubSpotOAuthError('HubSpot OAuth is not configured.')
  }
  return { clientId, clientSecret }
}

export function hubSpotRedirectUri(): string {
  const configured = configuredValue('HUBSPOT_REDIRECT_URI')
  const redirectUri = configured || (
    process.env.NODE_ENV === 'production'
      ? PRODUCTION_REDIRECT_URI
      : LOCAL_REDIRECT_URI
  )

  let parsed: URL
  try {
    parsed = new URL(redirectUri)
  } catch {
    throw new HubSpotOAuthError('HUBSPOT_REDIRECT_URI must be an absolute URL.')
  }

  if (parsed.pathname !== HUBSPOT_CALLBACK_PATH || parsed.search || parsed.hash) {
    throw new HubSpotOAuthError('HUBSPOT_REDIRECT_URI must use the HubSpot callback route.')
  }

  const isProduction = redirectUri === PRODUCTION_REDIRECT_URI
  const isLocal = redirectUri === LOCAL_REDIRECT_URI
  if (!isProduction && !(process.env.NODE_ENV !== 'production' && isLocal)) {
    throw new HubSpotOAuthError('HUBSPOT_REDIRECT_URI is not an approved Outlio callback URL.')
  }

  return redirectUri
}

export function buildHubSpotAuthorizationUrl(state: string): string {
  const { clientId } = clientCredentials()
  const url = new URL(HUBSPOT_AUTHORIZE_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', hubSpotRedirectUri())
  url.searchParams.set('scope', HUBSPOT_REQUIRED_SCOPES.join(' '))
  url.searchParams.set('optional_scope', HUBSPOT_OPTIONAL_SCOPES.join(' '))
  url.searchParams.set('state', state)
  return url.toString()
}

/** Only these origins can initiate OAuth or receive the post-callback redirect. */
export function isApprovedOutlioAppOrigin(value: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }

  if (
    parsed.origin === 'https://outlio.io' ||
    parsed.origin === 'https://app.outlio.io'
  ) return true

  return process.env.NODE_ENV !== 'production' && parsed.origin === 'http://localhost:3000'
}

function scopesFrom(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return [...new Set(value.filter(Boolean))]
  if (typeof value === 'string') return [...new Set(value.split(/\s+/).filter(Boolean))]
  return []
}

async function requestTokens(
  parameters: Record<string, string>,
  options: { existingRefreshToken?: string; reconnectOnInvalidGrant?: boolean } = {},
): Promise<HubSpotTokenSet> {
  const { clientId, clientSecret } = clientCredentials()
  let response: Response
  try {
    response = await fetch(HUBSPOT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...parameters }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new HubSpotOAuthError('HubSpot could not be reached. Please try again.')
  }

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const errorCode = body && typeof body === 'object' && 'error' in body
      ? String(body.error)
      : ''
    throw new HubSpotOAuthError(
      options.reconnectOnInvalidGrant && errorCode === 'invalid_grant'
        ? 'Your HubSpot authorization has expired. Reconnect HubSpot.'
        : 'HubSpot rejected the OAuth request. Please try again.',
      options.reconnectOnInvalidGrant && errorCode === 'invalid_grant',
    )
  }

  const parsed = tokenResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new HubSpotOAuthError('HubSpot returned an invalid OAuth response.')
  }

  const refreshToken = parsed.data.refresh_token ?? options.existingRefreshToken
  if (!refreshToken) {
    throw new HubSpotOAuthError('HubSpot did not return a refresh token.')
  }

  return {
    accessToken: parsed.data.access_token,
    refreshToken,
    tokenType: parsed.data.token_type,
    expiresAt: new Date(Date.now() + parsed.data.expires_in * 1000).toISOString(),
    accountId: parsed.data.hub_id === undefined ? null : String(parsed.data.hub_id),
    scopes: scopesFrom(parsed.data.scopes),
  }
}

export async function exchangeHubSpotAuthorizationCode(code: string): Promise<HubSpotTokenSet> {
  const tokens = await requestTokens({
    grant_type: 'authorization_code',
    code,
    redirect_uri: hubSpotRedirectUri(),
  })
  if (!tokens.accountId) {
    throw new HubSpotOAuthError('HubSpot did not identify the connected account.')
  }
  if (tokens.scopes.length === 0) {
    tokens.scopes = [...HUBSPOT_REQUIRED_SCOPES]
  }
  return tokens
}

export async function refreshHubSpotToken(refreshToken: string): Promise<HubSpotTokenSet> {
  return requestTokens(
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    { existingRefreshToken: refreshToken, reconnectOnInvalidGrant: true },
  )
}

export async function revokeHubSpotRefreshToken(refreshToken: string): Promise<void> {
  const { clientId, clientSecret } = clientCredentials()
  let response: Response
  try {
    response = await fetch(HUBSPOT_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token: refreshToken,
        token_type_hint: 'refresh_token',
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new HubSpotOAuthError('HubSpot could not be reached to revoke the connection.')
  }

  if (!response.ok) {
    throw new HubSpotOAuthError('HubSpot could not revoke the connection.')
  }
}
