import { afterEach, describe, expect, it, vi } from 'vitest'

import { exportLeadsToGhl, testGhlCredentials, validateGhlCredentials } from '@/lib/integrations/ghl'
import type { ExportLead } from '@/lib/export/leads'

const credentials = { token: 'pit-token-that-is-long-enough-for-validation', locationId: 'location_12345' }
const lead: ExportLead = { id: '0642de5b-ad00-4b95-96eb-aa17e60ccf9d', name: 'Ada Example', linkedinUrl: 'https://linkedin.com/in/ada', jobTitle: 'Founder', companyName: 'Example Co', companyUrl: 'https://example.com', location: 'London', salesNavigatorUrl: 'https://linkedin.com/sales/lead/ada' }

afterEach(() => vi.unstubAllGlobals())

describe('HighLevel private integration', () => {
  it('validates token and location input without exposing the token', () => {
    expect(validateGhlCredentials(credentials)).toEqual(credentials)
    expect(validateGhlCredentials({ token: 'short', locationId: credentials.locationId })).toBeNull()
    expect(validateGhlCredentials({ token: credentials.token, locationId: 'bad location' })).toBeNull()
  })

  it('distinguishes invalid tokens, missing scopes, and wrong locations', async () => {
    for (const [status, message] of [[401, 'rejected'], [403, 'locations.readonly'], [404, 'does not match']] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })))
      const result = await testGhlCredentials(credentials)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.message).toContain(message)
    }
  })

  it('creates contacts with canonical fields and optional URL custom fields', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${credentials.token}`)
      if (String(url).includes('customFields?')) return Response.json({ customFields: [
        { id: 'linkedin-field', name: 'Outlio LinkedIn Profile URL' },
        { id: 'sales-nav-field', name: 'Outlio Sales Navigator URL' },
        { id: 'company-field', name: 'Outlio Company Profile URL' },
      ] })
      const body = JSON.parse(String(init?.body))
      expect(body.locationId).toBe(credentials.locationId)
      expect(body.companyName).toBe('Example Co')
      expect(body.address1).toBe('London')
      expect(body.customFields).toHaveLength(3)
      return Response.json({ contact: { id: 'contact-id' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(exportLeadsToGhl(credentials, [lead])).resolves.toMatchObject({ successfulCount: 1, failedCount: 0 })
  })
})
