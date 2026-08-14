import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildSalesforceAuthorizationUrl,
  classifySalesforceAuthorizationError,
  createSalesforcePkce,
  exchangeSalesforceAuthorizationCode,
  refreshSalesforceToken,
  revokeSalesforceRefreshToken,
  SalesforceOAuthError,
  salesforceRedirectUri,
  validateSalesforceInstanceUrl,
} from '@/lib/integrations/salesforce'
import {
  createSalesforceOAuthBrowserBinding,
  readSalesforceOAuthBrowserBinding,
} from '@/lib/integrations/salesforce-repository'

function configureSalesforce() {
  vi.stubEnv('SALESFORCE_CLIENT_ID', 'customer-facing-client-id')
  vi.stubEnv('SALESFORCE_CLIENT_SECRET', 'server-client-secret')
  vi.stubEnv('SALESFORCE_REDIRECT_URI', 'https://app.outlio.io/api/integrations/salesforce/callback')
  vi.stubEnv('SALESFORCE_LOGIN_URL', 'https://login.salesforce.com')
  vi.stubEnv('NODE_ENV', 'production')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Salesforce OAuth integration', () => {
  it('distinguishes user cancellation from Salesforce policy blocks', () => {
    expect(classifySalesforceAuthorizationError(
      'access_denied',
      'end-user denied authorization',
    )).toBe('authorization_denied')
    expect(classifySalesforceAuthorizationError(
      'access_denied',
      'User is not approved by an administrator for this app',
    )).toBe('authorization_blocked')
    expect(classifySalesforceAuthorizationError(
      'invalid_client',
      'app must be installed into org',
    )).toBe('authorization_blocked')
    expect(classifySalesforceAuthorizationError(
      'access_denied',
      'OAUTH_APPROVAL_ERROR_GENERIC',
    )).toBe('authorization_failed')
  })

  it('uses the production callback and Web Server flow with S256 PKCE', () => {
    configureSalesforce()
    const pkce = createSalesforcePkce()
    const url = new URL(buildSalesforceAuthorizationUrl('secure-state', pkce.challenge))

    expect(salesforceRedirectUri()).toBe('https://app.outlio.io/api/integrations/salesforce/callback')
    expect(url.origin + url.pathname).toBe('https://login.salesforce.com/services/oauth2/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('api refresh_token')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBe(pkce.challenge)
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('tolerates Vercel values pasted in NAME=value format', () => {
    configureSalesforce()
    vi.stubEnv('SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_ID=customer-facing-client-id')
    vi.stubEnv('SALESFORCE_CLIENT_SECRET', 'SALESFORCE_CLIENT_SECRET=server-client-secret')
    vi.stubEnv('SALESFORCE_REDIRECT_URI', 'SALESFORCE_REDIRECT_URI=https://app.outlio.io/api/integrations/salesforce/callback')

    const url = new URL(buildSalesforceAuthorizationUrl('secure-state', 'pkce-challenge'))
    expect(url.searchParams.get('client_id')).toBe('customer-facing-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.outlio.io/api/integrations/salesforce/callback')
  })

  it('encrypts the state browser binding', () => {
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'))
    const value = createSalesforceOAuthBrowserBinding({
      userId: '3dc6357d-9910-4668-a839-c9996be38595',
      state: 'private-state',
      returnOrigin: 'https://app.outlio.io',
    })
    expect(value).not.toContain('private-state')
    expect(readSalesforceOAuthBrowserBinding(value)).toEqual({
      userId: '3dc6357d-9910-4668-a839-c9996be38595',
      state: 'private-state',
      returnOrigin: 'https://app.outlio.io',
    })
    expect(readSalesforceOAuthBrowserBinding(`${value}tampered`)).toBeNull()
  })

  it('exchanges the code server-side with verifier and client secret', async () => {
    configureSalesforce()
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://login.salesforce.com/services/oauth2/token')
      expect(String(url)).not.toContain('server-client-secret')
      const form = new URLSearchParams(String(init?.body))
      expect(form.get('grant_type')).toBe('authorization_code')
      expect(form.get('code_verifier')).toBe('private-pkce-verifier')
      expect(form.get('client_secret')).toBe('server-client-secret')
      return Response.json({
        access_token: 'customer-access-token',
        refresh_token: 'customer-refresh-token',
        token_type: 'Bearer',
        instance_url: 'https://customer.my.salesforce.com',
        id: 'https://login.salesforce.com/id/00D000000000001/005000000000001',
        scope: 'api refresh_token',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      exchangeSalesforceAuthorizationCode('one-time-code', 'private-pkce-verifier'),
    ).resolves.toMatchObject({
      accessToken: 'customer-access-token',
      refreshToken: 'customer-refresh-token',
      accountId: '00D000000000001',
      instanceUrl: 'https://customer.my.salesforce.com',
    })
  })

  it('captures a rotated refresh token and marks invalid_grant for reconnect', async () => {
    configureSalesforce()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      access_token: 'new-access-token',
      refresh_token: 'rotated-refresh-token',
      token_type: 'Bearer',
      instance_url: 'https://customer.my.salesforce.com',
      id: 'https://login.salesforce.com/id/00D000000000001/005000000000001',
      scope: 'api refresh_token',
    })))
    await expect(refreshSalesforceToken(
      'old-single-use-refresh-token',
      'https://customer.my.salesforce.com',
    )).resolves.toMatchObject({ refreshToken: 'rotated-refresh-token' })

    vi.stubGlobal('fetch', vi.fn(async () => Response.json(
      { error: 'invalid_grant' },
      { status: 400 },
    )))
    await expect(refreshSalesforceToken(
      'rejected-token',
      'https://customer.my.salesforce.com',
    )).rejects.toMatchObject({ reconnectRequired: true } satisfies Partial<SalesforceOAuthError>)
  })

  it('allowlists Salesforce instance hosts and revokes via a POST body', async () => {
    configureSalesforce()
    expect(validateSalesforceInstanceUrl('https://customer.my.salesforce.com/'))
      .toBe('https://customer.my.salesforce.com')
    expect(() => validateSalesforceInstanceUrl('https://customer.salesforce.com.attacker.test'))
      .toThrow('unapproved instance URL')

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://customer.my.salesforce.com/services/oauth2/revoke')
      expect(String(url)).not.toContain('private-refresh-token')
      expect(new URLSearchParams(String(init?.body)).get('token')).toBe('private-refresh-token')
      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(revokeSalesforceRefreshToken(
      'private-refresh-token',
      'https://customer.my.salesforce.com',
    )).resolves.toBeUndefined()
  })
})
