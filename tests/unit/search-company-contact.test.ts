/**
 * Company contacts from listings off the company's own site.
 *
 * Pinned: a value is the company's only when it sits beside the company's
 * name, in the same paragraph, as the only value of its kind there; emails
 * never belong to another business; a generic name is not searched; the
 * provider runs only in its own pass; and results that do not name the
 * company are never opened. Every name, domain and number is fabricated.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SearchHit } from '@/lib/hubble/providers/types'
import type { CompanyEntity, ResearchTask } from '@/lib/intelligence/types'

vi.mock('server-only', () => ({}))

let hits: SearchHit[] = []
const queries: string[] = []
vi.mock('@/lib/search', () => ({
  hasWebSearch: () => true,
  serpSearch: async (query: string) => {
    queries.push(query)
    return hits
  },
}))

const pages = new Map<string, string>()
const opened: string[] = []
vi.mock('@/lib/hubble/fetch/fetcher', () => ({
  httpPageFetcher: {
    fetchPage: async (url: string) => {
      opened.push(url)
      const content = pages.get(url)
      return content === undefined
        ? { url, code: 'http_error', detail: 'HTTP 404' }
        : { url, status: 200, title: 'Listing', content, method: 'fetch', structured: {} }
    },
  },
}))

const COMPANY: CompanyEntity = {
  type: 'company',
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Brightwater Joinery Ltd',
  domain: null,
  linkedinUrl: null,
  location: 'Leeds, England',
}

const load = () => import('@/lib/intelligence/providers/search-company-contact')

beforeEach(() => {
  hits = []
  queries.length = 0
  pages.clear()
  opened.length = 0
})

describe('listingFor', () => {
  it('takes the one phone and email beside the company name', async () => {
    const { listingFor } = await load()
    expect(listingFor('Brightwater Joinery — Leeds. Tel +1 415 555 0132 · hello@brightwaterjoinery.example', COMPANY))
      .toEqual({
        phone: '+14155550132',
        email: 'hello@brightwaterjoinery.example',
        // "Leeds" is the company's city: the paragraph is anchored twice.
        phoneAnchored: true,
        emailAnchored: true,
      })
  })

  it("never takes the next listing's number", async () => {
    const { listingFor } = await load()
    const page = 'Brightwater Joinery, Leeds.\n\nOakline Builders, York. Tel +1 415 555 0132'
    expect(listingFor(page, COMPANY).phone).toBeNull()
  })

  it('gives no answer when two numbers sit beside the name', async () => {
    const { listingFor } = await load()
    expect(listingFor('Brightwater Joinery +1 415 555 0132 or +1 415 555 0147', COMPANY).phone).toBeNull()
  })

  it("never files another business's email, and keeps to the domain when known", async () => {
    const { listingFor } = await load()
    expect(listingFor('Brightwater Joinery — site by studio@webagency.example', COMPANY).email).toBeNull()
    expect(listingFor('Brightwater Joinery — brightwaterjoinery@gmail.com', COMPANY).email)
      .toBe('brightwaterjoinery@gmail.com')
    const known = { ...COMPANY, domain: 'brightwater.example' }
    expect(listingFor('Brightwater Joinery — info@brightwater.example', known).email).toBe('info@brightwater.example')
    expect(listingFor('Brightwater Joinery — owner@gmail.com', known).email).toBeNull()
  })

  it('ignores a bare digit run and a name inside a longer word', async () => {
    const { listingFor } = await load()
    expect(listingFor('Brightwater Joinery ref 4815162342108', COMPANY).phone).toBeNull()
    expect(listingFor('NotBrightwater Joinery +1 415 555 0132', COMPANY).phone).toBeNull()
  })
})

describe('searchCompanyContactProvider', () => {
  const task = async (company = COMPANY): Promise<ResearchTask> =>
    (await load()).externalContactTask(company, ['company_contact_email', 'company_contact_phone'])

  it('runs only in its own pass', async () => {
    const { searchCompanyContactProvider } = await load()
    expect(searchCompanyContactProvider.canHandle(await task())).toBe(true)
    expect(searchCompanyContactProvider.canHandle({
      id: `company_profile:company:${COMPANY.id}`,
      category: 'company_profile',
      entity: COMPANY,
      fields: ['company_contact_phone'],
    })).toBe(false)
  })

  it('searches by name and city, reads a listing that names the company, and cites it', async () => {
    hits = [{ url: 'https://directory.example/leeds/brightwater', title: 'Brightwater Joinery — Leeds', snippet: 'Joiners in Leeds.', publishedDate: null }]
    pages.set(hits[0]!.url, 'Brightwater Joinery\nUnit 4, Leeds\nTel +1 415 555 0132')
    const { searchCompanyContactProvider } = await load()
    const t = await task()
    const output = await searchCompanyContactProvider.execute(t)
    expect(queries[0]).toBe('"Brightwater Joinery Ltd" Leeds contact phone email')
    const [phone] = searchCompanyContactProvider.normalize(output, t)
    expect(phone).toMatchObject({
      field: 'company_contact_phone',
      sourceProvider: 'search-company-contact',
      sourceConfidence: 'medium',
      sourceUrl: hits[0]!.url,
      value: { phone: '+14155550132', status: 'publicly_found' },
    })
  })

  it('never opens a result that does not name the company', async () => {
    hits = [{ url: 'https://other.example/', title: 'Joiners near you', snippet: 'Find a joiner.', publishedDate: null }]
    const { searchCompanyContactProvider } = await load()
    expect(await searchCompanyContactProvider.execute(await task())).toEqual({ miss: 'company_not_listed' })
    expect(opened).toEqual([])
  })

  it('does not search a name that names nobody in particular', async () => {
    const { searchCompanyContactProvider } = await load()
    expect(await searchCompanyContactProvider.execute(await task({ ...COMPANY, name: 'Global Solutions Ltd' })))
      .toEqual({ miss: 'name_ambiguous' })
    expect(queries).toEqual([])
  })

  it('reports a listing with no contact as such', async () => {
    hits = [{ url: 'https://directory.example/b', title: 'Brightwater Joinery', snippet: 'Joiners.', publishedDate: null }]
    pages.set(hits[0]!.url, 'Brightwater Joinery makes doors.')
    const { searchCompanyContactProvider } = await load()
    expect(await searchCompanyContactProvider.execute(await task())).toEqual({ miss: 'listed_no_contact' })
  })
})

describe('what is not a contact (measured on live listings)', () => {
  it('rejects a ZIP+4, keeps the bracket on a US number, and refuses a format placeholder', async () => {
    const { listingFor, publicPhone } = await load()
    expect(publicPhone('02908-3700')).toBeNull()
    expect(listingFor('Brightwater Joinery, Providence RI 02908-3700', COMPANY).phone).toBeNull()
    expect(listingFor('Brightwater Joinery — call (415) 555-0132', COMPANY).phone).toBe('(415) 555-0132')
    const known = { ...COMPANY, domain: 'brightwater.example' }
    expect(listingFor('Brightwater Joinery email format: first.last@brightwater.example', known).email).toBeNull()
    expect(listingFor('Brightwater Joinery — filast@brightwater.example', known).email).toBeNull()
    expect(listingFor('Brightwater Joinery — lastfir@brightwater.example', known).email).toBeNull()
    expect(listingFor('Brightwater Joinery — sales@brightwater.example', known).email).toBe('sales@brightwater.example')
  })
})

describe('only pages about the company count', () => {
  it("ignores another vendor's page that merely mentions the company", async () => {
    const { aboutCompany } = await load()
    const company = { name: 'Brightwater Joinery', domain: 'brightwater.example' }
    expect(aboutCompany({ url: 'https://rivalbuilders.example/compare', title: 'Rival Builders vs the rest' }, company)).toBe(false)
    expect(aboutCompany({ url: 'https://rivalbuilders.example/x', title: 'Rival Builders vs Brightwater Joinery' }, company)).toBe(false)
    expect(aboutCompany({ url: 'https://brightwater.co/x', title: 'Home' }, { name: 'Brightwater Health Plans', domain: null })).toBe(true)
    expect(aboutCompany({ url: 'https://directory.example/x', title: 'Brightwater Joinery — Leeds' }, company)).toBe(true)
    expect(aboutCompany({ url: 'https://www.brightwater.example/contact', title: 'Contact' }, company)).toBe(true)
  })

  it('rejects an ID that opens with a long digit block', async () => {
    const { publicPhone } = await load()
    expect(publicPhone('86830610-720')).toBeNull()
    expect(publicPhone('(415) 555-0132')).toBe('(415) 555-0132')
  })
})

describe("a host's own banner", () => {
  it('does not pair a name in the title with a number in the snippet', async () => {
    hits = [{
      url: 'https://bigvendor.example/integrations/brightwater',
      title: 'Brightwater Joinery | BigVendor',
      snippet: 'Skip to main content. Questions? Contact us: +1 415 555 0132',
      publishedDate: null,
    }]
    const { searchCompanyContactProvider, externalContactTask } = await load()
    const out = await searchCompanyContactProvider.execute(externalContactTask(COMPANY, ['company_contact_phone']))
    expect(out).toEqual({ miss: 'listed_no_contact' })
  })
})

describe("the source site's own number", () => {
  it('is not the listed company\'s', async () => {
    const { listingFor } = await load()
    const text = 'Brightwater Joinery integration. Questions about BigVendor? Contact us: +1 415 555 0132'
    expect(listingFor(text, COMPANY, 'https://www.bigvendor.example/integrations/brightwater').phone).toBeNull()
    expect(listingFor('Brightwater Joinery, Leeds. Tel +1 415 555 0132', COMPANY, 'https://www.bigvendor.example/x').phone)
      .toBe('+14155550132')
  })
})

describe('corroboration', () => {
  it('needs a second site, or the city or domain, before trusting a third-party page', async () => {
    const one = { url: 'https://listings.example/a', title: 'Brightwater Joinery', snippet: 'Brightwater Joinery. Tel +1 415 555 0132', publishedDate: null }
    const { searchCompanyContactProvider, externalContactTask } = await load()
    const noCity = { ...COMPANY, location: null }
    hits = [one]
    expect(await searchCompanyContactProvider.execute(externalContactTask(noCity, ['company_contact_phone'])))
      .toEqual({ miss: 'listed_no_contact' })
    hits = [one, { ...one, url: 'https://other-listings.example/b' }]
    expect(await searchCompanyContactProvider.execute(externalContactTask(noCity, ['company_contact_phone'])))
      .toMatchObject({ phone: { value: '+14155550132', hosts: 2 } })
  })
})

describe('anchors are whole words', () => {
  it('does not take "Reno" from "Renovation"', async () => {
    const { listingFor } = await load()
    const reno = { ...COMPANY, location: 'Reno, NV' }
    expect(listingFor('Brightwater Joinery renovation services, +1 415 555 0132', reno).phoneAnchored).toBe(false)
    expect(listingFor('Brightwater Joinery, Reno NV, +1 415 555 0132', reno).phoneAnchored).toBe(true)
  })
})
