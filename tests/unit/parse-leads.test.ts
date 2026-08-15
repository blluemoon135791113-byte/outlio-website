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
