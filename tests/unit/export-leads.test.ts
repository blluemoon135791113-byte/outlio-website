import { describe, expect, it } from 'vitest'

import {
  EXPORT_COLUMN_ORDER,
  normalizeExportLead,
  toCanonicalExportRecord,
} from '@/lib/export/leads'

describe('normalizeExportLead', () => {
  it('maps the real database fields without inventing unavailable data', () => {
    const lead = normalizeExportLead({
      id: '10d8ed22-7b53-48bb-9e9c-0ecfe2f5c785',
      full_name: 'Áda Example',
      linkedin_url: 'https://www.linkedin.com/in/fabricated-1',
      sales_navigator_url: 'https://www.linkedin.com/sales/lead/fabricated-1',
      job_title: 'Founder',
      company_name: 'Example, Inc.',
      company_url: 'https://example.com',
      company_website_url: 'https://company.example',
      location: 'London, United Kingdom',
    })

    expect(lead).toEqual({
      id: '10d8ed22-7b53-48bb-9e9c-0ecfe2f5c785',
      name: 'Áda Example',
      linkedinUrl: 'https://www.linkedin.com/in/fabricated-1',
      jobTitle: 'Founder',
      companyName: 'Example, Inc.',
      companyLinkedInUrl: 'https://example.com',
      companyUrl: 'https://company.example',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/fabricated-1',
      location: 'London, United Kingdom',
    })
    expect(EXPORT_COLUMN_ORDER).toEqual([
      'Name',
      'LinkedIn Profile',
      'Job Title',
      'Company',
      'Company LinkedIn URL',
      'Company Website URL',
      'Location',
      'Sales Navigator URL',
    ])
    expect(toCanonicalExportRecord(lead)).toEqual({
      Name: 'Áda Example',
      'LinkedIn Profile': 'https://www.linkedin.com/in/fabricated-1',
      'Job Title': 'Founder',
      Company: 'Example, Inc.',
      'Company LinkedIn URL': 'https://example.com',
      'Company Website URL': 'https://company.example',
      Location: 'London, United Kingdom',
      'Sales Navigator URL': 'https://www.linkedin.com/sales/lead/fabricated-1',
    })
  })

  it('preserves missing optional fields as null', () => {
    const lead = normalizeExportLead({
      id: '4d318a4c-63f2-43e3-ac00-9579442af6a8',
      full_name: null,
      linkedin_url: null,
      sales_navigator_url: null,
      job_title: null,
      company_name: null,
      company_url: null,
      company_website_url: null,
      location: null,
    })

    expect(lead.name).toBeNull()
    expect(lead.salesNavigatorUrl).toBeNull()
    expect(lead.location).toBeNull()
  })

  it('converts legacy generated public URLs into exact Sales Navigator links', () => {
    const lead = normalizeExportLead({
      id: '4d318a4c-63f2-43e3-ac00-9579442af6a9',
      full_name: 'Legacy Example',
      linkedin_url: 'https://www.linkedin.com/in/ACwAALEGACY123',
      sales_navigator_url: null,
      job_title: 'Founder',
      company_name: 'Example',
      company_url: null,
      company_website_url: null,
      location: null,
    })

    expect(lead.linkedinUrl).toBeNull()
    expect(lead.salesNavigatorUrl).toBe(
      'https://www.linkedin.com/sales/lead/ACwAALEGACY123',
    )
  })
})
