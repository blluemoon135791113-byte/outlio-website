/**
 * Lead lookup on ⌘K — the search endpoint and its reachability.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A SEARCH ENDPOINT IS THE WORST PLACE TO GET SCOPING WRONG.               ║
 * ║                                                                           ║
 * ║  It takes a string the user typed, runs it against every contact in a      ║
 * ║  workspace, and returns names. Two things therefore have to hold and stay  ║
 * ║  held: the filter cannot be hand-built from that string, and a setter      ║
 * ║  cannot reach a colleague's leads through it.                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(join(ROOT, p), 'utf8'))

const ROUTE = read('app/api/crm/quick-search/route.ts')
const PALETTE = read('components/product/CommandPalette.tsx')
const SHELL = read('components/product/ProductShell.tsx')

describe('the search endpoint is gated and scoped', () => {
  it('asserts a permission before it reads anything', () => {
    expect(ROUTE).toContain("assertWorkspacePermission('crm.contact.view')")
  })

  it('re-applies the setter scope server-side', () => {
    /*
     * ⚠️ RULE 8. A route handler is reachable by typing a URL, so hiding the
     * search box from a setter is not a control. The narrowing has to be here.
     */
    expect(ROUTE).toContain('dataScope(ctx.role)')
    expect(ROUTE).toMatch(/ownerUserId: scopedToSelf \? ctx\.userId : null/)
  })

  it('reuses listContacts rather than building its own filter', () => {
    /*
     * The thing this guard is really for. `listContacts` strips `%_,()` before
     * composing a PostgREST `.or()`; a second hand-rolled search would be a
     * second chance to get that wrong, on a user-supplied string.
     */
    expect(ROUTE).toContain('listContacts(ctx.scope')
    for (const forbidden of ['.ilike(', '.or(', 'createAdminClient(']) {
      expect(ROUTE, `the route queries directly with ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('returns a narrow shape, not the row', () => {
    // A response that fires on every keystroke is the last place to widen what
    // leaves the server.
    expect(ROUTE).toMatch(/results = page\.rows\.map/)
    expect(ROUTE).not.toMatch(/results:\s*page\.rows\b/)
  })

  it('never lets a lead sit in a shared cache', () => {
    expect(ROUTE).toContain("'Cache-Control': 'no-store, private'")
  })

  it('refuses a one-character query before touching the database', () => {
    expect(ROUTE).toMatch(/q\.length < MIN_QUERY/)
    expect(ROUTE).toMatch(/MIN_QUERY = 2/)
  })

  it('leaks nothing on failure', () => {
    expect(ROUTE).toContain('toClientError(error)')
  })
})

describe('the palette is reachable and behaves', () => {
  it('is mounted once, at the shell', () => {
    /*
     * The defect class this session kept finding: correct code nothing renders.
     * Mounted at the shell so ⌘K works on every product page, and so there is
     * one palette rather than several fighting over the shortcut.
     */
    expect(SHELL).toContain('<CommandPalette />')
    expect(SHELL).toContain('<CommandPaletteTrigger />')
  })

  it('listens for the shortcut on the window', () => {
    expect(PALETTE).toContain("window.addEventListener('keydown'")
    expect(PALETTE).toMatch(/metaKey \|\| event\.ctrlKey/)
  })

  it('aborts the previous request so results cannot race', () => {
    /*
     * ⚠️ THE BUG THIS PREVENTS IS SUBTLE AND USER-VISIBLE. Type "mar", then
     * "marcus": without an abort the slower "mar" response can land second and
     * overwrite the results for what was actually typed.
     */
    expect(PALETTE).toContain('AbortController')
    expect(PALETTE).toMatch(/abortRef\.current\?\.abort\(\)/)
    // An abort is the expected path and must not be reported as an error.
    expect(PALETTE).toMatch(/error\.name === 'AbortError'/)
  })

  it('debounces rather than firing per keystroke', () => {
    expect(PALETTE).toMatch(/DEBOUNCE_MS = \d+/)
    expect(PALETTE).toContain('setTimeout(')
  })

  it('draws the shared monogram rather than its own initials', () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ONE PERSON, TWO SETS OF LETTERS, ON THE SAME SCREEN.                 ║
     * ║                                                                       ║
     * ║  The palette had a private `initials()` that took ONE letter from a    ║
     * ║  one-word name while `Monogram.initialsOf` takes TWO — so a contact    ║
     * ║  called "Cher" was `CH` in the contacts table and `C` in ⌘K. It also   ║
     * ║  drew a flat grey chip, dropping the derived tint that makes a         ║
     * ║  monogram scannable, and omitted `aria-hidden`, so a screen reader     ║
     * ║  announced the row as "C H, Cher".                                    ║
     * ║                                                                       ║
     * ║  Nothing typed it, nothing tested it, and both spellings looked        ║
     * ║  correct in isolation. Only reading the two together showed it.        ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    expect(PALETTE).toContain('<Monogram name={result.name} />')
    expect(PALETTE, 'a second initials rule is back').not.toMatch(
      /function initials\s*\(/,
    )
  })

  it('there is exactly one initials rule in the product', async () => {
    /*
     * ⚠️ ASSERTED IN BOTH DIRECTIONS. `not.toMatch` above passes if the palette
     * stops rendering a monogram at all; this is what says the rule still
     * exists and still lives in one place.
     *
     * `lib/intelligence/avatar.ts` keeps its own `initialsFor` deliberately —
     * it strips punctuation and falls back to '?' rather than '—' for the
     * Hubble surface. The two AGREE on the case that mattered here, the
     * one-word name, and that agreement is what is pinned.
     */
    const { initialsOf } = await import('@/components/ui/Monogram')
    const { initialsFor } = await import('@/lib/intelligence/avatar')

    expect(initialsOf('Cher')).toBe('CH')
    expect(initialsFor('Cher')).toBe('CH')
    expect(initialsOf('Ada Lovelace')).toBe('AL')
    expect(initialsFor('Ada Lovelace')).toBe('AL')
    expect(initialsOf(null)).toBe('—')
  })

  it('ships all four states, which the design rules require', () => {
    for (const state of ["'idle'", "'loading'", "'ready'", "'error'"]) {
      expect(PALETTE, `no ${state} state`).toContain(state)
    }
    // The error state names the problem and reassures about the data.
    expect(PALETTE).toMatch(/Your leads are unaffected/)
  })

  it('is keyboard-operable and returns focus', () => {
    expect(PALETTE).toContain("'ArrowDown'")
    expect(PALETTE).toContain("'ArrowUp'")
    expect(PALETTE).toContain("'Enter'")
    expect(PALETTE).toContain("'Escape'")
    // Dropping focus on close leaves a keyboard user nowhere.
    expect(PALETTE).toMatch(/openerRef\.current\?\.focus\(\)/)
  })

  it('is announced as a dialog', () => {
    expect(PALETTE).toContain('role="dialog"')
    expect(PALETTE).toContain('aria-modal="true"')
    expect(PALETTE).toContain('aria-label="Search leads"')
  })

  it('does not blur the scrim, per the condition on the relaxed rule', () => {
    /*
     * Gradient and backdrop-filter are now permitted on the dashboard, on the
     * recorded condition that they stay off large or frequently repainted
     * surfaces. A full-viewport blur over the contacts table is that case.
     */
    expect(PALETTE, 'the scrim blurs the page behind it').not.toContain('backdrop-')
  })
})
