/**
 * Extraction logic for the Phase 3 providers.
 *
 * All pure, all tested against recorded-shape search results — no network.
 *
 * The rules being defended, in order of how much damage breaking them causes:
 *
 *  1. **A wrong domain is worse than no domain.** It becomes the company's
 *     primary identity and can merge two different companies.
 *  2. **Funding is never attributed without the company being named** in the
 *     source text, and never carries HIGH confidence.
 *  3. **No document, no claim.** Silence is `unknown`, never `false`.
 */
import { describe, expect, it } from 'vitest'

import { pickCompanyDomain } from '@/lib/intelligence/providers/domain-discovery'
import {
  extractAmount,
  extractAnnouncementDate,
  extractFunding,
  extractInvestors,
  extractRound,
  mentionsCompany,
} from '@/lib/intelligence/providers/funding'
import { normalizeGdeltArticles, parseGdeltDate } from '@/lib/intelligence/providers/gdelt'
import { normalizeResults } from '@/lib/intelligence/providers/tavily'
import { findingsFromDocuments } from '@/lib/intelligence/providers/web-research'
import { extractBusinessModel, extractSearchProfile } from '@/lib/intelligence/providers/search-profile'
import type { SearchResult } from '@/lib/intelligence/providers/tavily'

function doc(over: Partial<SearchResult> = {}): SearchResult {
  return {
    title: '',
    url: 'https://example.com/a',
    content: '',
    score: 0.5,
    publishedDate: null,
    ...over,
  }
}

describe('pickCompanyDomain', () => {
  it('picks the company website when the name matches the domain', () => {
    const result = pickCompanyDomain('Acme Systems', [
      doc({ url: 'https://www.acmesystems.com/', title: 'Acme Systems' }),
      doc({ url: 'https://www.crunchbase.com/organization/acme-systems' }),
    ])

    expect(result?.domain).toBe('acmesystems.com')
  })

  it('accepts a shortened form of a longer name', () => {
    const result = pickCompanyDomain('Acme Systems', [
      doc({ url: 'https://acme.com/about' }),
      doc({ url: 'https://acme.com/pricing' }),
    ])

    expect(result?.domain).toBe('acme.com')
  })

  it('NEVER returns an aggregator, however well it ranks', () => {
    for (const url of [
      'https://www.crunchbase.com/organization/acme',
      'https://www.linkedin.com/company/acme',
      'https://www.glassdoor.com/Overview/acme',
      'https://github.com/acme',
      'https://www.ycombinator.com/companies/acme',
      'https://uk.trustpilot.com/review/acme.com',
    ]) {
      expect(pickCompanyDomain('Acme', [doc({ url })]), url).toBeNull()
    }
  })

  it('returns null when nothing resembles the company name', () => {
    // Ranking alone must never qualify: being first for a name proves
    // popularity, not ownership.
    const result = pickCompanyDomain('Acme', [
      doc({ url: 'https://techcrunch.com/2026/01/acme-raises' }),
      doc({ url: 'https://news.ycombinator.com/item?id=1' }),
    ])

    expect(result).toBeNull()
  })

  it('refuses to choose between two equally plausible domains', () => {
    const result = pickCompanyDomain('Acme', [
      doc({ url: 'https://acme.com' }),
      doc({ url: 'https://acme.io' }),
    ])

    expect(result).toBeNull()
  })

  it('rejects a mailbox provider even if it somehow ranks', () => {
    expect(pickCompanyDomain('Gmail', [doc({ url: 'https://gmail.com' })])).toBeNull()
  })

  it('returns null when the company has no usable name', () => {
    expect(pickCompanyDomain(null, [doc({ url: 'https://acme.com' })])).toBeNull()
    expect(pickCompanyDomain('   ', [doc({ url: 'https://acme.com' })])).toBeNull()
  })

  it('returns null for no results rather than throwing', () => {
    expect(pickCompanyDomain('Acme', [])).toBeNull()
  })

  it('carries the URL the domain was found at', () => {
    const result = pickCompanyDomain('Acme Systems', [
      doc({ url: 'https://www.acmesystems.com/about' }),
    ])

    expect(result?.sourceUrl).toBe('https://www.acmesystems.com/about')
  })
})

describe('funding — company attribution', () => {
  it('matches the company when the article names it', () => {
    expect(mentionsCompany('Acme Systems', 'Acme Systems raises $8M Series A')).toBe(true)
    expect(mentionsCompany('Acme Systems, Inc.', 'acme systems raised a round')).toBe(true)
  })

  it('does NOT match a different company with a similar name', () => {
    expect(mentionsCompany('Acme', 'Acmetric raises $8M Series A')).toBe(false)
    expect(mentionsCompany('Stripe', 'Stripe Press announces a new book')).toBe(false)
  })

  it('does not match when the company is absent entirely', () => {
    expect(mentionsCompany('Acme', 'Globex raises $8M Series A')).toBe(false)
    expect(mentionsCompany(null, 'anything')).toBe(false)
  })
})

describe('funding — deterministic extraction', () => {
  it('reads rounds', () => {
    expect(extractRound('Acme raises $8M Series A')).toBe('Series A')
    expect(extractRound('closed a Series B round')).toBe('Series B')
    expect(extractRound('announces pre-seed funding')).toBe('Pre-Seed')
    expect(extractRound('raises seed round')).toBe('Seed')
    expect(extractRound('a quiet year for the company')).toBeNull()
  })

  it('reads amounts with their currency', () => {
    expect(extractAmount('raises $8M')).toEqual({ amount: 8_000_000, currency: 'USD' })
    expect(extractAmount('raises $8.5 million')).toEqual({ amount: 8_500_000, currency: 'USD' })
    expect(extractAmount('secures €10M')).toEqual({ amount: 10_000_000, currency: 'EUR' })
    expect(extractAmount('£2bn valuation round')).toEqual({ amount: 2_000_000_000, currency: 'GBP' })
    expect(extractAmount('USD 5,000,000 investment')).toEqual({ amount: 5_000_000, currency: 'USD' })
    expect(extractAmount('$750,000 pre-seed')).toEqual({ amount: 750_000, currency: 'USD' })
  })

  it('IGNORES an amount with no currency marker', () => {
    // "raised 5 million" could be any currency. Guessing USD would silently
    // misprice every non-US company on the list.
    expect(extractAmount('raised 5 million in new funding')).toBeNull()
    expect(extractAmount('a 20 percent increase')).toBeNull()
  })

  it('reads investors conservatively', () => {
    expect(extractInvestors('$8M Series A led by Acme Ventures')).toContain('Acme Ventures')
    expect(extractInvestors('led by Alpha Capital and Beta Partners')).toEqual([
      'Alpha Capital',
      'Beta Partners',
    ])
    expect(extractInvestors('the round was oversubscribed')).toEqual([])
  })

  it('extracts a full announcement', () => {
    const facts = extractFunding('Acme Systems', [
      doc({
        title: 'Acme Systems raises $8M Series A led by Alpha Capital',
        content: 'The round brings total funding to $12M.',
        url: 'https://news.example.com/acme',
        publishedDate: '2026-03-01T00:00:00.000Z',
      }),
    ])

    expect(facts).toMatchObject({
      round: 'Series A',
      amount: 8_000_000,
      currency: 'USD',
      announcedAt: '2026-03-01T00:00:00.000Z',
      sourceUrl: 'https://news.example.com/acme',
    })
    expect(facts?.investors).toContain('Alpha Capital')
  })

  it('refuses an article about a DIFFERENT company', () => {
    const facts = extractFunding('Acme Systems', [
      doc({ title: 'Globex raises $8M Series A', content: 'Globex announced today…' }),
    ])

    expect(facts).toBeNull()
  })

  it('refuses an article that is not about funding', () => {
    const facts = extractFunding('Acme Systems', [
      doc({ title: 'Acme Systems launches a new dashboard', content: 'Product news.' }),
    ])

    expect(facts).toBeNull()
  })

  it('reports a round with no figure rather than inventing one', () => {
    const facts = extractFunding('Acme Systems', [
      doc({ title: 'Acme Systems closes its Series B round', content: 'Terms undisclosed.' }),
    ])

    expect(facts?.round).toBe('Series B')
    expect(facts?.amount).toBeNull()
    expect(facts?.currency).toBeNull()
  })

  it('returns null for no documents', () => {
    expect(extractFunding('Acme', [])).toBeNull()
  })

  it('keeps looking for the requested investor field', () => {
    const facts = extractFunding(
      'Acme Systems',
      [
        doc({ title: 'Acme Systems raises $8M Series A' }),
        doc({ title: 'Acme Systems funding led by Alpha Capital and Beta Partners' }),
      ],
      ['funding_investors'],
    )

    expect(facts?.investors).toEqual(['Alpha Capital', 'Beta Partners'])
  })

  it('reads an announcement date from a search snippet when the engine omits metadata', () => {
    expect(
      extractAnnouncementDate(
        doc({ title: 'Acme raises Series A', content: 'August 20, 2026 — Acme announced funding.' }),
      ),
    ).toBe('2026-08-20T00:00:00.000Z')
  })

  it('normalizes relative search-result dates against the lookup time', () => {
    expect(
      extractAnnouncementDate(
        doc({ content: '3 days ago — Acme raised a new round.' }),
        new Date('2026-08-22T12:00:00.000Z'),
      ),
    ).toBe('2026-08-19T12:00:00.000Z')
  })
})

describe('web research — no document, no claim', () => {
  it('reports hiring only when a document mentions it', () => {
    const findings = findingsFromDocuments('hiring_signals', [
      doc({ title: 'Acme is hiring an Account Executive', url: 'https://acme.com/careers' }),
    ])

    expect(findings).toHaveLength(1)
    expect(findings[0]!.value).toMatchObject({ hiring: true, salesHiring: true })
    expect(findings[0]!.value.roles).toContain('account executive')
  })

  it('canonicalizes the full sales-development title to SDR', () => {
    const findings = findingsFromDocuments('hiring_signals', [
      doc({ title: 'Acme is hiring a Sales Development Representative' }),
    ])

    expect(findings[0]!.value.roles).toContain('sdr')
  })

  it('stays SILENT rather than claiming a company is not hiring', () => {
    // The critical distinction: no evidence of hiring is `unknown`, and must
    // never surface as "not hiring".
    const findings = findingsFromDocuments('hiring_signals', [
      doc({ title: 'Acme launches a new product', content: 'Nothing about jobs.' }),
    ])

    expect(findings).toEqual([])
  })

  it('emits nothing at all when there are no documents', () => {
    for (const field of ['recent_news', 'hiring_signals', 'competitors'] as const) {
      expect(findingsFromDocuments(field, []), field).toEqual([])
    }
  })

  it('never rates a news claim above MEDIUM, or a competitor claim above LOW', () => {
    const news = findingsFromDocuments('recent_news', [doc({ title: 'Acme in the news' })])
    expect(news[0]!.sourceConfidence).toBe('medium')

    const competitors = findingsFromDocuments('competitors', [doc({ title: 'Acme vs Globex' })])
    expect(competitors[0]!.sourceConfidence).toBe('low')
  })

  it('carries the source URL on every finding', () => {
    const findings = findingsFromDocuments('recent_news', [
      doc({ title: 'Acme news', url: 'https://news.example.com/acme' }),
    ])

    expect(findings[0]!.sourceUrl).toBe('https://news.example.com/acme')
  })
})

describe('SearXNG company profile extraction', () => {
  it('extracts a sourced SaaS model only from a result about the company', () => {
    const finding = extractBusinessModel(
      { type: 'company', id: 'acme', name: 'Acme Systems', domain: 'acme.test', linkedinUrl: null },
      [{
        title: 'Acme Systems — B2B SaaS platform',
        url: 'https://acme.test/about',
        snippet: 'Subscription software-as-a-service for revenue teams.',
      }],
    )

    expect(finding?.models).toEqual(['SaaS', 'B2B', 'Subscription'])
    expect(finding?.sourceUrl).toBe('https://acme.test/about')
  })

  it('does not classify an unrelated search result', () => {
    expect(extractBusinessModel(
      { type: 'company', id: 'acme', name: 'Acme Systems', domain: null, linkedinUrl: null },
      [{ title: 'Other Co SaaS', url: 'https://other.test', snippet: 'A SaaS company.' }],
    )).toBeNull()
  })

  it('returns a sourced description and conservative industry for basic profile questions', () => {
    const finding = extractSearchProfile(
      { type: 'company', id: 'acme', name: 'Acme Systems', domain: 'acme.test', linkedinUrl: null },
      [{
        title: 'About Acme Systems',
        url: 'https://acme.test/about',
        snippet: 'Acme Systems builds cybersecurity software for small businesses.',
      }],
    )

    expect(finding).toMatchObject({
      description: 'Acme Systems builds cybersecurity software for small businesses.',
      industry: 'Cybersecurity',
      sourceUrl: 'https://acme.test/about',
    })
  })
})

describe('response parsing', () => {
  it('drops Tavily results with no URL instead of failing', () => {
    const parsed = normalizeResults({
      results: [
        { title: 'Good', url: 'https://example.com/a', content: 'x', score: 0.9 },
        { title: 'No URL' },
      ],
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.url).toBe('https://example.com/a')
  })

  it('survives an empty or unexpected Tavily body', () => {
    expect(normalizeResults({})).toEqual([])
    expect(normalizeResults({ results: [] })).toEqual([])
  })

  it("converts GDELT's non-standard date format", () => {
    // `Date.parse` rejects this outright, so an unconverted value would make
    // every GDELT article undated.
    expect(parseGdeltDate('20260301T120000Z')).toBe('2026-03-01T12:00:00.000Z')
    expect(parseGdeltDate('nonsense')).toBeNull()
    expect(parseGdeltDate(undefined)).toBeNull()
  })

  it('parses GDELT articles', () => {
    const parsed = normalizeGdeltArticles({
      articles: [
        { title: 'Acme raises', url: 'https://news.example.com/a', seendate: '20260301T120000Z' },
        { title: 'No URL' },
      ],
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.publishedDate).toBe('2026-03-01T12:00:00.000Z')
  })
})
