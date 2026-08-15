/**
 * Wikidata and PageSpeed extraction, and the live waterfall order.
 *
 * The Wikidata tests are mostly about REFUSING to match. Wikidata is full of
 * people, films, and towns sharing a company's name, and attaching a Greek
 * god's founding date to a lead is a worse outcome than knowing nothing.
 */
import { afterEach, describe, expect, it } from 'vitest'

import {
  extractTechnologies,
  hasPageSpeedCredentials,
} from '@/lib/intelligence/providers/pagespeed'
import {
  extractWikidataFacts,
  pickWikidataEntity,
  referencedItemIds,
} from '@/lib/intelligence/providers/wikidata'
import {
  ALL_PROVIDERS,
  DEFAULT_PROVIDER_ORDER,
  buildLiveRegistry,
} from '@/lib/intelligence/providers'

function statement(content: unknown) {
  return { value: { content } }
}

const ACME_ITEM = {
  id: 'Q123',
  statements: {
    P31: [statement('Q4830453')], // business
    P856: [statement('https://www.acme.com/')],
    P1128: [statement({ amount: '+340', unit: '1' })],
    P571: [statement({ time: '+2011-06-01T00:00:00Z', precision: 11 })],
    P452: [statement('Q11661')],
    P159: [statement('Q60')],
  },
}

describe('pickWikidataEntity', () => {
  it('matches an entity whose label is the company name', () => {
    expect(
      pickWikidataEntity('Acme Systems', [
        { id: 'Q1', label: 'Acme Systems' },
        { id: 'Q2', label: 'Something Else' },
      ]),
    ).toBe('Q1')
  })

  it('ignores legal-form differences', () => {
    expect(pickWikidataEntity('Acme Systems Inc.', [{ id: 'Q1', label: 'Acme Systems' }])).toBe('Q1')
  })

  it('treats a legal form as the same company', () => {
    // Stripping legal forms is the point: "Acme Corporation" is "Acme".
    expect(pickWikidataEntity('Acme', [{ id: 'Q1', label: 'Acme Corporation' }])).toBe('Q1')
  })

  it('refuses a near miss', () => {
    // Wikidata disambiguates with a parenthetical, which is a different thing.
    expect(pickWikidataEntity('Acme', [{ id: 'Q1', label: 'Acme Corporation (film)' }])).toBeNull()
    expect(pickWikidataEntity('Acme', [{ id: 'Q1', label: 'Acmetric' }])).toBeNull()
    expect(pickWikidataEntity('Acme', [{ id: 'Q1', label: 'Acme Systems' }])).toBeNull()
  })

  it('refuses when two entities share the name', () => {
    expect(
      pickWikidataEntity('Apollo', [
        { id: 'Q1', label: 'Apollo' },
        { id: 'Q2', label: 'Apollo' },
      ]),
    ).toBeNull()
  })

  it('returns null for no candidates or no name', () => {
    expect(pickWikidataEntity('Acme', [])).toBeNull()
    expect(pickWikidataEntity(null, [{ id: 'Q1', label: 'Acme' }])).toBeNull()
  })
})

describe('extractWikidataFacts', () => {
  it('reads the facts we care about', () => {
    const facts = extractWikidataFacts(ACME_ITEM, { Q11661: 'information technology', Q60: 'New York City' })

    expect(facts).toMatchObject({
      entityId: 'Q123',
      website: 'https://www.acme.com/',
      domain: 'acme.com',
      employeeCount: 340,
      foundedYear: 2011,
      industry: 'information technology',
      headquarters: 'New York City',
    })
  })

  it('REFUSES an entity that is not an organisation', () => {
    // Apollo the Greek god has a founding date too.
    const god = { id: 'Q37340', statements: { P31: [statement('Q22989102')] } }
    expect(extractWikidataFacts(god)).toBeNull()
  })

  it('refuses an item with no instance-of at all', () => {
    expect(extractWikidataFacts({ id: 'Q1', statements: {} })).toBeNull()
  })

  it('normalizes the website into a bare domain', () => {
    const facts = extractWikidataFacts({
      ...ACME_ITEM,
      statements: { ...ACME_ITEM.statements, P856: [statement('http://acme.com/index.html?x=1')] },
    })
    expect(facts?.domain).toBe('acme.com')
  })

  it('leaves fields null rather than guessing when statements are absent', () => {
    const facts = extractWikidataFacts({ id: 'Q1', statements: { P31: [statement('Q4830453')] } })

    expect(facts).toMatchObject({
      website: null,
      domain: null,
      employeeCount: null,
      foundedYear: null,
      industry: null,
      headquarters: null,
    })
  })

  it('survives malformed quantity and time shapes', () => {
    const facts = extractWikidataFacts({
      id: 'Q1',
      statements: {
        P31: [statement('Q4830453')],
        P1128: [statement({ amount: 'not a number' })],
        P571: [statement({ time: 'garbage' })],
      },
    })

    expect(facts?.employeeCount).toBeNull()
    expect(facts?.foundedYear).toBeNull()
  })

  it('leaves an unresolved item id out rather than showing a QID to a user', () => {
    const facts = extractWikidataFacts(ACME_ITEM, {})
    expect(facts?.industry).toBeNull()
    expect(facts?.headquarters).toBeNull()
  })

  it('lists the ids that need label resolution', () => {
    expect(referencedItemIds(ACME_ITEM).sort()).toEqual(['Q11661', 'Q60'])
  })
})

describe('extractTechnologies', () => {
  it('reads and categorises Lighthouse stack packs', () => {
    const technologies = extractTechnologies({
      lighthouseResult: {
        finalUrl: 'https://acme.com/',
        stackPacks: [
          { id: 'wordpress', title: 'WordPress' },
          { id: 'react', title: 'React' },
        ],
      },
    })

    expect(technologies).toEqual([
      { id: 'wordpress', name: 'WordPress', category: 'cms' },
      { id: 'react', name: 'React', category: 'framework' },
    ])
  })

  it('keeps an unrecognised pack rather than dropping the fact', () => {
    const [tech] = extractTechnologies({
      lighthouseResult: { stackPacks: [{ id: 'brand-new-thing', title: 'Brand New Thing' }] },
    })

    expect(tech).toEqual({ id: 'brand-new-thing', name: 'Brand New Thing', category: 'other' })
  })

  it('returns nothing when Lighthouse detected nothing', () => {
    // Which means UNKNOWN, not "no technology" — the provider emits no evidence.
    expect(extractTechnologies({ lighthouseResult: { stackPacks: [] } })).toEqual([])
    expect(extractTechnologies({})).toEqual([])
  })

  it('falls back to the id when a pack has no title', () => {
    expect(extractTechnologies({ lighthouseResult: { stackPacks: [{ id: 'shopify' }] } })).toEqual([
      { id: 'shopify', name: 'shopify', category: 'ecommerce' },
    ])
  })
})

describe('the live registry', () => {
  const original = process.env.INTELLIGENCE_PROVIDER_ORDER

  afterEach(() => {
    if (original === undefined) delete process.env.INTELLIGENCE_PROVIDER_ORDER
    else process.env.INTELLIGENCE_PROVIDER_ORDER = original
  })

  it('prefers the stated fact over the inferred one for a company domain', () => {
    // Wikidata says what the website IS; domain discovery notices that a host
    // looks like the name. The stated fact must be tried first.
    const registry = buildLiveRegistry(undefined)
    expect(registry.forCategory('company_profile').map((p) => p.name)).toEqual([
      'wikidata',
      'companies-house',
      'sec-edgar',
      'tavily-domain-discovery',
    ])
  })

  it('puts the keyless fallback behind the licensed source', () => {
    const registry = buildLiveRegistry(undefined)
    expect(registry.forCategory('funding').map((p) => p.name)).toEqual([
      'tavily-funding',
      'gdelt-funding',
    ])
    expect(registry.forCategory('web_research').map((p) => p.name)).toEqual([
      'tavily-web',
      'gdelt-web',
    ])
  })

  it('lets configuration reorder a waterfall without touching code', () => {
    const registry = buildLiveRegistry('funding=gdelt-funding>tavily-funding')
    expect(registry.forCategory('funding').map((p) => p.name)).toEqual([
      'gdelt-funding',
      'tavily-funding',
    ])
  })

  it('MERGES an override rather than replacing every category', () => {
    // Naming one category must not silently disable the others.
    const registry = buildLiveRegistry('funding=gdelt-funding')
    expect(registry.forCategory('web_research').map((p) => p.name)).toEqual([
      'tavily-web',
      'gdelt-web',
    ])
  })

  it('ignores a malformed override instead of failing closed', () => {
    const registry = buildLiveRegistry('nonsense,,=,funding=')
    expect(registry.forCategory('funding').map((p) => p.name)).toEqual([
      'tavily-funding',
      'gdelt-funding',
    ])
  })

  it('registers every provider exactly once, under one category', () => {
    const names = ALL_PROVIDERS.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)

    for (const [category, order] of Object.entries(DEFAULT_PROVIDER_ORDER)) {
      for (const name of order ?? []) {
        const provider = ALL_PROVIDERS.find((p) => p.name === name)
        expect(provider, `${name} is named in the ${category} order but not registered`).toBeDefined()
        expect(provider!.category).toBe(category)
      }
    }
  })

  it('reports PageSpeed as unconfigured when the key is absent', () => {
    const key = process.env.PAGESPEED_API_KEY
    delete process.env.PAGESPEED_API_KEY
    try {
      expect(hasPageSpeedCredentials()).toBe(false)
    } finally {
      if (key !== undefined) process.env.PAGESPEED_API_KEY = key
    }
  })
})
