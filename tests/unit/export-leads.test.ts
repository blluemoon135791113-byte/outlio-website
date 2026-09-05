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
      'Company Sales Navigator URL',
      'Company LinkedIn Profile (public)',
      'Company Website URL',
    ])

    // The person's two links are adjacent, and so are the company's.
    const order = [...EXPORT_COLUMN_ORDER]
    expect(order.indexOf('Sales Navigator URL') - order.indexOf('LinkedIn Profile')).toBe(1)
    expect(order.indexOf('Company Website URL') - order.indexOf('Company Sales Navigator URL')).toBe(2)

    // HQ is gone: it duplicated Location on almost every row.
    expect(order).not.toContain('Company HQ')

    // Added To List is gone: it contributed nothing a filter could use.
    expect(EXPORT_COLUMN_ORDER).not.toContain('Added To List')

    // Everything the page carries is exported.
    expect(EXPORT_COLUMN_ORDER).toContain('Company Size')
    expect(EXPORT_COLUMN_ORDER).toContain('Connection Degree')
    expect(EXPORT_COLUMN_ORDER).toContain('Source List')

    // Contact columns are now part of the stable contract. They stay N/A until
    // a public-source provider finds them; no value is inferred by the export.
    expect(EXPORT_COLUMN_ORDER).toContain('Work Email')
    expect(EXPORT_COLUMN_ORDER).toContain('Mobile Phone')
    expect(EXPORT_COLUMN_ORDER).toContain('Company Email')
    expect(EXPORT_COLUMN_ORDER).toContain('Company Phone')
    expect(toCanonicalExportRecord(lead)).toMatchObject({
      Name: 'Áda Example',
      'LinkedIn Profile': 'https://www.linkedin.com/in/fabricated-1',
      'Job Title': 'Founder',
      Company: 'Example, Inc.',
      'Company Sales Navigator URL': 'https://example.com',
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

describe('publicCompanyUrl', () => {
  it('rewrites the Sales Navigator company URL into the public one', async () => {
    /*
     * ⚠️ NO PAGE VISIT. LinkedIn resolves a numeric id on the public path and
     * redirects to the slug, so this is a pure rewrite of a URL already on the
     * row — the difference between filling this column for every lead with a
     * company and filling it for none.
     */
    const { publicCompanyUrl } = await import('@/lib/leads/parse')

    expect(publicCompanyUrl('https://www.linkedin.com/sales/company/106158339')).toBe(
      'https://www.linkedin.com/company/106158339',
    )
    expect(publicCompanyUrl('https://www.linkedin.com/sales/company/1035/')).toBe(
      'https://www.linkedin.com/company/1035',
    )
  })

  it('refuses anything that is not a Sales Navigator company URL', async () => {
    const { publicCompanyUrl } = await import('@/lib/leads/parse')

    for (const url of [
      null,
      undefined,
      '',
      'https://www.linkedin.com/sales/lead/ACwAAA',
      'https://www.linkedin.com/company/acme',
      // A lookalike host ends with the string but is not the domain.
      'https://linkedin.com.evil.test/sales/company/1035',
      'not a url',
    ]) {
      expect(publicCompanyUrl(url), String(url)).toBeNull()
    }
  })
})

describe('a column that is empty on every row is dropped', () => {
  it('omits it rather than writing a wall of N/A', async () => {
    /*
     * ⚠️ A COLUMN OF PURE "N/A" READS AS THE EXTRACTOR HAVING FAILED, when what
     * it means is the field is not on the page that was captured. Its absence
     * says the same thing without implying a fault.
     */
    const { toCsv } = await import('@/lib/export/sanitize')

    const csv = toCsv(
      [{ name: 'Ada', industry: null }],
      [
        { header: 'Name', value: (r: { name: string }) => r.name },
        { header: 'Company Industry', value: (r: { industry: null }) => r.industry },
      ],
    )

    expect(csv).toContain('Name')
    expect(csv).not.toContain('Company Industry')
    expect(csv).not.toContain('N/A')
  })

  it('KEEPS a column that any row fills, and marks the gaps', async () => {
    const { toCsv } = await import('@/lib/export/sanitize')

    const csv = toCsv([{ industry: 'Software' }, { industry: null }], [
      { header: 'Company Industry', value: (r: { industry: string | null }) => r.industry },
    ])

    expect(csv).toContain('Company Industry')
    expect(csv).toContain('Software')
    // The empty one still says N/A — the column earned its place.
    expect(csv).toContain('N/A')
  })

  it('pins the core columns even when the whole batch is empty', async () => {
    // A file whose every column came and went would be unmappable. The spine
    // stays so a CRM import mapping is buildable against something.
    const { toCsv } = await import('@/lib/export/sanitize')

    const csv = toCsv(
      [{ name: null }],
      [{ header: 'Name', value: (r: { name: null }) => r.name }],
      { alwaysKeep: ['Name'] },
    )

    expect(csv).toContain('Name')
    expect(csv).toContain('N/A')
  })
})
