/**
 * The product is flat; the marketing site is not.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  TWO THINGS CAN GO SILENTLY WRONG HERE, AND NEITHER SHOWS IN A DIFF.     ║
 * ║                                                                           ║
 * ║  1. Flattening the shadows is a search-and-replace away from also         ║
 * ║     flattening `--neo-shadow-focus`, which deletes the focus indicator    ║
 * ║     from every input in the product — an accessibility regression that    ║
 * ║     looks like a tidier stylesheet. Same for the `-lg` pair, which is     ║
 * ║     what floats every dropdown.                                           ║
 * ║                                                                           ║
 * ║  2. Moving the flat rules to `:root` — the obvious "simplification" —     ║
 * ║     restyles the landing page, which CLAUDE.md rule 5 forbids.            ║
 * ║                                                                           ║
 * ║  Both are asserted against the stylesheet because there is no type or     ║
 * ║  test that would otherwise notice.                                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const CSS = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8')

/** The `.product-clay, .auth-clay { … }` token block. */
function flatScopeBlock(): string {
  const start = CSS.indexOf('.product-clay,\n.auth-clay {')
  expect(start, 'the flat scope block is gone').toBeGreaterThan(-1)
  return CSS.slice(start, CSS.indexOf('\n}', start))
}

describe('the marketing site keeps its material', () => {
  it(':root still defines the cream canvas', () => {
    /*
     * ⚠️ VERIFIED NON-VACUOUS: changing `--clay-bg` in `:root` to #ffffff
     * fails this. The landing page reads these directly — it has no
     * `.product-clay` wrapper — so a "cleanup" that edits the base tokens
     * silently restyles a page that is supposed to be read-only.
     */
    const root = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('\n}', CSS.indexOf(':root {')))
    expect(root).toContain('--clay-bg: #fffaf0')
    expect(root).toContain('--radius-clay: 1rem')
  })

  it(':root still defines a real neumorphic shadow', () => {
    // The value, not just the name: `--neo-shadow: none` in :root would pass a
    // presence check while flattening the entire marketing site.
    const root = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('\n}', CSS.indexOf(':root {')))
    const match = root.match(/--neo-shadow:\s*([^;]+);/)
    expect(match, '--neo-shadow is missing from :root').not.toBeNull()
    expect(match![1]!.trim()).not.toBe('none')
    expect(match![1]).toContain('rgba')
  })

  it('the flat rules are scoped, never global', () => {
    /*
     * A bare `.clay { box-shadow: none }` would defeat the scoping and flatten
     * `/product` along with the app.
     *
     * ⚠️ ONLY THE MATERIAL VOCABULARY IS CHECKED. The first version flagged any
     * rule containing `box-shadow: none` and reported
     * `.leadengine-story-panel-inner-only` — a pre-existing marketing panel
     * that is deliberately transparent and has nothing to do with the flat
     * pass. A guard that fails on correct, untouched code is a guard someone
     * deletes rather than reads.
     *
     * `clay`, `hubble`, `field`, `skeuo` and `glass` are the five families the
     * flattening governs; those are the ones that must never be flattened
     * globally.
     */
    const MATERIAL = /\b(clay|hubble|field|skeuo|glass)/

    const flatRules = [...CSS.matchAll(/^(\.[a-z][^\n{]*)\{([^}]*)\}/gm)].filter(
      (rule) => /box-shadow:\s*none/.test(rule[2]!) && MATERIAL.test(rule[1]!),
    )

    // Non-vacuous: the flat pass created several of these.
    expect(flatRules.length).toBeGreaterThan(0)

    for (const rule of flatRules) {
      const selector = rule[1]!
      expect(
        /\.product-clay|\.auth-clay/.test(selector),
        `unscoped flat rule would hit the marketing site: ${selector.trim()}`,
      ).toBe(true)
    }
  })
})

describe('the product is flat', () => {
  const block = flatScopeBlock()

  it('paints white, not cream', () => {
    for (const token of ['--app', '--paper', '--panel', '--clay-bg', '--clay-surface']) {
      expect(block, `${token} is not white in the product`).toMatch(
        new RegExp(`${token}:\\s*#ffffff`),
      )
    }
  })

  it('flattens the panel shadows', () => {
    for (const token of ['--neo-shadow', '--clay-shadow', '--neo-shadow-inset']) {
      expect(block).toMatch(new RegExp(`${token}:\\s*none`))
    }
  })

  it('gives borders something to do', () => {
    // With no shadow, a barely-there border means a card with no edge.
    expect(block).toMatch(/--border:\s*#e6e6ea/)
    expect(block).toMatch(/--border-strong:\s*#d2d2d9/)
  })
})

describe('the two shadows that must survive flattening', () => {
  const block = flatScopeBlock()

  it('keeps a real focus ring', () => {
    /*
     * ⚠️ THE REGRESSION THIS EXISTS FOR. `--neo-shadow-focus: none` removes the
     * visible focus indicator from every auth and product input at once, and
     * nothing else in the suite would fail.
     */
    for (const token of ['--neo-shadow-focus', '--clay-shadow-focus']) {
      const match = block.match(new RegExp(`${token}:\\s*([^;]+);`))
      expect(match, `${token} is not set in the flat scope`).not.toBeNull()
      expect(match![1]!.trim(), `${token} was flattened away`).not.toBe('none')
      expect(match![1]).toContain('var(--focus)')
    }
  })

  it('keeps elevation for things that float', () => {
    /*
     * `shadow-[var(--clay-shadow-lg)]` is how the batch filter and the date
     * picker lift their dropdowns. Flattened, those menus are white
     * rectangles on a white page — no edge, no elevation, findable only by
     * clicking where they used to be.
     */
    for (const token of ['--neo-shadow-lg', '--clay-shadow-lg']) {
      const match = block.match(new RegExp(`${token}:\\s*([^;]+);`))
      expect(match, `${token} is not set in the flat scope`).not.toBeNull()
      expect(match![1]!.trim(), `${token} was flattened away`).not.toBe('none')
    }
  })

  it('bakes a hairline ring into the floating shadow', () => {
    // White on white: a blur alone leaves a dropdown's top edge invisible.
    const match = block.match(/--shadow-lg:\s*([^;]+);/)
    expect(match).not.toBeNull()
    expect(match![1]).toContain('0 0 0 1px var(--border)')
  })
})

describe('surfaces that stopped separating themselves', () => {
  it('the sidebar draws a border instead of an inset smear', () => {
    // The cream gradient flattened to white but the `inset -3px 0 0` dark bar
    // and 18px smoky shadow did not — they read as an artefact on white.
    const rule = CSS.slice(
      CSS.indexOf('.product-clay .hubble-nav-panel {'),
      CSS.indexOf('\n}', CSS.indexOf('.product-clay .hubble-nav-panel {')),
    )
    expect(rule).toContain('border-right: 1px solid var(--border)')
    expect(rule).toContain('box-shadow: none')
  })

  it('the sticky header has a bottom edge', () => {
    /*
     * White header, white page. Without a border the rows scroll underneath
     * and appear to be inside the header.
     */
    const shell = readFileSync(
      join(__dirname, '..', '..', 'components', 'product', 'ProductShell.tsx'),
      'utf8',
    )
    const header = shell.slice(shell.indexOf('<header'), shell.indexOf('>', shell.indexOf('<header')))
    expect(header).toContain('border-b border-border')
    expect(header).not.toContain('border-0')
  })
})
