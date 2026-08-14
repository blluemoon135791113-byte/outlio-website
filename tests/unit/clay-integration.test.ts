import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ClayExportProvider,
  parseClayWebhookUrl,
  testClayCredentials,
  toClayLeadPayload,
} from '@/lib/integrations/clay'
import type { ExportLead } from '@/lib/export/leads'

const WEBHOOK = 'https://api.clay.com/v3/sources/webhook/fabricated-test-id'

const lead: ExportLead = {
  id: '0642de5b-ad00-4b95-96eb-aa17e60ccf9d',
  name: 'Ada Example',
  linkedinUrl: 'https://www.linkedin.com/in/fabricated-1',
  jobTitle: 'Founder',
  companyName: 'Example Company',
  companyUrl: 'https://example.com',
  salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/fabricated-1',
  location: 'London, United Kingdom',
}

afterEach(() => vi.unstubAllGlobals())

describe('Clay integration', () => {
  it('accepts only Clay HTTPS webhook URLs', () => {
    expect(parseClayWebhookUrl(WEBHOOK)?.href).toBe(WEBHOOK)
    expect(parseClayWebhookUrl('http://api.clay.com/v3/sources/webhook/id')).toBeNull()
    expect(parseClayWebhookUrl('https://example.com/v3/sources/webhook/id')).toBeNull()
    expect(parseClayWebhookUrl('https://api.clay.com.evil.test/v3/sources/webhook/id')).toBeNull()
    expect(parseClayWebhookUrl('https://api.clay.com/v3/sources/webhook/id?token=secret')).toBeNull()
  })

  it('uses stable field names and preserves missing data as null', () => {
    expect(toClayLeadPayload(lead)).toEqual({
      name: 'Ada Example',
      linkedin_profile_url: lead.linkedinUrl,
      job_title: 'Founder',
      company: 'Example Company',
      company_url: 'https://example.com',
      location: 'London, United Kingdom',
      sales_navigator_url: lead.salesNavigatorUrl,
    })
  })

  it('adds the optional auth header without exposing it in the payload', async () => {
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('x-clay-webhook-auth')).toBe('private-token')
      expect(String(init?.body)).not.toContain('private-token')
      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      testClayCredentials({
        clayWebhookUrl: WEBHOOK,
        clayAuthenticationToken: 'private-token',
      }),
    ).resolves.toMatchObject({ ok: true })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('maps an authentication rejection to reconnect-required copy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))
    await expect(
      testClayCredentials({ clayWebhookUrl: WEBHOOK }),
    ).resolves.toEqual({
      ok: false,
      reconnectRequired: true,
      message: 'Clay rejected the authentication token. Reconnect with the correct token.',
    })
  })

  it('paces exports and retries a transient Clay rate limit', async () => {
    let request = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        request += 1
        return request === 2
          ? new Response(null, { status: 429, headers: { 'retry-after': '0' } })
          : new Response(null, { status: 200 })
      }),
    )
    const provider = new ClayExportProvider({ clayWebhookUrl: WEBHOOK })
    const result = await provider.exportLeads(
      { userId: 'user', connectionId: 'connection', existingRecordIds: new Map() },
      [lead, { ...lead, id: '5d56365e-b6ca-4e71-98cc-3077816f06fa' }],
    )

    expect(result.successfulCount).toBe(2)
    expect(result.failedCount).toBe(0)
    expect(request).toBe(3)
  })
})
