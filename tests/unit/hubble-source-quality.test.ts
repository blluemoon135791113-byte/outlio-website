/**
 * Source credibility.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS MODULE EXISTS BECAUSE OF A REAL FAILURE.                        ║
 * ║                                                                          ║
 * ║  Asked "who is the CEO of Anthropic", retrieval ranked a contact-broker  ║
 * ║  page FIRST, and it said "Sam McCandlish". That is wrong. Tracxn and     ║
 * ║  Wikipedia both said Dario Amodei and ranked BELOW it.                   ║
 * ║                                                                          ║
 * ║  It won because those pages auto-generate FAQ blocks echoing the         ║
 * ║  question verbatim, so they match phrasing better than the primary       ║
 * ║  source that simply states the fact. Relevance is not credibility.       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import { canCorroborate, classifySource, sourceWeight } from '@/lib/hubble/source-quality'
import { retrieve } from '@/lib/hubble/retrieve'

describe('classifySource', () => {
  it("promotes the company's OWN site to primary", () => {
    // For "what do they sell" or "what does it cost", nobody outranks them.
    expect(classifySource('https://acme.com/pricing', 'acme.com')).toBe('primary')
    expect(classifySource('https://www.acme.com/about', 'acme.com')).toBe('primary')
    expect(classifySource('https://blog.acme.com/x', 'acme.com')).toBe('primary')
  })

  it('recognises official registries', () => {
    expect(classifySource('https://www.sec.gov/edgar/x', null)).toBe('official')
    expect(classifySource('https://find-and-update.company-information.service.gov.uk/x', null)).toBe('official')
  })

  it('recognises reputable press and encyclopaedias', () => {
    for (const url of [
      'https://en.wikipedia.org/wiki/Anthropic',
      'https://www.reuters.com/x',
      'https://techcrunch.com/x',
      'https://tracxn.com/d/companies/x',
    ]) {
      expect(classifySource(url, null), url).toBe('reputable')
    }
  })

  it('DEMOTES the contact brokers that caused the wrong answer', () => {
    for (const url of [
      'https://seamless.ai/b/anthropic-3594227',
      'https://rocketreach.co/x',
      'https://www.zoominfo.com/c/x',
      'https://www.signalhire.com/companies/x',
      'https://www.zippia.com/x-careers/',
    ]) {
      expect(classifySource(url, null), url).toBe('broker')
    }
  })

  it('treats forums as weak but not worthless', () => {
    expect(classifySource('https://www.reddit.com/r/x/', null)).toBe('forum')
  })
})

describe('sourceWeight', () => {
  it('orders the tiers the way credibility runs', () => {
    const own = sourceWeight('https://acme.com/x', 'acme.com')
    const official = sourceWeight('https://sec.gov/x', null)
    const reputable = sourceWeight('https://en.wikipedia.org/x', null)
    const unknown = sourceWeight('https://some-blog.example/x', null)
    const broker = sourceWeight('https://seamless.ai/x', null)

    expect(own).toBeGreaterThan(reputable)
    expect(official).toBeGreaterThan(reputable)
    expect(reputable).toBeGreaterThan(unknown)
    expect(unknown).toBeGreaterThan(broker)
    // Severe on purpose: this is the tier that produced a confidently wrong CEO.
    expect(broker).toBeLessThan(0.5)
  })
})

describe('retrieval with source weighting', () => {
  it('STOPS THE BROKER OUTRANKING THE PRIMARY SOURCE', () => {
    /*
     * The exact shape of the real failure: the broker echoes the question
     * verbatim (great lexical match) and states the wrong fact; Wikipedia
     * states the right one in prose.
     */
    const chunks = [
      {
        pageId: 'b',
        url: 'https://seamless.ai/b/anthropic-3594227',
        title: 'Anthropic',
        ordinal: 0,
        content: 'Who is the CEO of Anthropic? The CEO of Anthropic is Sam McCandlish. Who is the CFO of Anthropic?',
      },
      {
        pageId: 'w',
        url: 'https://en.wikipedia.org/wiki/Anthropic',
        title: 'Anthropic',
        ordinal: 0,
        content: 'Anthropic was founded in 2021 by siblings Daniela Amodei and Dario Amodei, who serve as president and CEO respectively.',
      },
    ]

    const results = retrieve('who is the CEO of Anthropic', chunks, null, 5)
    expect(results[0]!.url).toContain('wikipedia.org')
  })

  it('still surfaces a broker when it is the ONLY source', () => {
    // A discount, not a ban: for a small company the broker page may be the
    // only thing on the web that mentions them at all.
    const results = retrieve('who is the CEO', [
      { pageId: 'b', url: 'https://seamless.ai/x', title: null, ordinal: 0, content: 'The CEO is Jane Roe.' },
    ], null, 5)

    expect(results).toHaveLength(1)
  })
})

describe('canCorroborate', () => {
  it('needs two DIFFERENT non-broker hosts', () => {
    expect(canCorroborate(['https://en.wikipedia.org/x', 'https://reuters.com/y'], null)).toBe(true)
  })

  it('refuses two pages of the SAME site', () => {
    // Two pages on one domain are one source.
    expect(canCorroborate(['https://en.wikipedia.org/x', 'https://en.wikipedia.org/y'], null)).toBe(false)
  })

  it('REFUSES two brokers agreeing with each other', () => {
    /*
     * ⚠️ Frequently the same scraped record echoed twice. Corroboration
     * between them is not corroboration at all — it is how a wrong fact
     * acquires false authority.
     */
    expect(canCorroborate(['https://seamless.ai/x', 'https://rocketreach.co/y'], null)).toBe(false)
  })

  it('refuses a single source', () => {
    expect(canCorroborate(['https://en.wikipedia.org/x'], null)).toBe(false)
    expect(canCorroborate([], null)).toBe(false)
  })
})

describe('confidenceCeiling', () => {
  it('CAPS an answer resting only on sources we cannot vouch for', async () => {
    /*
     * ⚠️ The denylist names the offenders we know; the web is full of SEO
     * content farms that behave identically and are on no list. A real run
     * surfaced one immediately after the broker was demoted. This is what
     * catches them without naming them.
     */
    const { confidenceCeiling } = await import('@/lib/hubble/source-quality')

    expect(confidenceCeiling(['https://random-content-farm.example/x'], null)).toBeLessThan(0.7)
    expect(confidenceCeiling(['https://seamless.ai/x'], null)).toBeLessThan(0.5)
  })

  it('allows full confidence from a primary or official source', async () => {
    const { confidenceCeiling } = await import('@/lib/hubble/source-quality')

    expect(confidenceCeiling(['https://acme.com/pricing'], 'acme.com')).toBe(1)
    expect(confidenceCeiling(['https://www.sec.gov/x'], null)).toBe(1)
  })

  it('allows high but not total confidence from reputable press', async () => {
    const { confidenceCeiling } = await import('@/lib/hubble/source-quality')
    expect(confidenceCeiling(['https://reuters.com/x'], null)).toBe(0.9)
  })

  it('caps hardest when there are no sources at all', async () => {
    const { confidenceCeiling } = await import('@/lib/hubble/source-quality')
    expect(confidenceCeiling([], null)).toBe(0.3)
  })
})
