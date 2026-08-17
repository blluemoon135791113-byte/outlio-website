import { describe, expect, it } from 'vitest'

import { parseSearchResults } from '@/lib/leads/parse'

describe('parseSearchResults URL mapping', () => {
  it('keeps lead, public profile, company profile, and website URLs separate', () => {
    const html = `
      <ol class="artdeco-list">
        <li class="artdeco-list__item" data-scroll-into-view="urn:li:fs_salesProfile:(ACwAA123,NAME_SEARCH,x)">
          <a href="/sales/lead/ACwAA123,NAME_SEARCH,x"><span data-anonymize="person-name">Ada Example</span></a>
          <a href="/sales/company/456"><span data-anonymize="company-name" data-outlio-company-website="https://example.com/">Example</span></a>
          <span data-anonymize="title">Founder</span>
        </li>
      </ol>`

    const lead = parseSearchResults(html).leads[0]!
    expect(lead.linkedinUrl).toBe('https://www.linkedin.com/in/ACwAA123')
    expect(lead.salesNavUrl).toBe('https://www.linkedin.com/sales/lead/ACwAA123,NAME_SEARCH,x')
    expect(lead.companyUrl).toBe('https://www.linkedin.com/sales/company/456')
    expect(lead.companyWebsiteUrl).toBe('https://example.com/')
  })

  it('prefers an exact public profile URL when LinkedIn exposes one', () => {
    const html = `
      <ol class="artdeco-list">
        <li class="artdeco-list__item">
          <a href="/sales/lead/ACwAA123"><span data-anonymize="person-name">Ada Example</span></a>
          <a href="https://www.linkedin.com/in/ada-example/">Public profile</a>
          <a href="/sales/company/456"><span data-anonymize="company-name">Example</span></a>
        </li>
      </ol>`

    expect(parseSearchResults(html).leads[0]?.linkedinUrl)
      .toBe('https://www.linkedin.com/in/ada-example/')
  })
})

/**
 * The two company URLs must not be swapped.
 *
 * The names invite it. `ParsedLead.companyUrl` is the LinkedIn company page,
 * while `EXPORT_COLUMN_HEADERS.companyUrl` is the header "Company Website URL".
 * Pairing those two — which the worker did — produced a downloaded CSV with a
 * column headed "Company Website URL" full of linkedin.com addresses, and left
 * the real website out of the file entirely.
 */
describe('the export CSV keeps the two company URLs apart', () => {
  it('maps each header to the field its name promises', async () => {
    const { CSV_COLUMNS } = await import('@/lib/worker/process-job')
    const { EXPORT_COLUMN_HEADERS, EXPORT_COLUMN_ORDER } = await import('@/lib/export/leads')

    const lead = {
      fullName: 'Fabricated Person',
      linkedinUrl: 'https://www.linkedin.com/in/fabricated',
      salesNavUrl: 'https://www.linkedin.com/sales/lead/fabricated-1',
      jobTitle: 'Founder',
      companyName: 'Fabricated Systems',
      // The LinkedIn company page…
      companyUrl: 'https://www.linkedin.com/sales/company/456',
      // …and the company's own site. Different things.
      companyWebsiteUrl: 'https://example.com/',
      location: 'London, United Kingdom',
    }

    const byHeader = Object.fromEntries(
      CSV_COLUMNS.map((column) => [column.header, column.value(lead as never)]),
    )

    expect(byHeader[EXPORT_COLUMN_HEADERS.companyLinkedInUrl]).toBe(
      'https://www.linkedin.com/sales/company/456',
    )
    expect(byHeader[EXPORT_COLUMN_HEADERS.companyUrl]).toBe('https://example.com/')

    // And the download has the same columns, in the same order, as a CRM push.
    expect(CSV_COLUMNS.map((column) => column.header)).toEqual([...EXPORT_COLUMN_ORDER])
  })
})
