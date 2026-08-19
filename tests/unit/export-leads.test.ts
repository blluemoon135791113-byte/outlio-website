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
     * ⚠️ THIS ORDER CHANGED DELIBERATELY, AND IT IS A BREAKING CHANGE.
     *
     * The first eight columns were previously frozen precisely so a customer's
     * CRM field-mapping would keep working. They were reordered on request:
     * the two person URLs now sit together and the two company URLs after them,
     * because reading one lead's links meant scrolling past six unrelated
     * fields. `Company HQ` was dropped for duplicating `Location`.
     *
     * Anyone with an existing import mapping has to remap. Reordering again
     * without that being a conscious decision is what this test prevents.
     */
    expect(EXPORT_COLUMN_ORDER.slice(0, 9)).toEqual([
      'Name',
      'LinkedIn Profile',
      'Sales Navigator URL',
      'Job Title',
      'Location',
      'Company',
      'Company LinkedIn URL',
      'Company LinkedIn Profile',
      'Company Website URL',
    ])

    // The person's two links are adjacent, and so are the company's.
    const order = [...EXPORT_COLUMN_ORDER]
    expect(order.indexOf('Sales Navigator URL') - order.indexOf('LinkedIn Profile')).toBe(1)
    expect(order.indexOf('Company Website URL') - order.indexOf('Company LinkedIn URL')).toBe(2)

    // HQ is gone: it duplicated Location on almost every row.
    expect(order).not.toContain('Company HQ')

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
