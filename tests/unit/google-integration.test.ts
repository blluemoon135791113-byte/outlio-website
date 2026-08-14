import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildGoogleAuthorizationUrl, exchangeGoogleAuthorizationCode, GOOGLE_SCOPES, googleRedirectUri } from '@/lib/integrations/google'
import { exportLeadsToGoogleDrive, exportLeadsToGoogleSheet } from '@/lib/integrations/google-exports'
import type { ExportLead } from '@/lib/export/leads'

const lead: ExportLead = {
  id: '0642de5b-ad00-4b95-96eb-aa17e60ccf9d', name: 'Ada Example', linkedinUrl: 'https://linkedin.com/in/ada', jobTitle: 'Founder', companyName: 'Example Co', companyUrl: 'https://example.com', location: 'London', salesNavigatorUrl: 'https://linkedin.com/sales/lead/ada',
}

function configure() {
  vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client-id')
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-client-secret')
  vi.stubEnv('GOOGLE_REDIRECT_URI', 'https://app.outlio.io/api/integrations/google/callback')
  vi.stubEnv('NODE_ENV', 'production')
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('Google integrations', () => {
  it('builds an offline, state-bound OAuth request with file-scoped Drive access', () => {
    configure()
    const url = new URL(buildGoogleAuthorizationUrl('secure-state'))
    expect(googleRedirectUri()).toBe('https://app.outlio.io/api/integrations/google/callback')
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('state')).toBe('secure-state')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('scope')).toBe(GOOGLE_SCOPES.join(' '))
    expect(url.searchParams.get('scope')).toContain('drive.file')
  })

  it('tolerates Vercel values pasted in NAME=value format', () => {
    configure()
    vi.stubEnv('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_ID=google-client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET=google-client-secret')
    vi.stubEnv('GOOGLE_REDIRECT_URI', 'GOOGLE_REDIRECT_URI=https://app.outlio.io/api/integrations/google/callback')

    const url = new URL(buildGoogleAuthorizationUrl('secure-state'))
    expect(url.searchParams.get('client_id')).toBe('google-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.outlio.io/api/integrations/google/callback')
  })

  it('exchanges the code server-side and identifies the customer account', async () => {
    configure()
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('/token')) {
        expect(new URLSearchParams(String(init?.body)).get('client_secret')).toBe('google-client-secret')
        return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'Bearer', scope: GOOGLE_SCOPES.join(' ') })
      }
      return Response.json({ sub: 'google-account-id', email: 'owner@example.com' })
    }))
    await expect(exchangeGoogleAuthorizationCode('one-time-code')).resolves.toMatchObject({ accountId: 'google-account-id', accountEmail: 'owner@example.com', refreshToken: 'refresh' })
  })

  it('writes canonical rows to Sheets and uploads a CSV to Drive', async () => {
    let request = 0
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      request += 1
      if (String(url).includes('sheets.googleapis.com/v4/spreadsheets') && request === 1) return Response.json({ spreadsheetId: 'sheet-id', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-id' })
      if (String(url).includes('/values/A1')) {
        expect(String(init?.body)).toContain('Sales Navigator URL')
        return Response.json({ updatedRows: 2 })
      }
      expect(String(init?.body)).toContain('LinkedIn Profile')
      return Response.json({ id: 'drive-id', webViewLink: 'https://drive.google.com/open?id=drive-id' })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(exportLeadsToGoogleSheet('access', [lead])).resolves.toMatchObject({ successfulCount: 1, destinationId: 'sheet-id' })
    await expect(exportLeadsToGoogleDrive('access', [lead])).resolves.toMatchObject({ successfulCount: 1, destinationId: 'drive-id' })
  })
})
