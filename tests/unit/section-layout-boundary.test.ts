/**
 * A page that defers its refusal to a layout must have one.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ TWENTY-TWO PAGES SAY "THE LAYOUT RENDERS THE REASON". ONE HAD NO      ║
 * ║  LAYOUT.                                                                  ║
 * ║                                                                           ║
 * ║  The pattern is sound: the section layout is the access boundary, and a    ║
 * ║  page below it writes                                                     ║
 * ║                                                                           ║
 * ║      const ctx = await workspaceContextIfPermitted('crm.contact.view')     ║
 * ║      // The layout renders the reason; this only stops the page computing. ║
 * ║      if (!ctx) return null                                                ║
 * ║                                                                           ║
 * ║  `/linkedin/page.tsx` copied that sentence from `/crm/reports`, where      ║
 * ║  `crm/layout.tsx` genuinely does render the reason. LinkedIn had no        ║
 * ║  layout, so `return null` fell through to NOTHING: a member without the    ║
 * ║  permission got the shell with an empty middle and no explanation.        ║
 * ║                                                                           ║
 * ║  ⚠️ IT LOOKED CORRECT IN REVIEW, because the comment asserts the thing     ║
 * ║  that was missing. Nothing but the filesystem could tell.                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Found by measuring the rendered page, not by reading it: every other product
 * section reported one `<h1>` on a phone viewport and `/linkedin` reported
 * zero — because the heading comes from these same layouts.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const PRODUCT = join(ROOT, 'app/(product)')

function pages(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name === 'page.tsx') out.push(full)
    }
  }
  walk(dir)
  return out
}

/**
 * ⚠️ MATCHED ON THE CODE, NOT THE SENTENCE — and this guard got that wrong
 * first. It selected pages containing "layout renders the reason", so when the
 * settings page was FIXED and its new comment QUOTED the old sentence to explain
 * the change, the page still matched and the guard still failed. A check that
 * reads prose reports the explanation as the defect.
 *
 * The deferral is `if (!ctx) return null` after a permission check: the page
 * computes nothing and renders nothing, trusting something above it to speak.
 */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const DEFERRING = pages(PRODUCT).filter((file) => {
  const body = strip(readFileSync(file, 'utf8'))
  return (
    /workspaceContextIfPermitted\(/.test(body) && /if \(!ctx\) return null/.test(body)
  )
})

/**
 * Walks up from a page to the nearest `layout.tsx` that actually refuses.
 *
 * ⚠️ "HAS A LAYOUT" IS NOT THE QUESTION — `app/(product)/layout.tsx` exists and
 * renders the shell for everything, so merely finding one would pass for every
 * page including the broken one. The question is whether an ancestor layout
 * DECIDES: calls `decidePermission` and returns a refusal.
 */
function refusingAncestor(page: string): string | null {
  let dir = dirname(page)
  const stop = dirname(PRODUCT)
  while (dir.startsWith(stop)) {
    const layout = join(dir, 'layout.tsx')
    if (existsSync(layout)) {
      const source = readFileSync(layout, 'utf8')
      if (source.includes('decidePermission')) return relative(ROOT, layout)
    }
    if (dir === PRODUCT) break
    dir = dirname(dir)
  }
  return null
}

describe('the scanner sees what it polices', () => {
  it('finds the pages that defer', () => {
    // Vacuity: if the sentence is reworded, this list empties and the
    // assertion below passes over nothing.
    expect(DEFERRING.length).toBeGreaterThanOrEqual(20)
  })

  it('does not count the shell layout as a refusal', () => {
    /*
     * ⚠️ PROVES THE CHECK IS ABOUT REFUSING, NOT EXISTING. `app/(product)/
     * layout.tsx` wraps every page; if it counted, `/linkedin` would have
     * passed while rendering a blank panel.
     */
    const shell = join(PRODUCT, 'layout.tsx')
    expect(existsSync(shell), 'the product shell layout moved').toBe(true)
    expect(readFileSync(shell, 'utf8')).not.toContain('decidePermission')
  })
})

describe('every deferring page has a layout that actually refuses', () => {
  it('none of them falls through to a blank screen', () => {
    const orphans = DEFERRING.filter((page) => refusingAncestor(page) === null).map((p) =>
      relative(ROOT, p),
    )

    expect(
      orphans,
      'These pages return null when the permission check fails and rely on a ' +
        'section layout to explain why — but no ancestor layout calls ' +
        '`decidePermission`. The user gets the shell with an empty middle, ' +
        'which reads as broken rather than refused. Add a section layout.',
    ).toEqual([])
  })

  it('linkedin specifically, since it is the one that was missing', () => {
    /*
     * Named rather than left to the sweep: it is the newest section and the
     * only one ever built without a layout, so a future rewrite is most likely
     * to drop it again here.
     */
    const layout = join(PRODUCT, 'linkedin/layout.tsx')
    expect(existsSync(layout), '/linkedin lost its layout again').toBe(true)
    const source = readFileSync(layout, 'utf8')
    expect(source).toContain('decidePermission')
    expect(source, 'the layout no longer supplies the page heading').toMatch(/<h1/)
    /*
     * ⚠️ THE SAME PERMISSION THE PAGE ASKS FOR. `linkedin` is a module with no
     * permission of its own; gating the layout on something else would put the
     * two on different questions and reintroduce the blank panel for anyone in
     * the gap between them.
     */
    expect(source).toContain("'crm.contact.view'")
  })
})

describe('each product section supplies exactly one page heading', () => {
  it('the refusing layouts carry an h1', () => {
    /*
     * The heading and the boundary live together deliberately: a section with
     * no layout has neither, which is how `/linkedin` came to start its
     * document outline at `<h2>`.
     */
    for (const section of ['crm', 'email', 'flows', 'linkedin', 'dashboard/settings']) {
      const layout = join(PRODUCT, section, 'layout.tsx')
      expect(existsSync(layout), `${section} has no layout`).toBe(true)
      expect(readFileSync(layout, 'utf8'), `${section}'s layout has no h1`).toMatch(/<h1/)
    }
  })
})
