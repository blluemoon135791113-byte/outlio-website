/**
 * Free search-based domain discovery for the automatic pass.
 *
 * Pinned: it runs only for a company with a name and no domain, and only when
 * a search engine exists; it is free and therefore NOT excluded with paid
 * providers off; it keeps `pickCompanyDomain`'s refusal of a directory or an
 * ambiguous result; and its evidence is filed under its own name at MEDIUM.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CompanyEntity, ResearchTask } from '@/lib/intelligence/types'

vi.mock('server-only', () => ({}))

let hits: Array<{ url: string; title: string | null; snippet: string | null; publishedDate: string | null }> = []
let searchAvailable = true
const queries: string[] = []
/* The page fetcher behind content verification: host → html, or no answer. */
let pages: Record<string, string> = {}
vi.mock('@/lib/intelligence/providers/domain-probe', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/intelligence/providers/domain-probe')>()
  return {
    ...original,
    verifyHostPage: async (host: string, name: string) => {
      const html = pages[host]
      if (!html || !original.verifyPageMentionsCompany(name, html)) return null
      return { domain: host, sourceUrl: `https://${host}/`, html }
    },
  }
})

vi.mock('@/lib/search', () => ({
  hasWebSearch: () => searchAvailable,
  serpSearch: async (query: string) => {
    queries.push(query)
    return hits
  },
}))

const COMPANY: CompanyEntity = {
  type: 'company',
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Fabricated Systems',
  domain: null,
  linkedinUrl: null,
}

const task = (fields: ResearchTask['fields'], entity: CompanyEntity = COMPANY): ResearchTask => ({
  id: `company_profile:company:${entity.id}`,
  category: 'company_profile',
  entity,
  fields,
})

const load = () => import('@/lib/intelligence/providers/domain-discovery')

beforeEach(() => {
  hits = []
  pages = {}
  searchAvailable = true
  queries.length = 0
})

describe('searchDomainDiscoveryProvider', () => {
  it('handles a named company with no domain, only when search exists', async () => {
    const { searchDomainDiscoveryProvider: provider } = await load()
    expect(provider.canHandle(task(['company_domain']))).toBe(true)
    expect(provider.canHandle(task(['company_domain'], { ...COMPANY, domain: 'fabricated.example' }))).toBe(false)
    expect(provider.canHandle(task(['company_domain'], { ...COMPANY, name: null }))).toBe(false)
    expect(provider.canHandle(task(['industry']))).toBe(false)
    searchAvailable = false
    expect(provider.canHandle(task(['company_domain']))).toBe(false)
  })

  it('is free, so the automatic pass keeps it with paid providers off', async () => {
    const { searchDomainDiscoveryProvider: provider } = await load()
    const { PAID_PROVIDERS, buildLiveRegistry } = await import('@/lib/intelligence/providers')
    expect(await provider.estimateCost(task(['company_domain']))).toBe(0)
    expect(PAID_PROVIDERS.has(provider.name)).toBe(false)
    vi.stubEnv('OUTLIO_ALLOW_PAID_PROVIDERS', '')
    const names = buildLiveRegistry().forTask(task(['company_domain'])).map((p) => p.name)
    expect(names).toContain('search-domain-discovery')
    expect(names).not.toContain('tavily-domain-discovery')
    // Before name-guessing, which is slower and weaker evidence.
    expect(names.indexOf('search-domain-discovery')).toBeLessThan(names.indexOf('domain-probe'))
    vi.unstubAllEnvs()
  })

  it("adopts the company's own site and files it under its own name at MEDIUM", async () => {
    hits = [
      { url: 'https://www.linkedin.com/company/fabricated-systems', title: 'Fabricated Systems | LinkedIn', snippet: null, publishedDate: null },
      { url: 'https://fabricatedsystems.com/', title: 'Fabricated Systems — Home', snippet: 'Fabricated Systems builds things.', publishedDate: null },
    ]
    const { searchDomainDiscoveryProvider: provider } = await load()
    const candidate = await provider.execute(task(['company_domain']))

    expect(queries).toEqual(['Fabricated Systems official website'])
    expect(candidate?.domain).toBe('fabricatedsystems.com')
    expect(provider.normalize(candidate, task(['company_domain']))[0]).toMatchObject({
      field: 'company_domain',
      sourceProvider: 'search-domain-discovery',
      sourceConfidence: 'medium',
      value: { domain: 'fabricatedsystems.com' },
    })
  })

  it('refuses directories and look-alikes rather than guessing', async () => {
    hits = [
      { url: 'https://www.crunchbase.com/organization/fabricated-systems', title: 'Fabricated Systems - Crunchbase', snippet: null, publishedDate: null },
      { url: 'https://unrelated.example/', title: 'Something else entirely', snippet: null, publishedDate: null },
    ]
    const { searchDomainDiscoveryProvider: provider } = await load()
    expect(await provider.execute(task(['company_domain']))).toBeNull()
    expect(provider.normalize(null, task(['company_domain']))).toEqual([])
  })
})

describe('content verification when the name-shape picker refuses', () => {
  const brandHits = [
    { url: 'https://quillworks.example/', title: 'Quillworks', snippet: null, publishedDate: null },
    { url: 'https://someblog.example/post', title: 'A post', snippet: null, publishedDate: null },
  ]

  it('accepts the ONE result site that is the company speaking as itself', async () => {
    hits = brandHits
    pages['quillworks.example'] = '<title>Fabricated Systems — Home</title><p>Fabricated Systems builds things.</p>'
    const { searchDomainDiscoveryProvider: provider } = await load()
    const candidate = await provider.execute(task(['company_domain']))
    expect(candidate).toMatchObject({ domain: 'quillworks.example', score: 5, sourceUrl: 'https://quillworks.example/' })
  })

  it('refuses when two result sites verify — ambiguity is not an answer', async () => {
    hits = brandHits
    const page = '<title>Fabricated Systems</title><p>Fabricated Systems</p>'
    pages['quillworks.example'] = page
    pages['someblog.example'] = page
    const { searchDomainDiscoveryProvider: provider } = await load()
    expect(await provider.execute(task(['company_domain']))).toBeNull()
  })

  it("refuses a site that merely MENTIONS the company (a supplier's client list)", async () => {
    hits = brandHits
    pages['quillworks.example'] = '<title>Quillworks — design studio</title><p>Our clients include Fabricated Systems.</p>'
    const { searchDomainDiscoveryProvider: provider } = await load()
    expect(await provider.execute(task(['company_domain']))).toBeNull()
  })
})

describe('presentsAsCompany', () => {
  it('needs the name in the title, or a DISTINCTIVE name word in the domain', async () => {
    const { presentsAsCompany } = await load()
    expect(presentsAsCompany('Fabricated Systems', 'quillworks.example', '<title>Fabricated Systems Ltd</title>')).toBe(true)
    expect(presentsAsCompany('Fabricated Systems', 'getfabricated.example', '<title>Home</title>')).toBe(true)
    // "systems" is generic: a domain containing it says nothing.
    expect(presentsAsCompany('Fabricated Systems', 'bestsystems.example', '<title>Home</title>')).toBe(false)
    expect(presentsAsCompany('Fabricated Systems', 'quillworks.example', '<title>Quillworks</title>')).toBe(false)
  })
})

