/**
 * Every product surface a customer is meant to use must be in the sidebar.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `/linkedin` SHIPPED ROUTABLE, GATED, TESTED — AND UNREACHABLE.           ║
 * ║                                                                           ║
 * ║  The page existed, `proxy.ts` allowed it on the app host, the module gate  ║
 * ║  was checked twice, and 3569 tests passed. There was simply no link to it. ║
 * ║  The only way in was typing the URL.                                      ║
 * ║                                                                           ║
 * ║  `app-subdomain-proxy.test.ts` already catches the edge-guard half of this ║
 * ║  — its own comment records that /email and /flows were unreachable in      ║
 * ║  PRODUCTION because nobody added them to the host list. This is the other  ║
 * ║  half: the route resolves and no human can find it.                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THE RULE IS DELIBERATELY NARROW: a top-level segment under `app/(product)`
 * that has its own `page.tsx` is a destination, and a destination needs a door.
 * Nested routes (`/crm/contacts/[id]`) are reached FROM a destination and are
 * not the nav's job — a guard that demanded a link for every route would be
 * noise, and noisy guards get deleted.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const PRODUCT = join(ROOT, 'app', '(product)')
const NAV = readFileSync(join(ROOT, 'components/product/ProductNav.tsx'), 'utf8')

/** Top-level segments that are a destination in their own right. */
function destinations(): string[] {
  return readdirSync(PRODUCT)
    .filter((name) => {
      const full = join(PRODUCT, name)
      if (!statSync(full).isDirectory()) return false
      if (name.startsWith('[') || name.startsWith('(')) return false
      try {
        return statSync(join(full, 'page.tsx')).isFile()
      } catch {
        return false
      }
    })
    .sort()
}

/**
 * ⚠️ EACH ENTRY IS A DECISION, AND THE LIST MAY ONLY SHRINK.
 *
 * A segment here is one a customer reaches some way other than the sidebar. If
 * that stops being true, it belongs in the nav rather than in this list.
 */
const REACHED_ANOTHER_WAY = new Map<string, string>([
  [
    'dashboard',
    'The sidebar logo links to it, and every settings page lives beneath it. ' +
      'It has nav children of its own, so the check below finds them anyway.',
  ],
])

describe('the scanner sees what it polices', () => {
  it('finds the product destinations and the nav', () => {
    // Vacuity: an empty list would make every assertion below pass over nothing.
    const found = destinations()
    expect(found.length).toBeGreaterThanOrEqual(4)
    expect(found).toContain('crm')
    expect(NAV).toContain('NavSection')
  })

  it('would notice a link that is not there', () => {
    // Proves the matcher can return false, rather than matching everything.
    expect(NAV).not.toMatch(/href: '\/no-such-surface/)
  })
})

describe('every destination has a door', () => {
  it('is linked from the sidebar', () => {
    const missing = destinations().filter((segment) => {
      if (REACHED_ANOTHER_WAY.has(segment)) return false
      return !new RegExp(`href: '/${segment}\\b`).test(NAV)
    })

    expect(
      missing,
      `These product pages exist, resolve, and are gated correctly — and no ` +
        `link in the sidebar reaches them, so the only way in is typing the ` +
        `URL. That is how /linkedin shipped. Add a NavSection, or record why ` +
        `the surface is reached another way.`,
    ).toEqual([])
  })

  it('the LinkedIn surface is in the nav specifically', () => {
    /*
     * ⚠️ NAMED, NOT JUST COVERED BY THE SWEEP ABOVE. This is the one that was
     * actually missed, and a generic assertion passing tells you less than a
     * specific one failing.
     */
    expect(NAV).toMatch(/href: '\/linkedin'/)
    expect(NAV).toMatch(/href: '\/dashboard\/settings\/linkedin'/)
  })

  it('a module-gated section is hidden when the plan excludes it', () => {
    /*
     * ⚠️ THE OTHER DIRECTION. Adding a link that always renders would satisfy
     * the sweep above while showing every workspace a channel they cannot use —
     * and clicking it lands on "not enabled on your plan", which reads as the
     * product being broken rather than as an upsell.
     */
    expect(NAV).toMatch(/showLinkedIn \? \[LINKEDIN_SECTION\] : \[\]/)
    expect(NAV).toMatch(/showLinkedIn\?: boolean/)
  })

  it('the flag comes from the workspace modules, not a hardcoded true', () => {
    const layout = readFileSync(join(ROOT, 'app/(product)/layout.tsx'), 'utf8')
    expect(layout).toMatch(/showLinkedIn=\{workspace\?\.modules\.has\('linkedin'\) \?\? false\}/)
  })

  it('every recorded exception still exists', () => {
    /*
     * ⚠️ ASSERTED IN BOTH DIRECTIONS. An exemption for a segment that has been
     * deleted is a note nobody will ever read, and it makes the list look
     * shorter than the decisions it actually holds.
     */
    const found = new Set(destinations())
    for (const segment of REACHED_ANOTHER_WAY.keys()) {
      expect(found.has(segment), `${segment} is exempt but no longer exists`).toBe(true)
    }
  })
})
