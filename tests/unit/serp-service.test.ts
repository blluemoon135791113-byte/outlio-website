import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  bareDomain,
  canonicalQuery,
  dedupeQueries,
  filterHits,
  hostOf,
  matchesDomain,
  mergeHits,
  normalizeQuery,
  rankHits,
  searchCacheKey,
} from '@/lib/search/query'
import { SerpService, resetSearchCircuitBreaker } from '@/lib/search/serp'
import type { SearchHit, SearchProvider } from '@/lib/hubble/providers/types'

function hit(url: string, title = ''): SearchHit {
  return { url, title: title || null, snippet: null, publishedDate: null }
}

/** An engine that records what it was asked, and answers from a script. */
function fakeEngine(
  name: string,
  answer: (query: string) => SearchHit[],
): SearchProvider & { calls: string[] } {
  const calls: string[] = []
  return {
    name,
    calls,
    isConfigured: () => true,
    async search(query: string) {
      calls.push(query)
      return answer(query)
    },
  }
}

/** Cache off: these tests are about ordering and dedupe, not Postgres. */
function service(engines: SearchProvider[]): SerpService {
  return new SerpService(engines, { cache: false })
}

describe('query shaping (pure)', () => {
  beforeEach(resetSearchCircuitBreaker)

  it('collapses whitespace without changing the query otherwise', () => {
    expect(normalizeQuery('  "Ada Lovelace"   acme.com   email ')).toBe('"Ada Lovelace" acme.com email')
  })

  it('keys the cache case-insensitively, because engines are', () => {
    expect(searchCacheKey('Acme Corp funding', 10)).toBe(searchCacheKey('acme corp   funding', 10))
  })

  it('keeps operators significant in the cache key', () => {
    // `site:` changes the result set. Collapsing it into the plain query would
    // serve a whole-web answer to a caller that asked only about one domain.
    expect(canonicalQuery('site:acme.com ada')).not.toBe(canonicalQuery('acme.com ada'))
  })

  it('does not let limit or time range collide', () => {
    expect(searchCacheKey('acme', 10)).not.toBe(searchCacheKey('acme', 20))
    expect(searchCacheKey('acme', 10)).not.toBe(searchCacheKey('acme', 10, 'month'))
  })

  it('deduplicates phrasings, first spelling winning', () => {
    expect(dedupeQueries(['Acme email', 'acme   email', '', 'Acme phone'])).toEqual([
      'Acme email',
      'Acme phone',
    ])
  })

  it('reads hosts and strips www', () => {
    expect(hostOf('https://www.Acme.com/contact')).toBe('acme.com')
    expect(hostOf('not a url')).toBe('')
    expect(bareDomain('HTTPS://www.acme.com/x')).toBe('acme.com')
  })

  it('matches subdomains but never a lookalike host', () => {
    expect(matchesDomain('careers.acme.com', 'acme.com')).toBe(true)
    expect(matchesDomain('acme.com', 'acme.com')).toBe(true)
    // ⚠️ The bug this exists to prevent: `notacme.com` ends with `acme.com`.
    expect(matchesDomain('notacme.com', 'acme.com')).toBe(false)
  })

  it('filters by allow and block lists', () => {
    const hits = [hit('https://acme.com/a'), hit('https://spam.example/b'), hit('https://blog.acme.com/c')]
    expect(filterHits(hits, { allowDomains: ['acme.com'] }).map((entry) => entry.url)).toEqual([
      'https://acme.com/a',
      'https://blog.acme.com/c',
    ])
    expect(filterHits(hits, { blockDomains: ['spam.example'] })).toHaveLength(2)
  })

  it('ranks preferred domains first and is otherwise stable', () => {
    const hits = [hit('https://directory.example/1'), hit('https://acme.com/2'), hit('https://other.example/3')]
    expect(rankHits(hits, ['acme.com']).map((entry) => entry.url)).toEqual([
      'https://acme.com/2',
      'https://directory.example/1',
      'https://other.example/3',
    ])
  })

  it('merges result sets by URL, so one page is never counted as two sources', () => {
    const merged = mergeHits([hit('https://a.example', 'first')], [hit('https://a.example', 'second')])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.title).toBe('first')
  })
})

describe('SerpService waterfall', () => {
  beforeEach(resetSearchCircuitBreaker)

  it('returns the first engine that answers and never asks the rest', async () => {
    const first = fakeEngine('solr', () => [])
    const second = fakeEngine('web-research-mcp', () => [hit('https://a.example')])
    const third = fakeEngine('tavily', () => [hit('https://never.example')])

    const hits = await service([first, second, third]).search('acme funding', 5)

    expect(hits.map((entry) => entry.url)).toEqual(['https://a.example'])
    expect(third.calls).toEqual([])
  })

  it('stops re-paying a dead engine within the cooldown', async () => {
    const dead = fakeEngine('dead', () => [])
    const alive = fakeEngine('alive', () => [hit('https://ok.example')])
    const serp = service([dead, alive])

    for (let i = 0; i < 4; i += 1) {
      expect(await serp.search(`query ${i}`, 5)).toHaveLength(1)
    }

    // Asked once, then skipped without a request for the remaining queries.
    expect(dead.calls).toHaveLength(1)
  })

  it('does not let a throwing engine escape as an error', async () => {
    const broken: SearchProvider = {
      name: 'broken',
      isConfigured: () => true,
      async search() {
        throw new Error('upstream exploded')
      },
    }
    const alive = fakeEngine('alive', () => [hit('https://ok.example')])

    // A search engine being down lowers confidence; it is not a 500.
    await expect(service([broken, alive]).search('acme', 5)).resolves.toHaveLength(1)
  })

  it('skips engines that are not configured', async () => {
    const unconfigured = { ...fakeEngine('brave', () => [hit('https://no.example')]), isConfigured: () => false }
    const alive = fakeEngine('alive', () => [hit('https://ok.example')])

    const hits = await service([unconfigured as SearchProvider, alive]).search('acme', 5)
    expect(hits[0]!.url).toBe('https://ok.example')
  })
})

describe('SerpService request deduplication', () => {
  beforeEach(resetSearchCircuitBreaker)

  it('collapses CONCURRENT identical queries into one request', async () => {
    /*
     * ⚠️ THE CASE THE POSTGRES CACHE CANNOT COVER. Twenty leads at six
     * companies issue their company queries at the same moment, so every one
     * of them misses the cache and all twenty reach the engine before the
     * first response has been written back.
     */
    let started = 0
    const slow: SearchProvider = {
      name: 'alive',
      isConfigured: () => true,
      async search() {
        started += 1
        await new Promise((resolve) => setTimeout(resolve, 10))
        return [hit('https://ok.example')]
      },
    }

    const serp = service([slow])
    const results = await Promise.all(
      Array.from({ length: 8 }, () => serp.search('acme corp funding', 5)),
    )

    expect(started).toBe(1)
    expect(results.every((hits) => hits.length === 1)).toBe(true)
  })

  it('treats differently-spelled identical queries as one', async () => {
    const engine = fakeEngine('alive', () => [hit('https://ok.example')])
    const serp = service([engine])

    await Promise.all([
      serp.search('Acme Corp   funding', 5),
      serp.search('acme corp funding', 5),
    ])

    expect(engine.calls).toHaveLength(1)
  })

  it('does not collapse queries that differ in limit', async () => {
    const engine = fakeEngine('alive', () => [hit('https://ok.example')])
    const serp = service([engine])

    await Promise.all([serp.search('acme', 5), serp.search('acme', 10)])
    expect(engine.calls).toHaveLength(2)
  })
})

describe('SerpService runMany', () => {
  beforeEach(resetSearchCircuitBreaker)

  it('deduplicates phrasings and merges hits by URL', async () => {
    const engine = fakeEngine('alive', (query) =>
      query.includes('phone') ? [hit('https://b.example')] : [hit('https://a.example')],
    )

    const result = await service([engine]).runMany(
      ['Ada acme email', 'ada   acme   email', 'Ada acme phone'],
      { limit: 5 },
    )

    expect(engine.calls).toHaveLength(2)
    expect(result.hits.map((entry) => entry.url).sort()).toEqual([
      'https://a.example',
      'https://b.example',
    ])
  })

  it('ranks the employer domain first across merged phrasings', async () => {
    const engine = fakeEngine('alive', (query) =>
      query.includes('phone') ? [hit('https://acme.com/team')] : [hit('https://directory.example/ada')],
    )

    const result = await service([engine]).runMany(['ada email', 'ada phone'], {
      limit: 5,
      preferDomains: ['acme.com'],
    })

    expect(result.hits[0]!.url).toBe('https://acme.com/team')
  })

  it('honours the query ceiling rather than searching every phrasing', async () => {
    const engine = fakeEngine('alive', (query) => [hit(`https://${encodeURIComponent(query)}.example`)])

    await service([engine]).runMany(['one', 'two', 'three', 'four', 'five', 'six'], {
      limit: 5,
      maxQueries: 2,
      stopAfter: 100,
    })

    expect(engine.calls).toHaveLength(2)
  })
})

describe('search budget', () => {
  beforeEach(() => {
    vi.resetModules()
    resetSearchCircuitBreaker()
  })

  it('leaves an uncapped engine uncapped', async () => {
    const { budgetFor } = await import('@/lib/search/budget')
    expect(budgetFor('solr').perDay).toBeNull()
    expect(budgetFor('mojeek').perDay).toBeNull()
  })

  it('defaults each metered tier to its real published cap', async () => {
    const { budgetFor } = await import('@/lib/search/budget')
    // 100/day free Custom Search, ~2,000/month Brave.
    expect(budgetFor('google-cse').perDay).toBe(100)
    expect(budgetFor('brave').perDay).toBe(66)
    expect(budgetFor('tavily').metered).toBe(true)
  })

  it('lets an operator override a cap, including to unlimited', async () => {
    vi.stubEnv('SERP_BUDGET_GOOGLE_CSE', '250')
    vi.stubEnv('SERP_BUDGET_BRAVE', 'unlimited')
    const { budgetFor } = await import('@/lib/search/budget')

    expect(budgetFor('google-cse').perDay).toBe(250)
    expect(budgetFor('brave').perDay).toBeNull()
    vi.unstubAllEnvs()
  })

  it('ignores a malformed override rather than disabling the engine', async () => {
    vi.stubEnv('SERP_BUDGET_GOOGLE_CSE', 'lots')
    const { budgetFor } = await import('@/lib/search/budget')

    expect(budgetFor('google-cse').perDay).toBe(100)
    vi.unstubAllEnvs()
  })
})

describe('keyless fallback engine', () => {
  it('is OFF unless an operator opted in', async () => {
    const { MojeekSearchProvider } = await import('@/lib/search/engines')
    vi.stubEnv('SERP_KEYLESS_FALLBACK', '')
    expect(new MojeekSearchProvider().isConfigured()).toBe(false)

    vi.stubEnv('SERP_KEYLESS_FALLBACK', 'true')
    expect(new MojeekSearchProvider().isConfigured()).toBe(true)
    vi.unstubAllEnvs()
  })

  it('returns nothing rather than working around a refusal', async () => {
    const { MojeekSearchProvider } = await import('@/lib/search/engines')
    vi.stubEnv('SERP_KEYLESS_FALLBACK', 'true')

    // The HTTP layer throws on a block; the engine steps aside. Nothing here
    // retries through a disguise — that is the line between fallback and
    // evasion (CLAUDE.md rule 1).
    await expect(
      new MojeekSearchProvider().search('acme', 5, { deadlineAt: Date.now() - 1 }),
    ).resolves.toEqual([])
    vi.unstubAllEnvs()
  })
})
