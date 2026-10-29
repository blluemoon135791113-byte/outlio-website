/**
 * Why enrichment missed, and the three readers that miss less.
 *
 * Pinned:
 *   · a provider's miss reaches `research_tool_calls.error_code` as `MISS_…`,
 *     and only when it found nothing;
 *   · a company site's miss is diagnosed from what each page came to;
 *   · the site reader follows the homepage's own contact link, on-site only;
 *   · contacts in the page chrome and in JSON-LD are collected, while the
 *     readable text a model sees is unchanged;
 *   · an opened result page yields a person's phone only beside their name,
 *     and never a number shared by a table;
 *   · the admin funnel counts outcomes without carrying any lead data.
 *
 * All names, domains and numbers are fabricated.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SearchHit } from '@/lib/hubble/providers/types'
import type { PersonEntity, ResearchTask } from '@/lib/intelligence/types'

vi.mock('server-only', () => ({}))

let hits: SearchHit[] = []
vi.mock('@/lib/search', () => ({
  hasWebSearch: () => true,
  serpSearch: async () => hits,
}))

const pages = new Map<string, { title: string; content: string; emails?: string[] }>()
const opened: string[] = []
vi.mock('@/lib/hubble/fetch/fetcher', () => ({
  needsBrowser: (html: string, chars: number) => chars < 200 && /id=["']root["']/.test(html),
  httpPageFetcher: {
    fetchPage: async (url: string) => {
      opened.push(url)
      const page = pages.get(url)
      if (!page) return { url, code: 'http_error', detail: 'HTTP 404' }
      return {
        url,
        status: 200,
        title: page.title,
        content: page.content,
        method: 'fetch',
        structured: { emails: page.emails ?? [] },
      }
    },
  },
}))

const PERSON: PersonEntity = {
  type: 'person',
  id: '00000000-0000-4000-8000-000000000001',
  fullName: 'Jamie Rivera',
  linkedinUrl: null,
  location: null,
  jobTitle: 'Founder',
  companyName: 'Fabricated Labs',
  companyDomain: 'fabricated.example',
  companyId: '00000000-0000-4000-8000-000000000002',
}

const NAMED: SearchHit = {
  url: 'https://events.example/speakers',
  title: 'Speakers — Jamie Rivera, Founder at Fabricated Labs',
  snippet: 'Jamie Rivera, Founder of Fabricated Labs, joins the panel.',
  publishedDate: null,
}

const emailTask: ResearchTask = { id: 'e', category: 'contact_email', entity: PERSON, fields: ['work_email'] }
const phoneTask: ResearchTask = { id: 'p', category: 'contact_phone', entity: PERSON, fields: ['mobile_phone'] }

beforeEach(async () => {
  hits = []
  pages.clear()
  opened.length = 0
  const { resetOpenedPages } = await import('@/lib/intelligence/providers/search-contact')
  resetOpenedPages()
})

describe('a miss is recorded with its reason', () => {
  it('stores MISS_<reason> on a not_found call, and nothing on a find', async () => {
    const { executeTasks } = await import('@/lib/intelligence/execute')
    const { createRegistry } = await import('@/lib/intelligence/registry')
    const { eraseProviderType, missCode } = await import('@/lib/intelligence/types')

    const missing = eraseProviderType({
      name: 'misses',
      category: 'contact_email',
      canHandle: () => true,
      estimateCost: async () => 0,
      execute: async () => ({ miss: 'not_named' as const }),
      normalize: () => [],
    })
    const report = await executeTasks([emailTask], { registry: createRegistry([missing]) })
    expect(report.toolCalls[0]).toMatchObject({ status: 'not_found', errorCode: missCode('not_named') })
    expect(missCode('not_named')).toBe('MISS_NOT_NAMED')
  })
})

describe('company site diagnosis', () => {
  it('prefers what a read page proves over what a refusing page suggests', async () => {
    const { diagnoseSite } = await import('@/lib/intelligence/providers/company-contact')
    const read = (over: object = {}) => ({
      kind: 'read' as const, url: 'https://fabricated.example/', emails: [], phones: [], jsRendered: false, links: [], ...over,
    })
    expect(diagnoseSite([{ kind: 'unreachable' }])).toBe('site_unreachable')
    expect(diagnoseSite([{ kind: 'refused' }, { kind: 'unreachable' }])).toBe('site_refused')
    expect(diagnoseSite([read({ jsRendered: true }), { kind: 'refused' }])).toBe('site_js_rendered')
    expect(diagnoseSite([read(), { kind: 'refused' }])).toBe('site_no_contact')
    expect(diagnoseSite([read({ emails: ['studio@agency.example'] })])).toBe('site_off_domain_only')
  })
})

describe('which pages the site reader follows', () => {
  it("reads the homepage's own contact link first, on-site only, then fills with guesses", async () => {
    const { followUpPages, FOLLOW_UP_PAGES } = await import('@/lib/intelligence/site-pages')
    const next = followUpPages('www.fabricated.example', [
      { url: 'https://booking.thirdparty.example/fabricated', kind: 'contact' },
      { url: 'https://www.fabricated.example/about#team', kind: 'about' },
      { url: 'https://fabricated.example/get-in-touch', kind: 'contact' },
      { url: 'https://fabricated.example/careers', kind: 'careers' },
    ])
    expect(next).toEqual([
      'https://fabricated.example/get-in-touch',
      'https://www.fabricated.example/about',
      'https://fabricated.example/contact/',
      'https://fabricated.example/contact-us/',
    ])
    expect(next).toHaveLength(FOLLOW_UP_PAGES)
  })

  it('falls back to the guessed paths when the homepage links nothing', async () => {
    const { followUpPages } = await import('@/lib/intelligence/site-pages')
    expect(followUpPages('fabricated.example', [])).toEqual([
      'https://fabricated.example/contact/',
      'https://fabricated.example/contact-us/',
      'https://fabricated.example/about/',
      'https://fabricated.example/about-us/',
    ])
  })
})

describe('contacts in the page chrome and JSON-LD', () => {
  it('collects a footer phone and a declared email without adding them to the text', async () => {
    const { extractReadable } = await import('@/lib/hubble/extract/readable')
    const html = `<html><head><title>Fabricated Labs</title>
      <script type="application/ld+json">{"@type":"Organization","contactPoint":{"@type":"ContactPoint","email":"mailto:hello@fabricated.example"}}</script>
      <script>var build = "0161 496 0999 0161";</script></head>
      <body><main><p>${'We build fabricated things for fabricated customers. '.repeat(12)}</p></main>
      <footer>Fabricated Labs Ltd · Tel 0161 496 0000</footer></body></html>`
    const page = extractReadable(html, 'https://fabricated.example/')
    expect(page.structured.phones).toContain('0161 496 0000')
    expect(page.structured.phones).not.toContain('0161 496 0999 0161')
    expect(page.structured.emails).toContain('hello@fabricated.example')
    expect(page.text).not.toContain('0161 496 0000')
  })
})

describe('opening results that name the person', () => {
  it('finds an email the snippet cut off', async () => {
    hits = [NAMED]
    pages.set(NAMED.url, { title: 'Speakers', content: 'Jamie Rivera — jamie.rivera@fabricated.example', emails: [] })
    const { searchContactEmailProvider } = await import('@/lib/intelligence/providers/search-contact')
    const output = await searchContactEmailProvider.execute(emailTask)
    expect(output).toMatchObject({ value: 'jamie.rivera@fabricated.example', sourceUrl: NAMED.url })
    expect(searchContactEmailProvider.normalize(output, emailTask)[0]).toMatchObject({ field: 'work_email' })
  })

  it('never opens a result that does not identify the person', async () => {
    hits = [{ url: 'https://other.example/', title: 'Something else', snippet: 'Unrelated.', publishedDate: null }]
    const { searchContactEmailProvider } = await import('@/lib/intelligence/providers/search-contact')
    expect(await searchContactEmailProvider.execute(emailTask)).toEqual({ miss: 'not_named' })
    expect(opened).toEqual([])
  })

  it('lets the opened page supply the employer a name-only snippet cut off', async () => {
    const nameOnly: SearchHit = {
      url: 'https://association.example/members',
      title: 'Members — Jamie Rivera',
      snippet: 'Jamie Rivera, Manchester.',
      publishedDate: null,
    }
    hits = [nameOnly]
    pages.set(nameOnly.url, {
      title: 'Members',
      content: 'Jamie Rivera, Founder, Fabricated Labs. jamie@fabricated.example',
    })
    const { searchContactEmailProvider } = await import('@/lib/intelligence/providers/search-contact')
    expect(await searchContactEmailProvider.execute(emailTask)).toMatchObject({ value: 'jamie@fabricated.example' })
  })

  it('still refuses when the opened page does not identify the person either', async () => {
    const nameOnly: SearchHit = { url: 'https://other.example/p', title: 'Jamie Rivera', snippet: 'Jamie Rivera.', publishedDate: null }
    hits = [nameOnly]
    // A namesake: nothing on the page ties this Jamie Rivera to Fabricated Labs.
    pages.set(nameOnly.url, { title: 'Jamie Rivera', content: 'Jamie Rivera plays guitar. Bookings +1 415 555 0132' })
    const { searchContactPhoneProvider } = await import('@/lib/intelligence/providers/search-contact')
    expect(await searchContactPhoneProvider.execute(phoneTask)).toEqual({ miss: 'not_named' })
  })

  it('reports an empty search as empty, not as a person nobody mentions', async () => {
    hits = []
    const { searchContactEmailProvider } = await import('@/lib/intelligence/providers/search-contact')
    expect(await searchContactEmailProvider.execute(emailTask)).toEqual({ miss: 'search_empty' })
  })

  it('reports a partly hidden address as masked, not as a find', async () => {
    hits = [{ ...NAMED, snippet: `${NAMED.snippet} Email: j*****@fabricated.example` }]
    const { searchContactEmailProvider } = await import('@/lib/intelligence/providers/search-contact')
    expect(await searchContactEmailProvider.execute(emailTask)).toEqual({ miss: 'masked_only' })
  })

  it('takes a phone only from beside the name, and not when two numbers are there', async () => {
    const { pagePhoneCandidates } = await import('@/lib/intelligence/providers/search-contact')
    const page = (content: string) => ({ url: NAMED.url, title: 'Team', content })
    const far = `Switchboard +1 415 555 0100. ${'Filler text about the firm. '.repeat(20)} Jamie Rivera, Founder.`
    expect(pagePhoneCandidates(PERSON, page(far), NAMED)).toEqual([])
    expect(pagePhoneCandidates(PERSON, page('Jamie Rivera, Founder — +1 415 555 0132'), NAMED)[0]?.value)
      .toBe('+14155550132')
    expect(pagePhoneCandidates(PERSON, page('Jamie Rivera — +1 415 555 0132 / +1 415 555 0147'), NAMED)).toEqual([])
  })

  it('never reads a name inside a longer one, or the next line of a team list', async () => {
    const { pagePhoneCandidates } = await import('@/lib/intelligence/providers/search-contact')
    const ann: PersonEntity = { ...PERSON, fullName: 'Ann Lee' }
    const page = (content: string) => ({ url: NAMED.url, title: 'Team', content })
    expect(pagePhoneCandidates(ann, page('Joann Lee, Director — +1 415 555 0132'), NAMED)).toEqual([])
    expect(pagePhoneCandidates(PERSON, page('Jamie Rivera, Founder\nSam Ortiz, CTO — +1 415 555 0132'), NAMED)).toEqual([])
  })

  it('judges page identity near the name, not across a whole members list', async () => {
    const { pageIdentity } = await import('@/lib/intelligence/providers/search-contact')
    const { identityAccepted } = await import('@/lib/intelligence/identity')
    const far = `Jamie Rivera, Leeds. ${'Another member, another town. '.repeat(60)} Fabricated Labs sponsors this list.`
    expect(identityAccepted(pageIdentity(PERSON, { url: NAMED.url, title: 'Members', content: far }))).toBe(false)
  })

  it("shares an opened page between a person's email and phone lookups", async () => {
    hits = [NAMED]
    pages.set(NAMED.url, { title: 'Speakers', content: 'Jamie Rivera spoke.' })
    const provider = await import('@/lib/intelligence/providers/search-contact')
    expect(await provider.searchContactEmailProvider.execute(emailTask)).toEqual({ miss: 'named_no_contact' })
    expect(await provider.searchContactPhoneProvider.execute(phoneTask)).toEqual({ miss: 'named_no_contact' })
    expect(opened).toEqual([NAMED.url])
  })
})

describe('the admin funnel', () => {
  it('reads the latest call per entity and labels old misses as unrecorded', async () => {
    const { summarizeJob } = await import('@/lib/admin/enrichment-funnel')
    const call = (entity: string, provider: string, status: string, code: string | null, at: string) => ({
      entity_id: entity, provider, status, error_code: code, created_at: at,
    })
    const funnel = summarizeJob({
      jobId: 'job',
      createdAt: '2026-10-29T00:00:00Z',
      companies: [
        { id: 'c1', hasDomain: false, hasEmail: false, hasPhone: false },
        { id: 'c2', hasDomain: true, hasEmail: false, hasPhone: true },
        { id: 'c3', hasDomain: true, hasEmail: false, hasPhone: false },
        { id: 'c4', hasDomain: true, hasEmail: false, hasPhone: false },
      ],
      people: [
        { id: 'p1', hasEmail: true, hasPhone: false },
        { id: 'p2', hasEmail: false, hasPhone: false },
      ],
      calls: [
        call('c3', 'company-contact', 'timeout', 'ERR_TIMEOUT', '2026-10-29T01:00:00Z'),
        call('c3', 'company-contact', 'not_found', 'MISS_SITE_REFUSED', '2026-10-29T02:00:00Z'),
        call('c4', 'company-contact', 'not_found', null, '2026-10-29T01:00:00Z'),
        call('p2', 'search-contact-email', 'not_found', 'MISS_NOT_NAMED', '2026-10-29T01:00:00Z'),
      ],
    })
    expect(funnel).toMatchObject({ companies: 4, companiesWithWebsite: 3, companyPhones: 1, personEmails: 1 })
    expect(funnel.company).toEqual({ no_website: 1, found: 1, site_refused: 1, unrecorded: 1 })
    expect(funnel.personEmail).toEqual({ found: 1, not_named: 1 })
    expect(funnel.personPhone).toEqual({ not_attempted: 2 })
  })
})

describe('xAI (Grok) provider', () => {
  it('sends a structured-output request to xAI with the key in a header', async () => {
    vi.stubEnv('X_AI_API_KEY', 'test-key')
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { createXaiProvider, DEFAULT_XAI_MODEL } = await import('@/lib/intelligence/llm/provider')
    const result = await createXaiProvider().generateJson({
      system: 'Return JSON.',
      user: 'Plan this.',
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    })
    expect(result).toMatchObject({ ok: true, vendor: 'xai', model: DEFAULT_XAI_MODEL, json: { ok: true } })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://api.x.ai/v1/chat/completions')
    expect(String(url)).not.toContain('test-key')
    expect(JSON.parse(String(init?.body)).response_format.json_schema.strict).toBe(true)
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('is chosen by LLM_PROVIDER=xai and still obeys the allowlist', async () => {
    vi.stubEnv('X_AI_API_KEY', 'test-key')
    const { resolveLlmProvider } = await import('@/lib/intelligence/llm/provider')
    vi.stubEnv('LLM_ALLOWED_VENDORS', 'xai,gemini')
    expect(resolveLlmProvider('xai').vendor).toBe('xai')
    vi.stubEnv('LLM_ALLOWED_VENDORS', 'gemini')
    expect(resolveLlmProvider('xai').vendor).toBe('gemini')
    vi.unstubAllEnvs()
  })
})

describe('review follow-ups', () => {
  it('does not take a bare digit run from the footer as a phone', async () => {
    const { extractReadable } = await import('@/lib/hubble/extract/readable')
    const html = `<html><body><main><p>${'Fabricated content for fabricated readers. '.repeat(12)}</p></main>
      <footer>Order ref 4815162342108 · Call 0161 496 0000</footer></body></html>`
    const phones = extractReadable(html, 'https://fabricated.example/').structured.phones
    expect(phones).toContain('0161 496 0000')
    expect(phones).not.toContain('4815162342108')
  })

  it('keeps xAI out of the default chain unless asked for by name', async () => {
    vi.stubEnv('X_AI_API_KEY', 'test-key')
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('GROQ_API_KEY', '')
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('CEREBRAS_API_KEY', '')
    vi.stubEnv('BACKBOARD_API_KEY', '')
    delete process.env.LLM_ALLOWED_VENDORS
    const { resolveLlmProvider } = await import('@/lib/intelligence/llm/provider')
    expect(resolveLlmProvider(undefined).isConfigured()).toBe(false)
    expect(resolveLlmProvider('xai').vendor).toBe('xai')
    vi.unstubAllEnvs()
  })
})

describe('footer addresses', () => {
  it('does not read a ZIP+4 in a footer address as a phone', async () => {
    const { extractReadable } = await import('@/lib/hubble/extract/readable')
    const html = `<html><body><main><p>${'Fabricated content for fabricated readers. '.repeat(12)}</p></main>
      <footer>1 Fabricated Way, Providence, RI 02908-3700</footer></body></html>`
    expect(extractReadable(html, 'https://fabricated.example/').structured.phones).not.toContain('02908-3700')
  })
})

describe('declared phones without a country code', () => {
  /*
   * A deliberate precision-for-recall trade, recorded so it is not undone by
   * accident: a 9-digit national number in JSON-LD or a footer is dropped,
   * because a ZIP+4 has the same shape. Linked (`tel:`) and body-text numbers
   * are unaffected.
   */
  it('drops a 9-digit JSON-LD number, keeps a linked one', async () => {
    const { extractReadable } = await import('@/lib/hubble/extract/readable')
    const html = `<html><head><script type="application/ld+json">{"@type":"Organization","telephone":"912 345 678"}</script></head>
      <body><main><p>${'Fabricated content for fabricated readers. '.repeat(12)}</p><a href="tel:912345678">Call</a></main></body></html>`
    const phones = extractReadable(html, 'https://fabricated.example/').structured.phones
    expect(phones).not.toContain('912 345 678')
    expect(phones).toContain('912345678')
  })
})
