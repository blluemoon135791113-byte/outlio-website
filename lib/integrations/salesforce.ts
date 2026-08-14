import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'

const SALESFORCE_CALLBACK_PATH = '/api/integrations/salesforce/callback'
const PRODUCTION_REDIRECT_URI = `https://app.outlio.io${SALESFORCE_CALLBACK_PATH}`
const LOCAL_REDIRECT_URI = `http://localhost:3000${SALESFORCE_CALLBACK_PATH}`
const DEFAULT_LOGIN_ORIGIN = 'https://login.salesforce.com'

export const SALESFORCE_OAUTH_COOKIE = 'outlio_salesforce_oauth'
export const SALESFORCE_OAUTH_COOKIE_MAX_AGE = 10 * 60
export const SALESFORCE_SCOPES = ['api', 'refresh_token'] as const

export type SalesforceAuthorizationResult =
  | 'authorization_denied'
  | 'authorization_blocked'
  | 'authorization_failed'

/**
 * Salesforce uses `access_denied` for both a real user cancellation and some
 * organization/app policy failures. Keep those outcomes distinct so the UI
 * does not tell a customer they cancelled when their admin blocked the app.
 */
export function classifySalesforceAuthorizationError(
  error: string | null,
  description: string | null,
): SalesforceAuthorizationResult {
  const code = error?.trim().toLowerCase() ?? ''
  const detail = description?.trim().toLowerCase() ?? ''

  if (/end[ -]?user denied|user denied|cancel(?:led|ed)?/.test(detail)) {
    return 'authorization_denied'
  }
  if (
    code === 'invalid_client' ||
    /not approved|not pre.?authorized|blocked|must be installed|administrator|admin approved|permitted users/.test(detail)
  ) {
    return 'authorization_blocked'
  }
  return 'authorization_failed'
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  token_type: z.string().min(1).default('Bearer'),
  instance_url: z.string().url(),
  id: z.string().url(),
  issued_at: z.union([z.string(), z.number()]).optional(),
  scope: z.string().optional(),
})

export type SalesforceTokenSet = {
  accessToken: string
  refreshToken: string
  tokenType: string
  instanceUrl: string
  accountId: string
  userId: string | null
  expiresAt: string
  scopes: string[]
}

export class SalesforceOAuthError extends Error {
  constructor(
    message: string,
    readonly reconnectRequired = false,
  ) {
    super(message)
    this.name = 'SalesforceOAuthError'
  }
}

function configuredValue(name: 'SALESFORCE_CLIENT_ID' | 'SALESFORCE_CLIENT_SECRET' | 'SALESFORCE_REDIRECT_URI'): string | undefined {
  let value = process.env[name]?.trim()
  if (!value) return undefined
  if (value.startsWith(`${name}=`)) value = value.slice(name.length + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1).trim()
  return value || undefined
}

function clientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = configuredValue('SALESFORCE_CLIENT_ID')
  const clientSecret = configuredValue('SALESFORCE_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    throw new SalesforceOAuthError('Salesforce OAuth is not configured.')
  }
  return { clientId, clientSecret }
}

function salesforceLoginOrigin(): string {
  const value = process.env.SALESFORCE_LOGIN_URL?.trim() || DEFAULT_LOGIN_ORIGIN
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new SalesforceOAuthError('SALESFORCE_LOGIN_URL must be an absolute URL.')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    !['login.salesforce.com', 'test.salesforce.com'].includes(parsed.hostname)
  ) {
    throw new SalesforceOAuthError('SALESFORCE_LOGIN_URL is not an approved Salesforce login URL.')
  }
  return parsed.origin
}

export function salesforceRedirectUri(): string {
  const configured = configuredValue('SALESFORCE_REDIRECT_URI')
  const redirectUri = configured || (
    process.env.NODE_ENV === 'production' ? PRODUCTION_REDIRECT_URI : LOCAL_REDIRECT_URI
  )
  let parsed: URL
  try {
    parsed = new URL(redirectUri)
  } catch {
    throw new SalesforceOAuthError('SALESFORCE_REDIRECT_URI must be an absolute URL.')
  }
  if (parsed.pathname !== SALESFORCE_CALLBACK_PATH || parsed.search || parsed.hash) {
    throw new SalesforceOAuthError('SALESFORCE_REDIRECT_URI must use the Salesforce callback route.')
  }
  const isProduction = redirectUri === PRODUCTION_REDIRECT_URI
  const isLocal = redirectUri === LOCAL_REDIRECT_URI
  if (!isProduction && !(process.env.NODE_ENV !== 'production' && isLocal)) {
    throw new SalesforceOAuthError('SALESFORCE_REDIRECT_URI is not an approved Outlio callback URL.')
  }
  return redirectUri
}

export function isApprovedOutlioAppOrigin(value: string): boolean {
  try {
    const origin = new URL(value).origin
    if (origin === 'https://outlio.io' || origin === 'https://app.outlio.io') return true
    return process.env.NODE_ENV !== 'production' && origin === 'http://localhost:3000'
  } catch {
    return false
  }
}

export function createSalesforcePkce(): {
  verifier: string
  challenge: string
} {
  const verifier = randomBytes(64).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function buildSalesforceAuthorizationUrl(
  state: string,
  codeChallenge: string,
): string {
  const { clientId } = clientCredentials()
  const url = new URL('/services/oauth2/authorize', salesforceLoginOrigin())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', salesforceRedirectUri())
  url.searchParams.set('scope', SALESFORCE_SCOPES.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export function validateSalesforceInstanceUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new SalesforceOAuthError('Salesforce returned an invalid instance URL.')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname.endsWith('.salesforce.com')
  ) {
    throw new SalesforceOAuthError('Salesforce returned an unapproved instance URL.')
  }
  return parsed.origin
}

function identityParts(identityUrl: string): { accountId: string; userId: string | null } {
  const parts = new URL(identityUrl).pathname.split('/').filter(Boolean)
  const idIndex = parts.lastIndexOf('id')
  const accountId = idIndex >= 0 ? parts[idIndex + 1] : undefined
  if (!accountId) throw new SalesforceOAuthError('Salesforce did not identify the connected organization.')
  return { accountId, userId: parts[idIndex + 2] ?? null }
}

function scopesFrom(value: string | undefined): string[] {
  return value ? [...new Set(value.split(/\s+/).filter(Boolean))] : []
}

async function requestTokens(
  parameters: Record<string, string>,
  options: {
    existingRefreshToken?: string
    existingInstanceUrl?: string
    reconnectOnInvalidGrant?: boolean
  } = {},
): Promise<SalesforceTokenSet> {
  const { clientId, clientSecret } = clientCredentials()
  let response: Response
  try {
    response = await fetch(new URL('/services/oauth2/token', salesforceLoginOrigin()), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: parameters.grant_type,
        client_id: clientId,
        client_secret: clientSecret,
        ...parameters,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new SalesforceOAuthError('Salesforce could not be reached. Please try again.')
  }

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const errorCode = body && typeof body === 'object' && 'error' in body
      ? String(body.error)
      : ''
    const reconnectRequired = Boolean(options.reconnectOnInvalidGrant && errorCode === 'invalid_grant')
    throw new SalesforceOAuthError(
      reconnectRequired
        ? 'Your Salesforce authorization has expired. Reconnect Salesforce.'
        : 'Salesforce rejected the OAuth request. Please try again.',
      reconnectRequired,
    )
  }

  const parsed = tokenResponseSchema.safeParse(body)
  if (!parsed.success) throw new SalesforceOAuthError('Salesforce returned an invalid OAuth response.')
  const refreshToken = parsed.data.refresh_token ?? options.existingRefreshToken
  if (!refreshToken) throw new SalesforceOAuthError('Salesforce did not return a refresh token.')
  const instanceUrl = validateSalesforceInstanceUrl(
    parsed.data.instance_url || options.existingInstanceUrl || '',
  )
  const identity = identityParts(parsed.data.id)

  return {
    accessToken: parsed.data.access_token,
    refreshToken,
    tokenType: parsed.data.token_type,
    instanceUrl,
    accountId: identity.accountId,
    userId: identity.userId,
    // Salesforce access-token lifetime follows the org session policy and is
    // not returned by this flow. Refresh conservatively before long exports.
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    scopes: scopesFrom(parsed.data.scope),
  }
}

export async function exchangeSalesforceAuthorizationCode(
  code: string,
  codeVerifier: string,
): Promise<SalesforceTokenSet> {
  const tokens = await requestTokens({
    grant_type: 'authorization_code',
    code,
    redirect_uri: salesforceRedirectUri(),
    code_verifier: codeVerifier,
  })
  if (tokens.scopes.length === 0) tokens.scopes = [...SALESFORCE_SCOPES]
  return tokens
}

export async function refreshSalesforceToken(
  refreshToken: string,
  instanceUrl: string,
): Promise<SalesforceTokenSet> {
  return requestTokens(
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    {
      existingRefreshToken: refreshToken,
      existingInstanceUrl: instanceUrl,
      reconnectOnInvalidGrant: true,
    },
  )
}

export async function revokeSalesforceRefreshToken(
  refreshToken: string,
  instanceUrl: string,
): Promise<void> {
  const origin = validateSalesforceInstanceUrl(instanceUrl)
  let response: Response
  try {
    response = await fetch(new URL('/services/oauth2/revoke', origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new SalesforceOAuthError('Salesforce could not be reached to revoke the connection.')
  }
  if (!response.ok) throw new SalesforceOAuthError('Salesforce could not revoke the connection.')
}
