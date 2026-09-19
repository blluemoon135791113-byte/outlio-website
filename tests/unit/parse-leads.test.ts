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
    /*
     * ⚠️ THIS ASSERTION USED TO READ
     *   expect(lead.linkedinUrl).toBe('https://www.linkedin.com/in/ACwAA123')
     * and it passed for two milestones while EVERY public profile link in the
     * product was dead.
     *
     * `ACwAA123` is a `fs_salesProfile` urn. `/in/` resolves MEMBER urns
     * (`ACoAAA…`), a different entity type, so the URL addressed nothing. The
     * test only ever checked that the parser did what the parser did — it
     * restated the implementation instead of stating what a user needs, which
     * is a link that opens a profile.
     *
     * The urn is not lost: it is in `salesNavUrl`, in the path it belongs to.
     */
    expect(lead.linkedinUrl).toBeNull()
    expect(lead.salesNavUrl).toBe('https://www.linkedin.com/sales/lead/ACwAA123,NAME_SEARCH,x')
    expect(lead.companyUrl).toBe('https://www.linkedin.com/sales/company/456')
    expect(lead.companyWebsiteUrl).toBe('https://example.com/')
  })

  /*
   * The regression guard, stated as the rule rather than as one example: no
   * Sales Navigator identifier may ever reach the `/in/` path, whichever
   * element it was read from.
   */
  it('never mints a public profile URL out of a Sales Navigator identifier', () => {
    const shapes = [
      // The urn on the scroll attribute, no public anchor anywhere.
      `<li class="artdeco-list__item" data-scroll-into-view="urn:li:fs_salesProfile:(ACwAAURN001,NAME_SEARCH,x)">
         <a href="/sales/lead/ACwAAURN001,NAME_SEARCH,x"><span data-anonymize="person-name">A</span></a>
       </li>`,
      // Only the Sales Navigator href.
      `<li class="artdeco-list__item">
         <a href="/sales/lead/ACwAAURN002,NAME_SEARCH,y"><span data-anonymize="person-name">B</span></a>
       </li>`,
      // A headshot link as the only identity carrier.
      `<li class="artdeco-list__item">
         <span data-anonymize="person-name">C</span>
         <a href="/sales/lead/ACwAAURN003,NAME_SEARCH,z"><span data-anonymize="headshot-photo"></span></a>
       </li>`,
    ]

    for (const shape of shapes) {
      const lead = parseSearchResults(`<ol class="artdeco-list">${shape}</ol>`).leads[0]!
      expect(lead.linkedinUrl).toBeNull()
      // …and the person is still reachable by the address that does resolve.
      expect(lead.salesNavUrl).toContain('/sales/lead/')
    }
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
