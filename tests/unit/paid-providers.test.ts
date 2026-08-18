/**
 * The paid-provider switch.
 *
 * ⚠️ THIS IS THE ONLY POINT WHERE MONEY CAN ENTER THE SYSTEM, and it is
 * enforced when the registry is BUILT rather than at each call site. A new code
 * path cannot spend by forgetting a check, because a disabled provider is never
 * in the registry to be called at all.
 *
 * The default matters more than the mechanism: absent must mean OFF.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ALL_PROVIDERS,
  PAID_PROVIDERS,
  buildLiveRegistry,
  paidProvidersEnabled,
} from '@/lib/intelligence/providers'

afterEach(() => {
  vi.unstubAllEnvs()
})

function registeredNames(): string[] {
  const registry = buildLiveRegistry(undefined)
  return [...new Set(ALL_PROVIDERS.map((p) => p.category))].flatMap((category) =>
    registry.forCategory(category).map((provider) => provider.name),
  )
}

describe('paidProvidersEnabled', () => {
  it('is FALSE when the variable is absent', () => {
    // Absent must never be inherited as "yes". This is the whole guard.
    vi.stubEnv('OUTLIO_ALLOW_PAID_PROVIDERS', '')
    expect(paidProvidersEnabled()).toBe(false)
  })

  it('is false for anything that is not exactly "true"', () => {
    for (const value of ['1', 'yes', 'TRUE', 'on', 'false']) {
      vi.stubEnv('OUTLIO_ALLOW_PAID_PROVIDERS', value)
      expect(paidProvidersEnabled(), value).toBe(false)
    }
  })

  it('is true only on an explicit opt-in', () => {
    vi.stubEnv('OUTLIO_ALLOW_PAID_PROVIDERS', 'true')
    expect(paidProvidersEnabled()).toBe(true)
  })
})

describe('the registry excludes metered providers by default', () => {
  it('registers NONE of them when paid providers are off', () => {
    vi.stubEnv('OUTLIO_ALLOW_PAID_PROVIDERS', '')
    const names = registeredNames()

    for (const paid of PAID_PROVIDERS) {
      expect(names, `${paid} must not be reachable`).not.toContain(paid)
    }
  })

  it('still registers the free ones', () => {
    vi.stubEnv('OUTLIO_ALLOW_PAID_PROVIDERS', '')
    const names = registeredNames()

    // Free sources are the whole point of running with paid providers off.
    for (const free of ['dns-tech', 'gdelt-funding', 'wikidata', 'github', 'hackernews']) {
      expect(names, free).toContain(free)
    }
  })

  it('registers them again on an explicit opt-in', () => {
    vi.stubEnv('OUTLIO_ALLOW_PAID_PROVIDERS', 'true')
    expect(registeredNames()).toContain('tavily-funding')
  })
})

describe('every metered provider is named in the set', () => {
  it('has no priced provider missing from PAID_PROVIDERS', async () => {
    /*
     * A provider with a non-zero cost that is NOT in the set would be spendable
     * with paid providers switched off — exactly the leak this guards.
     */
    const leaked: string[] = []

    for (const provider of ALL_PROVIDERS) {
      if (PAID_PROVIDERS.has(provider.name)) continue
      const cost = await provider
        .estimateCost({
          id: 'probe',
          category: provider.category,
          entity: { type: 'company', id: 'c', name: 'Probe', domain: null, linkedinUrl: null },
          fields: [],
        })
        .catch(() => 0)

      if (cost > 0) leaked.push(`${provider.name} (${cost})`)
    }

    expect(leaked, 'priced but not listed as paid').toEqual([])
  })
})
