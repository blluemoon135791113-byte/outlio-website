import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildHubSpotAuthorizationUrl,
  exchangeHubSpotAuthorizationCode,
  HubSpotOAuthError,
  hubSpotRedirectUri,
  isApprovedOutlioAppOrigin,
  refreshHubSpotToken,
  revokeHubSpotRefreshToken,
} from '@/lib/integrations/hubspot'
import {
  createHubSpotOAuthBrowserBinding,
  readHubSpotOAuthBrowserBinding,
} from '@/lib/integrations/hubspot-repository'

function configureHubSpot() {
  vi.stubEnv('HUBSPOT_CLIENT_ID', 'test-client-id')
  vi.stubEnv('HUBSPOT_CLIENT_SECRET', 'test-client-secret')
  vi.stubEnv('HUBSPOT_REDIRECT_URI', 'https://app.outlio.io/api/integrations/hubspot/callback')
  vi.stubEnv('NODE_ENV', 'production')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('HubSpot OAuth integration', () => {
  it('uses the fixed production callback and an any-account authorization URL', () => {
    configureHubSpot()
    const url = new URL(buildHubSpotAuthorizationUrl('secure-state'))

    expect(hubSpotRedirectUri()).toBe('https://app.outlio.io/api/integrations/hubspot/callback')
    expect(url.origin + url.pathname).toBe('https://app.hubspot.com/oauth/authorize')
    expect(url.pathname).not.toMatch(/\/oauth\/\d+\/authorize/)
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('scope')).toBe(
      'oauth crm.objects.contacts.write crm.schemas.contacts.write',
    )
    expect(url.searchParams.get('optional_scope')).toBe('crm.objects.contacts.read')
    expect(url.searchParams.get('state')).toBe('secure-state')
  })

  it('tolerates Vercel values pasted in NAME=value format', () => {
    configureHubSpot()
    vi.stubEnv('HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_ID=test-client-id')
    vi.stubEnv('HUBSPOT_CLIENT_SECRET', 'HUBSPOT_CLIENT_SECRET=test-client-secret')
    vi.stubEnv('HUBSPOT_REDIRECT_URI', 'HUBSPOT_REDIRECT_URI=https://app.outlio.io/api/integrations/hubspot/callback')

    const url = new URL(buildHubSpotAuthorizationUrl('secure-state'))
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.outlio.io/api/integrations/hubspot/callback')
  })

  it('rejects an unapproved production callback', () => {
    configureHubSpot()
    vi.stubEnv('HUBSPOT_REDIRECT_URI', 'https://attacker.test/api/integrations/hubspot/callback')
    expect(() => hubSpotRedirectUri()).toThrow('not an approved Outlio callback URL')
  })

  it('allows only the production app hosts and localhost in development', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(isApprovedOutlioAppOrigin('https://outlio.io')).toBe(true)
    expect(isApprovedOutlioAppOrigin('https://app.outlio.io')).toBe(true)
    expect(isApprovedOutlioAppOrigin('https://outlio.io.attacker.test')).toBe(false)
    expect(isApprovedOutlioAppOrigin('http://localhost:3000')).toBe(false)

    vi.stubEnv('NODE_ENV', 'development')
    expect(isApprovedOutlioAppOrigin('http://localhost:3000')).toBe(true)
  })

  it('encrypts the short-lived cross-subdomain browser binding', () => {
    vi.stubEnv('INTEGRATION_ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('base64'))
    const value = createHubSpotOAuthBrowserBinding({
      userId: '3dc6357d-9910-4668-a839-c9996be38595',
      state: 'private-state',
      returnOrigin: 'https://app.outlio.io',
    })

    expect(value).not.toContain('private-state')
    expect(readHubSpotOAuthBrowserBinding(value)).toEqual({
      userId: '3dc6357d-9910-4668-a839-c9996be38595',
      state: 'private-state',
      returnOrigin: 'https://app.outlio.io',
    })
    expect(readHubSpotOAuthBrowserBinding(`${value}tampered`)).toBeNull()
  })

  it('exchanges the code with the current date-versioned token API', async () => {
    configureHubSpot()
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.hubapi.com/oauth/2026-03/token')
      expect(String(url)).not.toContain('test-client-secret')
      const form = new URLSearchParams(String(init?.body))
      expect(form.get('grant_type')).toBe('authorization_code')
      expect(form.get('client_secret')).toBe('test-client-secret')
      expect(form.get('redirect_uri')).toBe('https://app.outlio.io/api/integrations/hubspot/callback')
      return Response.json({
        access_token: 'customer-access-token',
        refresh_token: 'customer-refresh-token',
        token_type: 'bearer',
        expires_in: 1800,
        hub_id: 24680,
        scopes: ['crm.objects.contacts.write', 'crm.objects.contacts.read'],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(exchangeHubSpotAuthorizationCode('one-time-code')).resolves.toMatchObject({
      accessToken: 'customer-access-token',
      refreshToken: 'customer-refresh-token',
      accountId: '24680',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('supports refresh-token rotation and marks invalid grants for reconnect', async () => {
    configureHubSpot()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      access_token: 'new-access-token',
      refresh_token: 'rotated-refresh-token',
      token_type: 'bearer',
      expires_in: 1800,
      scopes: ['crm.objects.contacts.write'],
    })))

    await expect(refreshHubSpotToken('old-refresh-token')).resolves.toMatchObject({
      accessToken: 'new-access-token',
      refreshToken: 'rotated-refresh-token',
    })

    vi.stubGlobal('fetch', vi.fn(async () => Response.json(
      { error: 'invalid_grant' },
      { status: 400 },
    )))
    await expect(refreshHubSpotToken('revoked-token')).rejects.toMatchObject({
      reconnectRequired: true,
    } satisfies Partial<HubSpotOAuthError>)
  })

  it('revokes the refresh token without putting credentials in the URL', async () => {
    configureHubSpot()
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.hubapi.com/oauth/2026-03/token/revoke')
      expect(String(url)).not.toContain('customer-refresh-token')
      const form = new URLSearchParams(String(init?.body))
      expect(form.get('token')).toBe('customer-refresh-token')
      expect(form.get('token_type_hint')).toBe('refresh_token')
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(revokeHubSpotRefreshToken('customer-refresh-token')).resolves.toBeUndefined()
  })
})
