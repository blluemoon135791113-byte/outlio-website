/**
 * Visibility, the people-search block, and contact verification.
 *
 * Pinned:
 *   · consumer people-search sites are never a contact source;
 *   · a search records each engine's part and never its query text;
 *   · a page visit records host, kind and outcome — nothing else;
 *   · an email on a domain with no mail server, or a number that is not real
 *     for its country, is dropped, and its status companion with it;
 *   · a kept contact carries its verification and its status says what was
 *     checked; the value itself is never altered.
 *
 * All data fabricated: example domains, 555-01xx and Ofcom-reserved numbers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SearchHit, SearchProvider } from '@/lib/hubble/providers/types'
import type { NormalizedEvidence } from '@/lib/intelligence/types'

vi.mock('server-only', () => ({}))

const inserts: Array<{ table: string; rows: unknown[] }> = []
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: async (rows: unknown[]) => {
        inserts.push({ table, rows })
        return { error: null }
      },
    }),
  }),
}))
vi.mock('@/lib/intelligence/provider-state', () => ({
  readProviderCache: async () => null,
  writeProviderCache: async () => undefined,
}))
vi.mock('@/lib/search/budget', () => ({ reserveSearch: async () => ({ allowed: true }) }))

beforeEach(() => {
  inserts.length = 0
})

describe('people-search sites', () => {
  it('are recognised by host or URL, subdomains included; contact directories are not', async () => {
    const { isPeopleSearchSource } = await import('@/lib/intelligence/source-policy')
    expect(isPeopleSearchSource('https://www.spokeo.com/Jamie-Rivera')).toBe(true)
    expect(isPeopleSearchSource('people.whitepages.com')).toBe(true)
    expect(isPeopleSearchSource('https://contactout.com/x')).toBe(false)
    expect(isPeopleSearchSource('https://notspokeo.com/')).toBe(false)
  })
})

describe('the visit and search log', () => {
  it('describes a query by its shape, never its words', async () => {
    const { queryShape } = await import('@/lib/intelligence/observe')
    expect(queryShape('"@fabricated.example" "Jamie Rivera"')).toEqual({ words: 3, quoted: true, operators: ['at_domain'] })
    expect(JSON.stringify(queryShape('site:fabricated.example Jamie'))).not.toContain('Jamie')
  })

  it('names a page by its path', async () => {
    const { pageKindOf } = await import('@/lib/intelligence/observe')
    expect(pageKindOf('https://fabricated.example/')).toBe('home')
    expect(pageKindOf('https://fabricated.example/get-in-touch')).toBe('contact')
    expect(pageKindOf('https://fabricated.example/our-team/')).toBe('team')
    expect(pageKindOf('https://fabricated.example/blog/post', 'search_result')).toBe('search_result')
  })

  it('maps fetch results to outcomes', async () => {
    const { fetchOutcome } = await import('@/lib/intelligence/observe')
    expect(fetchOutcome({ url: 'u', code: 'http_error', detail: 'HTTP 403' })).toEqual({ outcome: 'refused', httpStatus: 403 })
    expect(fetchOutcome({ url: 'u', code: 'empty', detail: 'content is JavaScript-rendered' }).outcome).toBe('js_rendered')
    expect(fetchOutcome({ url: 'u', code: 'blocked', detail: 'people-search site' }).outcome).toBe('blocked')
    // A page that does not exist, and a name that does not resolve, are not policy refusals.
    expect(fetchOutcome({ url: 'u', code: 'http_error', detail: 'HTTP 404' })).toEqual({ outcome: 'not_found', httpStatus: 404 })
    expect(fetchOutcome({ url: 'u', code: 'blocked', detail: 'gone.example does not resolve' }).outcome).toBe('unreachable')
    expect(fetchOutcome({ url: 'u', status: 200, title: null, content: 'x', method: 'fetch', structured: { emails: ['a@fabricated.example'] } }).outcome)
      .toBe('read_contact')
  })

  it("records what each engine did inside a run, and writes once when it ends", async () => {
    const { SerpService, resetSearchCircuitBreaker } = await import('@/lib/search/serp')
    const { withRunObservation } = await import('@/lib/intelligence/observe')
    resetSearchCircuitBreaker()
    const engine = (name: string, hits: SearchHit[]): SearchProvider => ({
      name, isConfigured: () => true, search: async () => hits,
    })
    const serp = new SerpService([
      engine('first', []),
      engine('second', [{ url: 'https://fabricated.example/', title: null, snippet: null, publishedDate: null }]),
    ], { cache: false })

    await withRunObservation('user', 'run', async () => {
      await serp.run('Jamie Rivera Fabricated Labs email', { purpose: 'contact_email' })
    })

    const searches = inserts.find((entry) => entry.table === 'enrichment_searches')?.rows as Array<Record<string, unknown>>
    expect(searches).toHaveLength(1)
    expect(searches[0]).toMatchObject({
      purpose: 'contact_email', hits: 1, cached: false,
      engines: [{ engine: 'first', outcome: 'empty', hits: 0 }, { engine: 'second', outcome: 'hits', hits: 1 }],
    })
    expect(JSON.stringify(searches)).not.toContain('Jamie')
  })

  it('records nothing outside a run', async () => {
    const { recordPageVisit } = await import('@/lib/intelligence/observe')
    recordPageVisit({ provider: 'x', host: 'fabricated.example', pageKind: 'home', outcome: 'read_empty' })
    expect(inserts).toEqual([])
  })
})

describe('email verification', () => {
  beforeEach(async () => (await import('@/lib/intelligence/verify-contact')).resetMailCache())

  it('keeps a mail-server domain, drops a dead one, and says why', async () => {
    const { checkEmail } = await import('@/lib/intelligence/verify-contact')
    const lookup = (answer: 'mx' | 'a_only' | 'none' | 'nxdomain' | 'error') => async () => answer
    expect((await checkEmail('jamie@mx.example', { lookup: lookup('mx') })).status).toBe('mail_server_verified')
    expect((await checkEmail('jamie@a.example', { lookup: lookup('a_only') })).status).toBe('mail_domain_only')
    expect((await checkEmail('jamie@none.example', { lookup: lookup('none') })).status).toBe('no_mail_server')
    expect((await checkEmail('jamie@gone.example', { lookup: lookup('nxdomain') })).status).toBe('domain_not_found')
    // Our DNS failing is not the address failing.
    expect((await checkEmail('jamie@flaky.example', { lookup: lookup('error') })).status).toBe('unverified')
    expect((await checkEmail('jamie@mailinator.com', { lookup: lookup('mx') })).status).toBe('disposable')
    expect((await checkEmail('not an address', { lookup: lookup('mx') })).status).toBe('invalid_syntax')
  })

  it('uses the mailbox probe when there is one, and trusts no accept-all server', async () => {
    const { checkEmail } = await import('@/lib/intelligence/verify-contact')
    const lookup = async () => 'mx' as const
    expect((await checkEmail('a@p.example', { lookup, mailbox: async () => ({ probed: true, exists: true, acceptAll: false }) })).status).toBe('mailbox_verified')
    // A refusal is often an anti-probe policy, not a dead mailbox: the DNS verdict stands.
    expect((await checkEmail('b@p.example', { lookup, mailbox: async () => ({ probed: true, exists: false, acceptAll: false }) })).status).toBe('mail_server_verified')
    expect((await checkEmail('c@p.example', { lookup, mailbox: async () => ({ probed: true, exists: true, acceptAll: true }) })).status).toBe('accept_all')
  })
})

describe('phone verification', () => {
  it('tells mobiles, landlines and toll-free apart, and refuses only a +number that is not real', async () => {
    const { checkPhone, regionFromLocation } = await import('@/lib/intelligence/verify-contact')
    expect(checkPhone('+447911123456', null).status).toBe('valid_mobile')
    expect(checkPhone('020 7946 0958', regionFromLocation('London, England, United Kingdom')).status).toBe('valid_landline')
    expect(checkPhone('+18005550199', null).status).toBe('valid_toll_free')
    expect(checkPhone('+44 7700 900123', null).status).toBe('invalid')
    // National format: judged against a GUESSED country, so never dropped — kept unchecked.
    expect(checkPhone('02908-3700', 'US').status).toBe('unverified')
    expect(checkPhone('020 7946 0958', null).status).toBe('unverified')
  })

  it('reads the country from a Sales Navigator location', async () => {
    const { regionFromLocation } = await import('@/lib/intelligence/verify-contact')
    expect(regionFromLocation('Rotterdam, South Holland, Netherlands')).toBe('NL')
    expect(regionFromLocation('Fort Wayne, Indiana, United States')).toBe('US')
    // Country names only: no state code or city is mistaken for a country.
    expect(regionFromLocation('London, Ontario, Canada')).toBe('CA')
    expect(regionFromLocation('Berlin, DE')).toBeNull()
    expect(regionFromLocation('Mars')).toBeNull()
  })

  it('reads US metros and states that Sales Navigator writes without a country', async () => {
    const { regionFromLocation } = await import('@/lib/intelligence/verify-contact')
    expect(regionFromLocation('Greater Phoenix Area')).toBe('US')
    expect(regionFromLocation('San Francisco Bay Area')).toBe('US')
    expect(regionFromLocation('Detroit Metropolitan Area')).toBe('US')
    expect(regionFromLocation('Greater Minneapolis-St. Paul Area')).toBe('US')
    expect(regionFromLocation('Portland, Oregon Metropolitan Area')).toBe('US')
    expect(regionFromLocation('Dallas-Fort Worth Metroplex')).toBe('US')
    expect(regionFromLocation('Washington DC-Baltimore Area')).toBe('US')
    expect(regionFromLocation('Greater Boston')).toBe('US')
    expect(regionFromLocation('New Mexico')).toBe('US')
    expect(regionFromLocation('Vienna, Vienna, Austria')).toBe('AT')
    // A city outside metro phrasing is not a place; a country always wins.
    expect(regionFromLocation('Phoenix')).toBeNull()
    expect(regionFromLocation('Washington, England, United Kingdom')).toBe('GB')
    expect(regionFromLocation('Richmond, British Columbia, Canada')).toBe('CA')
    // Metros that share a name abroad are not guessed.
    expect(regionFromLocation('Greater Manchester')).toBeNull()
    expect(regionFromLocation('Greater Melbourne Area')).toBeNull()
    expect(regionFromLocation('Greater Paris Metropolitan Region')).toBeNull()
    expect(regionFromLocation('Tbilisi, Georgia')).toBeNull()
    expect(regionFromLocation('Mexico City Metropolitan Area')).toBe('MX')
  })
})

describe('verifying evidence', () => {
  const base = { sourceConfidence: 'medium' as const, confidence: 0.7, retrievedAt: '2026-11-01T00:00:00Z', expiresAt: null }
  const ev = (field: string, entityId: string, value: Record<string, unknown>, sourceUrl = 'https://fabricated.example/team'): NormalizedEvidence =>
    ({ ...base, field, entityId, entityType: field.startsWith('company') ? 'company' : 'person', sourceProvider: 'test', sourceUrl, value }) as NormalizedEvidence

  it('drops a dead email with its status, keeps the rest with what was checked', async () => {
    const { verifyContactEvidence, resetMailCache } = await import('@/lib/intelligence/verify-contact')
    resetMailCache()
    const lookup = async (domain: string) => (domain === 'gone.example' ? 'nxdomain' as const : 'mx' as const)
    const { kept, dropped } = await verifyContactEvidence([
      ev('work_email', 'p1', { email: 'jamie@gone.example' }),
      ev('email_status', 'p1', { status: 'publicly_found' }),
      ev('work_email', 'p2', { email: 'sam@live.example' }),
      ev('email_status', 'p2', { status: 'publicly_found' }),
      ev('company_contact_phone', 'c1', { phone: '+447911123456', status: 'publicly_found' }),
      ev('mobile_phone', 'p3', { phone: '+1 415 555 0132' }, 'https://www.spokeo.com/x'),
      ev('company_domain', 'c1', { domain: 'live.example' }),
    ], new Map(), { lookup })

    expect(dropped).toEqual({ domain_not_found: 1, people_search_source: 1 })
    expect(kept.map((item) => `${item.entityId}:${item.field}`)).toEqual([
      'p2:work_email', 'p2:email_status', 'c1:company_contact_phone', 'c1:company_domain',
    ])
    const status = kept.find((item) => item.field === 'email_status')!.value as Record<string, unknown>
    expect(status).toMatchObject({ status: 'mail_server_verified', foundAs: 'publicly_found' })
    const phone = kept.find((item) => item.field === 'company_contact_phone')!.value as Record<string, unknown>
    expect(phone).toMatchObject({ phone: '+447911123456', status: 'valid_mobile' })
    // The address is stored exactly as found.
    expect((kept[0]!.value as Record<string, unknown>).email).toBe('sam@live.example')
  })
})

describe('two contacts for one person', () => {
  it('keeps the status when one of them survives', async () => {
    const { verifyContactEvidence, resetMailCache } = await import('@/lib/intelligence/verify-contact')
    resetMailCache()
    const lookup = async (domain: string) => (domain === 'gone.example' ? 'nxdomain' as const : 'mx' as const)
    const item = (field: string, value: Record<string, unknown>) =>
      ({ field, entityId: 'p1', entityType: 'person', sourceProvider: 'test', sourceUrl: 'https://fabricated.example/', sourceConfidence: 'medium', confidence: 0.7, retrievedAt: '2026-11-01T00:00:00Z', expiresAt: null, value }) as NormalizedEvidence
    const { kept } = await verifyContactEvidence([
      item('work_email', { email: 'jamie@live.example' }),
      item('email_status', { status: 'publicly_found' }),
      item('work_email', { email: 'jamie@gone.example' }),
      item('email_status', { status: 'publicly_found' }),
    ], new Map(), { lookup })
    expect(kept.map((entry) => entry.field)).toEqual(['work_email', 'email_status', 'email_status'])
    expect(kept.filter((entry) => entry.field === 'email_status').every((entry) => (entry.value as { status: string }).status === 'mail_server_verified')).toBe(true)
  })
})

describe('the admin summary', () => {
  it('groups visits by outcome, provider and site, and searches by purpose and engine', async () => {
    const { summariseVisits, summariseSearches } = await import('@/lib/admin/enrichment-sites')
    const visits = summariseVisits([
      { host: 'a.example', provider: 'company-contact', outcome: 'read_contact' },
      { host: 'a.example', provider: 'company-contact', outcome: 'read_empty' },
      { host: 'b.example', provider: 'search-contact', outcome: 'refused' },
    ])
    expect(visits.byOutcome).toEqual({ read_contact: 1, read_empty: 1, refused: 1 })
    expect(visits.topSites[0]).toMatchObject({ host: 'a.example', visits: 2 })
    expect(visits.refusingSites.map((site) => site.host)).toEqual(['b.example'])

    const searches = summariseSearches([
      { purpose: 'contact_email', hits: 0, cached: false, engines: [{ engine: 'diffbot', outcome: 'empty' }, { engine: 'youcom', outcome: 'over_budget' }] },
      { purpose: 'contact_email', hits: 3, cached: true, engines: [] },
    ])
    expect(searches[0]).toMatchObject({ purpose: 'contact_email', searches: 2, empty: 1, cached: 1, engines: { diffbot: { empty: 1 }, youcom: { over_budget: 1 } } })
  })
})
