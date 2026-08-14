import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ExportLead } from '@/lib/export/leads'
import {
  SalesforceLeadExportProvider,
  toSalesforceLeadFields,
} from '@/lib/integrations/salesforce-leads'

const lead: ExportLead = {
  id: '0642de5b-ad00-4b95-96eb-aa17e60ccf9d',
  name: 'Ada Lovelace',
  linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace',
  jobTitle: 'Founder',
  companyName: 'Analytical Engines',
  companyUrl: 'https://example.com',
  salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/example',
  location: 'London, United Kingdom',
}

afterEach(() => vi.unstubAllGlobals())

describe('Salesforce lead export', () => {
  it('maps the canonical fields to the standard Salesforce Lead object', () => {
    expect(toSalesforceLeadFields(lead)).toEqual({
      FirstName: 'Ada',
      LastName: 'Lovelace',
      Company: 'Analytical Engines',
      Title: 'Founder',
      Website: 'https://example.com',
      Description: `LinkedIn Profile: ${lead.linkedinUrl}\nSales Navigator URL: ${lead.salesNavigatorUrl}\nLocation: ${lead.location}`,
    })
    expect(toSalesforceLeadFields({ ...lead, companyName: null })).toBeNull()
  })

  it('creates unlinked leads and updates only tenant-linked Salesforce records', async () => {
    const secondLead = { ...lead, id: '5d56365e-b6ca-4e71-98cc-3077816f06fa' }
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://customer.my.salesforce.com/services/data/v67.0/composite')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer customer-token')
      expect(String(init?.body)).not.toContain('customer-token')
      const body = JSON.parse(String(init?.body)) as {
        allOrNone: boolean
        compositeRequest: Array<{ method: string; url: string; referenceId: string }>
      }
      expect(body.allOrNone).toBe(false)
      expect(body.compositeRequest).toEqual([
        expect.objectContaining({ method: 'POST', url: '/services/data/v67.0/sobjects/Lead' }),
        expect.objectContaining({ method: 'PATCH', url: '/services/data/v67.0/sobjects/Lead/00Q000000000002AAA' }),
      ])
      return Response.json({
        compositeResponse: [
          { referenceId: 'outlioLead0', httpStatusCode: 201, body: { id: '00Q000000000001AAA', success: true } },
          { referenceId: 'outlioLead1', httpStatusCode: 204, body: null },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = new SalesforceLeadExportProvider(
      'customer-token',
      'https://customer.my.salesforce.com',
    )
    const result = await provider.exportLeads({
      userId: 'customer-a',
      connectionId: 'connection-a',
      existingRecordIds: new Map([[secondLead.id, '00Q000000000002AAA']]),
    }, [lead, secondLead])

    expect(result).toMatchObject({ successfulCount: 2, failedCount: 0 })
    expect(result.records).toEqual(expect.arrayContaining([
      { leadId: lead.id, providerRecordId: '00Q000000000001AAA' },
      { leadId: secondLead.id, providerRecordId: '00Q000000000002AAA' },
    ]))
  })

  it('returns safe reconnect errors for authorization rejection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))
    const provider = new SalesforceLeadExportProvider(
      'rejected-token',
      'https://customer.my.salesforce.com',
    )
    const result = await provider.exportLeads({
      userId: 'customer-b',
      connectionId: 'connection-b',
      existingRecordIds: new Map(),
    }, [lead])
    expect(result).toMatchObject({ successfulCount: 0, failedCount: 1 })
    expect(result.failures?.[0]?.code).toBe('SALESFORCE_AUTH_REJECTED')
  })

  it('returns a useful safe error for an organization validation rule', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      compositeResponse: [{
        referenceId: 'outlioLead0',
        httpStatusCode: 400,
        body: [{ errorCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'private rule detail' }],
      }],
    })))
    const provider = new SalesforceLeadExportProvider(
      'customer-token',
      'https://customer.my.salesforce.com',
    )
    const result = await provider.exportLeads({
      userId: 'customer-c',
      connectionId: 'connection-c',
      existingRecordIds: new Map(),
    }, [lead])
    expect(result.failures).toEqual([{
      leadId: lead.id,
      code: 'SALESFORCE_FIELD_CUSTOM_VALIDATION_EXCEPTION',
      message: 'A Salesforce validation rule rejected this lead.',
    }])
    expect(JSON.stringify(result)).not.toContain('private rule detail')
  })
})
