import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ExportLead } from '@/lib/export/leads'
import {
  HubSpotContactExportProvider,
  toHubSpotContactProperties,
} from '@/lib/integrations/hubspot-contacts'

const lead: ExportLead = {
  id: '0642de5b-ad00-4b95-96eb-aa17e60ccf9d',
  name: 'Ada Lovelace',
  linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace',
  jobTitle: 'Founder',
  companyName: 'Analytical Engines',
  companyUrl: 'https://example.com',
  companyLinkedInUrl: 'https://www.linkedin.com/sales/company/example',
  salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/example',
  location: 'London, United Kingdom',
}

afterEach(() => vi.unstubAllGlobals())

describe('HubSpot contact export', () => {
  it('maps exactly the six Outlio fields to writable HubSpot contact properties', () => {
    expect(toHubSpotContactProperties(lead)).toEqual({
      firstname: 'Ada',
      lastname: 'Lovelace',
      hs_linkedin_url: lead.linkedinUrl,
      jobtitle: 'Founder',
      company: 'Analytical Engines',
      website: 'https://example.com',
      outlio_lead_url: lead.linkedinUrl,
      outlio_job_title: 'Founder',
      outlio_company: 'Analytical Engines',
      outlio_company_linkedin_url: lead.companyLinkedInUrl,
      outlio_company_website_url: 'https://example.com',
      outlio_location: lead.location,
      outlio_sales_navigator_url: lead.salesNavigatorUrl,
      message: `Location: ${lead.location}\nSales Navigator URL: ${lead.salesNavigatorUrl}\nCompany LinkedIn URL: ${lead.companyLinkedInUrl}`,
    })
  })

  it('uses the exact Sales Navigator lead URL when no verified public profile exists', () => {
    expect(toHubSpotContactProperties({ ...lead, linkedinUrl: null }).outlio_lead_url)
      .toBe(lead.salesNavigatorUrl)
    expect(toHubSpotContactProperties({ ...lead, linkedinUrl: null }).hs_linkedin_url)
      .toBeUndefined()
  })

  it('creates unlinked contacts and updates only records linked by this connection', async () => {
    const secondLead: ExportLead = {
      ...lead,
      id: '5d56365e-b6ca-4e71-98cc-3077816f06fa',
      name: 'Grace Hopper',
    }
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const endpoint = String(url)
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer customer-token')
      expect(String(init?.body)).not.toContain('customer-token')
      if (endpoint.includes('/crm/properties/')) {
        return new Response(null, { status: 409 })
      }
      const body = JSON.parse(String(init?.body)) as {
        inputs: Array<{ id?: string; objectWriteTraceId: string }>
      }

      if (endpoint.endsWith('/batch/create')) {
        expect(body.inputs).toEqual([
          expect.objectContaining({ objectWriteTraceId: lead.id }),
        ])
        return Response.json({
          results: [{ id: 'new-contact-id', objectWriteTraceId: lead.id }],
        }, { status: 201 })
      }

      expect(endpoint).toMatch(/\/batch\/update$/)
      expect(body.inputs).toEqual([
        expect.objectContaining({
          id: 'existing-customer-contact',
          objectWriteTraceId: secondLead.id,
        }),
      ])
      return Response.json({
        results: [{ id: 'existing-customer-contact', objectWriteTraceId: secondLead.id }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new HubSpotContactExportProvider('customer-token')
    const result = await provider.exportLeads({
      userId: 'customer-a',
      connectionId: 'connection-a',
      existingRecordIds: new Map([[secondLead.id, 'existing-customer-contact']]),
    }, [lead, secondLead])

    expect(result).toMatchObject({ successfulCount: 2, failedCount: 0 })
    expect(result.records).toEqual(expect.arrayContaining([
      { leadId: lead.id, providerRecordId: 'new-contact-id' },
      { leadId: secondLead.id, providerRecordId: 'existing-customer-contact' },
    ]))
    expect(fetchMock).toHaveBeenCalledTimes(9)
  })

  it('marks authorization failures as reconnect-required export errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))
    const provider = new HubSpotContactExportProvider('revoked-token')
    const result = await provider.exportLeads({
      userId: 'customer-b',
      connectionId: 'connection-b',
      existingRecordIds: new Map(),
    }, [lead])

    expect(result).toMatchObject({ successfulCount: 0, failedCount: 1 })
    expect(result.failures?.[0]?.code).toBe('HUBSPOT_AUTH_REJECTED')
  })
})
