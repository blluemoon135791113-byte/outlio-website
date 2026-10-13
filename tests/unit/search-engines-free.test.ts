/**
 * The free-tier search engines: Diffbot, You.com (keyless), Exa.
 *
 * Pinned: each sends its credential the documented way and never in the URL;
 * each maps its own response shape onto `SearchHit`; a failure or malformed
 * payload is an empty list, never a throw; an unconfigured engine makes no
 * request; and the budgets keep each inside its free allowance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Sent = { url: string; method?: string; headers?: Record<string, string>; body?: unknown; maxRetries?: number; timeoutMs?: number }
let sent: Sent[] = []
let reply: unknown = {}
let fail = false

vi.mock('@/lib/intelligence/http', () => ({
  setHostPacing: () => {},
  requestText: async () => '',
  requestJson: async (request: Sent) => {
    sent.push(request)
    if (fail) throw new Error('upstream refused')
    return reply
  },
}))

beforeEach(() => {
  sent = []
  reply = {}
  fail = false
  vi.stubEnv('DIFFBOT_API_KEY', 'diffbot-token')
  vi.stubEnv('EXA_API_KEY', 'exa-key')
  vi.stubEnv('SERP_YOUCOM', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const engines = () => import('@/lib/search/engines')

describe('DiffbotSearchProvider', () => {
  it('sends a Bearer token in a header and maps pageUrl/content', async () => {
    reply = {
      search_results: [
        { pageUrl: 'https://fabricated.example/contact', title: ' Contact ', content: 'Email hello@fabricated.example', date: 'Mon, 15 Jun 2026 16:32:36 GMT' },
        { title: 'no url — dropped' },
      ],
    }
    const { DiffbotSearchProvider } = await engines()
    const hits = await new DiffbotSearchProvider().search('Fabricated Labs contact', 5)

    expect(hits).toEqual([{
      url: 'https://fabricated.example/contact',
      title: 'Contact',
      snippet: 'Email hello@fabricated.example',
      publishedDate: 'Mon, 15 Jun 2026 16:32:36 GMT',
    }])
    expect(sent[0]!.headers!.authorization).toBe('Bearer diffbot-token')
    expect(sent[0]!.url).not.toContain('diffbot-token')
    const url = new URL(sent[0]!.url)
    expect(url.searchParams.get('text')).toBe('Fabricated Labs contact')
    expect(url.searchParams.get('size')).toBe('5')
  })

  it('expresses a time range as an after: operator', async () => {
    const { DiffbotSearchProvider } = await engines()
    await new DiffbotSearchProvider().search('acme funding', 5, { timeRange: 'week' })
    expect(new URL(sent[0]!.url).searchParams.get('text')).toMatch(/^acme funding after:\d{4}-\d{2}-\d{2}$/)
  })

  it('is off without a token and makes no request', async () => {
    vi.stubEnv('DIFFBOT_API_KEY', '')
    const { DiffbotSearchProvider } = await engines()
    const provider = new DiffbotSearchProvider()
    expect(provider.isConfigured()).toBe(false)
    await expect(provider.search('x', 5)).resolves.toEqual([])
    expect(sent).toHaveLength(0)
  })
})

describe('YouComSearchProvider', () => {
  it('is keyless, never retries a throttle, and joins description with snippets', async () => {
    reply = {
      results: {
        web: [{ url: 'https://fabricated.example/team', title: 'Team', description: 'Our people.', snippets: ['Call +44 20 0000 0000', 7] }],
      },
    }
    const { YouComSearchProvider } = await engines()
    const hits = await new YouComSearchProvider().search('Fabricated Labs team', 3)

    expect(hits).toEqual([{
      url: 'https://fabricated.example/team',
      title: 'Team',
      snippet: 'Our people. Call +44 20 0000 0000',
      publishedDate: null,
    }])
    expect(sent[0]!.headers).not.toHaveProperty('authorization')
    expect(sent[0]!.maxRetries).toBe(0)
    expect(sent[0]!.timeoutMs).toBe(6_000)
  })

  it('can be switched off', async () => {
    vi.stubEnv('SERP_YOUCOM', 'off')
    const { YouComSearchProvider } = await engines()
    expect(new YouComSearchProvider().isConfigured()).toBe(false)
  })
})

describe('ExaSearchProvider', () => {
  it('POSTs with the key in a header, asks for highlights, and caps at 10 results', async () => {
    reply = {
      results: [{ url: 'https://fabricated.example/about', title: 'About', highlights: ['Founded 2019.', 'Based in London.'], publishedDate: '2026-01-02' }],
    }
    const { ExaSearchProvider } = await engines()
    const hits = await new ExaSearchProvider().search('Fabricated Labs', 20)

    expect(hits[0]).toEqual({
      url: 'https://fabricated.example/about',
      title: 'About',
      snippet: 'Founded 2019. Based in London.',
      publishedDate: '2026-01-02',
    })
    expect(sent[0]!.method).toBe('POST')
    expect(sent[0]!.headers!['x-api-key']).toBe('exa-key')
    expect(sent[0]!.body).toMatchObject({ numResults: 10, contents: { highlights: { numSentences: 2 } } })
  })
})

describe('every free engine degrades to nothing, never a throw', () => {
  it('on an upstream failure or a malformed payload', async () => {
    const { DiffbotSearchProvider, YouComSearchProvider, ExaSearchProvider } = await engines()
    const providers = [new DiffbotSearchProvider(), new YouComSearchProvider(), new ExaSearchProvider()]

    fail = true
    for (const provider of providers) await expect(provider.search('q', 5)).resolves.toEqual([])

    fail = false
    reply = { search_results: 'nope', results: 'nope' }
    for (const provider of providers) await expect(provider.search('q', 5)).resolves.toEqual([])
  })
})

describe('budgets keep each engine inside its free allowance', () => {
  it('matches each published free tier', async () => {
    const { budgetFor } = await import('@/lib/search/budget')
    expect(budgetFor('diffbot')).toEqual({ perDay: 3_200, metered: false })
    expect(budgetFor('youcom')).toEqual({ perDay: 100, metered: false })
    expect(budgetFor('exa')).toEqual({ perDay: 45, metered: true })
    expect(budgetFor('tavily')).toEqual({ perDay: 30, metered: true })
  })
})
