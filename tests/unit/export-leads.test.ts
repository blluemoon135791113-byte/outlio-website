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
    /*
     * ⚠️ THE FIRST EIGHT ARE FROZEN, IN THIS ORDER.
     *
     * Every destination and every customer field-mapping is built on them. New
     * columns are appended; one inserted among these would shift a customer's
     * import with no error to notice. The tail is allowed to grow, which is why
     * this asserts a prefix rather than the whole list.
     */
    expect(EXPORT_COLUMN_ORDER.slice(0, 8)).toEqual([
      'Name',
      'LinkedIn Profile',
      'Job Title',
      'Company',
      'Company LinkedIn URL',
      'Company Website URL',
      'Location',
      'Sales Navigator URL',
    ])

    // Everything the page carries is exported.
    expect(EXPORT_COLUMN_ORDER).toContain('Company Size')
    expect(EXPORT_COLUMN_ORDER).toContain('Connection Degree')
    expect(EXPORT_COLUMN_ORDER).toContain('Source List')

    /*
     * ⚠️ AND NOTHING THAT CANNOT BE OBTAINED. Email and phone are on neither
     * LinkedIn nor Sales Navigator — a real saved page carries zero addresses
     * and zero `tel:` links — so shipping the columns would promise a value no
     * free path can ever fill.
     */
    expect(EXPORT_COLUMN_ORDER).not.toContain('Work Email')
    expect(EXPORT_COLUMN_ORDER).not.toContain('Mobile Phone')
    expect(toCanonicalExportRecord(lead)).toMatchObject({
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

  it('preserves member-ID profile URLs captured from Sales Navigator', () => {
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

    expect(lead.linkedinUrl).toBe('https://www.linkedin.com/in/ACwAALEGACY123')
    expect(lead.salesNavigatorUrl).toBeNull()
  })
})
