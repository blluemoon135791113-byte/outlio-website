/**
 * The key form may only offer scopes an endpoint actually requires.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ `api_scope` DECLARES SIX `:write` VALUES AND NO WRITE ENDPOINT EXISTS. ║
 * ║  All six routes under `app/api/v1` are `GET`.                            ║
 * ║                                                                           ║
 * ║  The developer settings form used to offer a `write` checkbox per         ║
 * ║  resource, so a customer could grant `contacts:write`, reasonably conclude ║
 * ║  the API accepts writes, and find that nothing does. Not a security hole  ║
 * ║  — enforcement is `scopes.includes(required)` against a scope no route    ║
 * ║  ever requires, so an unused scope grants nothing — but a capability the  ║
 * ║  product offers and does not have is its own kind of defect.             ║
 * ║                                                                           ║
 * ║  ⚠️ `schema-without-code.test.ts` WOULD NEVER HAVE CAUGHT THIS. It watches ║
 * ║  unused TABLES; an unused enum VALUE falls straight through it. Same      ║
 * ║  defect class this project keeps finding, one level down in the type      ║
 * ║  system.                                                                  ║
 * ║                                                                           ║
 * ║  ⚠️ DERIVED FROM THE ROUTES, NOT A HARDCODED LIST. The whole point is that ║
 * ║  the day someone ships `POST /api/v1/contacts`, this file notices the     ║
 * ║  form is now WRONG in the other direction — offering less than the API    ║
 * ║  supports — and says so.                                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const V1 = join(ROOT, 'app/api/v1')
const FORM = join(ROOT, 'components/settings/DeveloperSettings.tsx')

/** Every scope string some v1 route passes to `apiRoute`. */
function scopesWithAnEndpoint(): string[] {
  const found = new Set<string>()

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === 'route.ts') {
        const source = readFileSync(full, 'utf8')
        for (const m of source.matchAll(/apiRoute\('([a-z]+:[a-z]+)'/g)) found.add(m[1]!)
      }
    }
  }

  walk(V1)
  return [...found].sort()
}

/** The `read`/`write` modes the key form renders a checkbox for. */
function modesTheFormOffers(): string[] {
  const source = readFileSync(FORM, 'utf8')
  const list = source.match(/const OFFERED_MODES = \[([^\]]*)\]/)?.[1] ?? ''
  return [...list.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!).sort()
}

describe('the scanner itself', () => {
  it('finds the v1 routes and the scopes they require', () => {
    // Without this, a moved directory empties the set and the comparison below
    // passes against nothing.
    const scopes = scopesWithAnEndpoint()
    expect(scopes.length, 'no apiRoute scopes found under app/api/v1').toBeGreaterThanOrEqual(6)
    expect(scopes).toContain('contacts:read')
  })

  it('finds the modes the form offers', () => {
    expect(modesTheFormOffers().length).toBeGreaterThan(0)
  })
})

describe('the form offers exactly the modes the API implements', () => {
  it('offers no mode that no endpoint requires', () => {
    const implemented = new Set(scopesWithAnEndpoint().map((s) => s.split(':')[1]!))
    const offered = modesTheFormOffers()
    const phantom = offered.filter((mode) => !implemented.has(mode))

    expect(
      phantom,
      `The key form offers ${phantom.join(', ')}, which no route under app/api/v1 ` +
        `ever requires. A customer can grant that scope and nothing will accept it.`,
    ).toEqual([])
  })

  it('offers every mode some endpoint DOES require', () => {
    /*
     * ⚠️ THE OTHER DIRECTION, AND THE REASON THIS FILE IS DERIVED RATHER THAN
     * HARDCODED. The day a write endpoint ships, the form silently offering
     * read-only would make the new capability unreachable — a feature built,
     * tested and ungrantable. That is the same defect this project keeps
     * finding, and it would arrive disguised as a passing test suite.
     */
    const implemented = [...new Set(scopesWithAnEndpoint().map((s) => s.split(':')[1]!))].sort()
    const offered = modesTheFormOffers()
    const missing = implemented.filter((mode) => !offered.includes(mode))

    expect(
      missing,
      `app/api/v1 has endpoints requiring ${missing.join(', ')} scopes, and the key ` +
        `form does not offer them — nobody can mint a key that reaches those routes.`,
    ).toEqual([])
  })
})
