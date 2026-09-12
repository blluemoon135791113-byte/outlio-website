/**
 * The product's card surface — flat, bordered, tight-cornered.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `.clay` MEANS SOMETHING DIFFERENT INSIDE `.product-clay`, AND THAT IS    ║
 * ║  EASY TO MISS.                                                            ║
 * ║                                                                           ║
 * ║  On the marketing site it is a cream neumorphic object. In the product the ║
 * ║  same class resolves to white, a hairline border, no shadow, and a         ║
 * ║  TIGHTER radius. The class name was deliberately kept — DESIGN_TOKENS      ║
 * ║  records that renaming it across 62 files "is a large diff that changes no ║
 * ║  pixel" — so the only thing telling you the product is flat is the token   ║
 * ║  override.                                                                ║
 * ║                                                                           ║
 * ║  Which means a hand-built panel looks right in isolation and wrong next    ║
 * ║  to everything else. That is exactly what happened to the stat cards.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const CSS = readFileSync(join(ROOT, 'app/globals.css'), 'utf8')
/*
 * ⚠️ COMMENTS ARE STRIPPED BEFORE MATCHING, and this guard failed without it on
 * its very first run — the note in `StatCard` explaining which classes were
 * REMOVED contains the strings the assertions forbid. That trap has caught this
 * repository more than once, which is why every other source-reading test here
 * strips first.
 */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(join(ROOT, p), 'utf8'))

function walkTsx(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry)
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walkTsx(rel))
    else if (rel.endsWith('.tsx')) out.push(rel)
  }
  return out
}

/** The `.product-clay, .auth-clay` token block. */
const PRODUCT_SCOPE = (() => {
  const start = CSS.indexOf('.product-clay')
  const end = CSS.indexOf('\n}', CSS.indexOf('--radius-clay-lg', start))
  return CSS.slice(start, end)
})()

describe('the product token overrides hold', () => {
  it('tightens the card radius rather than inheriting the marketing one', () => {
    /*
     * DESIGN_TOKENS: "A large radius reads as 'soft object'; a small one reads
     * as 'region of a page', which is what these now are." If this drifts back
     * to 1rem, 120 cards change shape at once and nothing else in the repo
     * would notice.
     */
    expect(PRODUCT_SCOPE).toMatch(/--radius-clay:\s*0\.625rem/)
  })

  it('keeps the neumorphic shadows flattened', () => {
    // The whole point of the flat pass. `--neo-shadow` is still referenced by
    // markup and by rules further down the file; neutralising it at the source
    // is what makes those flatten too.
    expect(PRODUCT_SCOPE).toMatch(/--neo-shadow:\s*none/)
  })

  it('does not flatten the focus ring along with them', () => {
    /*
     * ⚠️ DESIGN_TOKENS calls this out by name: setting `--neo-shadow-focus` to
     * none alongside the others removes the focus indicator from every input in
     * the product — "an accessibility regression wearing a visual cleanup's
     * clothes".
     */
    expect(PRODUCT_SCOPE).not.toMatch(/--neo-shadow-focus:\s*none/)
  })
})

describe('static panels use the surface class, not a hand-built one', () => {
  const SURFACES = ['components/product/StatCard.tsx', 'components/product/PerformanceRow.tsx']

  it('renders cards with `clay`', () => {
    for (const file of SURFACES) {
      expect(read(file), `${file} does not use the product surface class`).toMatch(
        /className=\{?[`"]clay/,
      )
    }
  })

  it('gives a panel that does not float no shadow', () => {
    /*
     * The token block says it outright: "Panels get NO shadow — these remain
     * for genuinely floating things." A bordered panel carrying a drop shadow
     * is the marketing material leaking back in.
     */
    for (const file of SURFACES) {
      expect(read(file), `${file} shadows a static panel`).not.toContain(
        'shadow-[var(--shadow-sm)]',
      )
    }
  })

  it('does not reach for the marketing radius', () => {
    // `--radius-xl` is 1rem and is NOT overridden in the product scope, so
    // using it puts a card 6px out of step with every other card on the page.
    for (const file of SURFACES) {
      expect(read(file), `${file} uses --radius-xl`).not.toContain('var(--radius-xl)')
    }
  })
})

describe('floating surfaces still get their shadow', () => {
  it('the command palette keeps one, because it genuinely floats', () => {
    /*
     * ⚠️ THE DISTINCTION, NOT AN EXCEPTION. Shadow means "this floats and will
     * go away" — menus, popovers, dialogs. A dialog without one is white on
     * white with an undetectable edge, which is why `--shadow-lg` bakes a
     * hairline ring into itself.
     */
    const palette = read('components/product/CommandPalette.tsx')
    expect(palette).toContain('shadow-[var(--shadow-lg)]')
  })
})

/**
 * ⚠️ THE RULE ACROSS THE WHOLE PRODUCT, NOT JUST THE FILES I TOUCHED.
 *
 * A guard scoped to two components would let the next hand-built panel drift
 * exactly as these did, and there is no reason to believe I am the only person
 * who will reach for `border + shadow` without reading the token block.
 */
describe('no static product panel carries a drop shadow', () => {
  const files = walkTsx('components').concat(walkTsx('app/(product)'))

  /*
   * ⚠️ A RATCHET, AND IT MAY ONLY SHRINK. Four of the five original entries
   * were fixed and have left: ExtensionCard, RequestOptions,
   * ExtractionDashboard and ProfileManager. Each was measured in a browser
   * before and after — the panels rendered at a 16px radius with a drop
   * shadow, against the product's 10px and none — rather than changed on the
   * strength of a grep.
   *
   * ⚠️ THE ONE THAT REMAINS IS NOT A PANEL, AND FIXING IT WOULD BE WRONG.
   * `UploadForm`'s entry is a 40x40 icon chip — measured as `SPAN 40x40`, not
   * a section — and DESIGN_TOKENS' rule is about PANELS: "a panel that sits on
   * the page gets a border, never a shadow". A small raised chip is a
   * different object making a different claim, and stripping its shadow to
   * satisfy a regex would be letting the guard design the interface.
   *
   * It stays listed rather than pattern-exempted because a size-based
   * exemption is exactly the kind of rule that quietly grows to cover things
   * it should not.
   *
   * `components/leadengine/**` is absent on purpose: that is the MARKETING
   * site, where the neumorphic material is correct and CLAUDE.md rule 5 makes
   * it read-only.
   */
  const KNOWN = new Set(
    ['components/upload/UploadForm.tsx'].map((f) => f.replace(/\//g, sep)),
  )

  it('finds only the known ones', () => {
    const offenders = files.filter((f) => {
      if (f.includes(`components${sep}leadengine`)) return false
      const source = strip(readFileSync(join(ROOT, f), 'utf8'))
      return /border border-border bg-panel[^"]*shadow-\[var\(--shadow-sm\)\]/.test(source)
    })

    expect(
      offenders.filter((f) => !KNOWN.has(f)),
      'A panel that sits on the page gets a border, never a shadow — DESIGN_TOKENS. ' +
        'Use `clay`, which already resolves to the right surface inside .product-clay.',
    ).toEqual([])
  })

  it('the known list is not stale', () => {
    // An entry that has been fixed must leave, or the list stops meaning
    // anything — the same both-directions rule the orphan guard uses.
    for (const known of KNOWN) {
      const source = strip(readFileSync(join(ROOT, known), 'utf8'))
      expect(
        /border border-border bg-panel[^"]*shadow-\[var\(--shadow-sm\)\]/.test(source),
        `${known} is listed as an offender but no longer is — remove it`,
      ).toBe(true)
    }
  })
})
