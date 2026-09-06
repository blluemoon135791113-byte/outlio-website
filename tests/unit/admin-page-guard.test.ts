/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  EVERY PAGE UNDER /admin MUST GATE ITSELF.                               ║
 * ║                                                                           ║
 * ║  Found by mutation testing: replacing `requireAdmin()` in                  ║
 * ║  `app/admin/page.tsx` with a fake context left all 3,021 tests green.     ║
 * ║                                                                           ║
 * ║  `app/admin/layout.tsx` also calls it, and because `requireAdmin()`        ║
 * ║  REDIRECTS, a full page load is safe. The layout's own comment gives the   ║
 * ║  reason that is not enough: "Next can render a route without re-running a  ║
 * ║  parent layout in some navigation paths". On a client-side navigation     ║
 * ║  that reuses the cached layout, the page runs ALONE and its own call is    ║
 * ║  the only thing standing between a non-admin and every user's email,      ║
 * ║  role, plan and the audit log.                                            ║
 * ║                                                                           ║
 * ║  This is the same principle as the RSC payload leak fixed across 20       ║
 * ║  product pages: a parent that refuses is not a boundary the child can     ║
 * ║  rely on.                                                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const ADMIN = join(ROOT, 'app/admin')

/** Every page and route handler beneath app/admin, however deeply nested. */
function entryPoints(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...entryPoints(path))
    else if (entry.name === 'page.tsx' || entry.name === 'route.ts') out.push(path)
  }
  return out
}

/**
 * ⚠️ COMMENTS STRIPPED FIRST. `app/admin/page.tsx` mentions `requireAdmin()`
 * in a comment explaining why it repeats the layout's call — so a search of
 * the raw source passes on the strength of the prose alone, even with the real
 * call deleted. The same trap `action-reachability.test.ts` hit.
 */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

describe('admin surfaces gate themselves', () => {
  const pages = entryPoints(ADMIN)

  it('finds the admin pages at all', () => {
    // A test that silently walks an empty directory proves nothing. If /admin
    // moves, this must fail rather than pass vacuously.
    expect(pages.length).toBeGreaterThan(0)
    expect(pages.map((p) => relative(ROOT, p))).toContain('app/admin/page.tsx')
  })

  for (const page of pages) {
    const name = relative(ROOT, page)

    it(`${name} calls an admin gate in its own body`, () => {
      const source = code(page)
      expect(
        /\b(requireAdmin|assertAdmin)\s*\(/.test(source),
        `${name} relies on app/admin/layout.tsx to refuse. A layout is not an ` +
          'authorization boundary: Next can render a route without re-running a ' +
          'parent layout, and the page would then serialise admin-only data into ' +
          'the RSC payload for whoever asked.',
      ).toBe(true)
    })
  }

  it('does not accept a mention of the gate in a comment', () => {
    /*
     * Proves the comment-stripping is load-bearing. Without it this whole file
     * passes on documentation rather than code — exactly how `enrolContacts`
     * shipped unwired behind a green reachability test, because a comment
     * happened to name it.
     */
    const stripped = code(join(ADMIN, 'page.tsx'))
    expect(stripped).not.toContain('Repeated deliberately')

    const pretender = `
      // const ctx = await requireAdmin()
      /* requireAdmin() guards this page */
      export default async function Page() { return null }
    `
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
    expect(/\b(requireAdmin|assertAdmin)\s*\(/.test(pretender)).toBe(false)
  })
})
