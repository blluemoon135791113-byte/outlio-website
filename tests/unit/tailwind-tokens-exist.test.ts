/**
 * Every colour utility the app writes must resolve to a real token.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A MISSING TAILWIND TOKEN IS COMPLETELY SILENT.                          ║
 * ║                                                                           ║
 * ║  `bg-surface` and `border-line` were written 190 times across 54 files —  ║
 * ║  including every input in the "New deal" and "New pipeline" forms — and   ║
 * ║  neither `--color-surface` nor `--color-line` existed. Tailwind emitted   ║
 * ║  nothing for them.                                                        ║
 * ║                                                                           ║
 * ║  Nothing catches this. `tsc` sees a string. ESLint sees a string. The     ║
 * ║  build succeeds. The class looks deliberate in the source and produces    ║
 * ║  the wrong pixel: `bg-surface` left the background transparent, and       ║
 * ║  `border border-line` fell back to `currentColor`, so a divider meant to  ║
 * ║  be a hairline rendered in the element's TEXT colour.                     ║
 * ║                                                                           ║
 * ║  ⚠️ SCANS SOURCE, NOT A FIXED LIST. A test naming today's tokens would    ║
 * ║  pass forever while a new phantom class spread through the codebase.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const CSS = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8')

/** Every `--color-*` name declared in the `@theme` block. */
function declaredColors(): Set<string> {
  const theme = CSS.slice(CSS.indexOf('@theme inline {'))
  return new Set([...theme.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]!))
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (full.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * Prefixes whose value is ALWAYS a colour.
 *
 * ⚠️ `text-` IS DELIBERATELY EXCLUDED, and the first version of this test did
 * not exclude it. `text-` is Tailwind's most overloaded namespace — `text-sm`,
 * `text-center`, `text-balance`, `text-pretty` are size, alignment and
 * wrapping — so scanning it reported 578 "phantom" tokens, every one of them
 * a false positive. A test that cries wolf at that volume gets deleted, not
 * read. Narrow and trustworthy beats broad and ignored.
 *
 * Arbitrary values (`bg-[#fff]`) and opacity suffixes (`bg-panel/40`) fall out
 * naturally: the capture stops at `[` and `/`.
 */
const COLOR_PREFIXES = ['bg', 'border', 'divide', 'ring', 'fill', 'stroke']

/**
 * Values that are legal in those namespaces WITHOUT being colours — sizes,
 * styles, directions and background geometry.
 */
const NON_COLOR = new Set([
  // background geometry / repeat / attachment / gradients
  'cover', 'contain', 'center', 'fixed', 'local', 'scroll', 'repeat', 'no',
  'top', 'bottom', 'left', 'right', 'origin', 'clip', 'blend', 'auto', 'none',
  // border & divide styles, widths, sides
  'solid', 'dashed', 'dotted', 'double', 'hidden', 'collapse', 'separate',
  'x', 'y', 't', 'r', 'b', 'l', 's', 'e', 'reverse', 'spacing',
  // ring geometry
  'inset', 'offset',
  // shared
  'opacity', 'transparent', 'current', 'inherit', 'black', 'white',
  // `bg-gradient-to-br` names a direction, not a colour.
  'gradient',
])

/** Tailwind's own palette families; used as `bg-red-500`. */
const BUILT_IN = new Set([
  'red', 'green', 'blue', 'gray', 'grey', 'slate', 'zinc', 'neutral', 'stone',
  'amber', 'yellow', 'lime', 'emerald', 'teal', 'cyan', 'sky', 'indigo',
  'violet', 'purple', 'fuchsia', 'pink', 'rose', 'orange',
])

describe('colour utilities resolve to declared tokens', () => {
  const declared = declaredColors()
  const files = sourceFiles(join(ROOT, 'app')).concat(sourceFiles(join(ROOT, 'components')))

  it('finds the theme block and a plausible number of tokens', () => {
    // Guards the scanner itself: a rename of `@theme inline` would otherwise
    // make every assertion below vacuously true against an empty set.
    expect(declared.size).toBeGreaterThan(20)
    expect(declared.has('panel')).toBe(true)
    expect(files.length).toBeGreaterThan(50)
  })

  it('has no utility pointing at a token that does not exist', () => {
    const phantom = new Map<string, string[]>()
    const pattern = new RegExp(
      `\\b(?:hover:|focus:|active:|group-hover:|focus-visible:|disabled:|sm:|md:|lg:|xl:)*(${COLOR_PREFIXES.join('|')})-([a-z][a-z0-9-]*)\\b`,
      'g',
    )

    for (const file of files) {
      /*
       * ⚠️ ONLY `className` VALUES, WITH ARBITRARY VALUES STRIPPED.
       *
       * Scanning raw source reported `ring-shine` and `ring-glow` from
       * `<linearGradient id="ring-shine">` — SVG element ids, not classes —
       * and `border-color` from inside `transition-[border-color,box-shadow]`,
       * where it is a CSS property name. Both are false positives that would
       * have taught the next reader to ignore this test.
       */
      const raw = readFileSync(file, 'utf8')
      const source = [...raw.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)]
        .map((m) => m[1] ?? m[2] ?? m[3] ?? '')
        .join(' ')
        // Arbitrary values hold CSS, not tokens: `transition-[border-color]`.
        .replace(/\[[^\]]*\]/g, ' ')

      for (const match of source.matchAll(pattern)) {
        const name = match[2]!
        if (declared.has(name)) continue
        // The first segment decides: `bg-gradient-to-br` is geometry, not colour.
        const head = name.split('-')[0]!
        if (NON_COLOR.has(head)) continue
        // `bg-red-500` and friends.
        if (BUILT_IN.has(head)) continue
        /*
         * A directional colour — `border-t-accent` — is `t` plus a token.
         * Re-check the remainder rather than reporting the whole string.
         */
        if (/^[trblxyse]-/.test(name) && declared.has(name.slice(2))) continue

        if (!phantom.has(name)) phantom.set(name, [])
        phantom.get(name)!.push(file.replace(`${ROOT}/`, ''))
      }
    }

    /*
     * ⚠️ VERIFIED NON-VACUOUS: deleting `--color-line` from `@theme` reports
     * `line` here with the files that use it.
     */
    const report = [...phantom.entries()]
      .map(([name, where]) => `  ${name} — ${where.length} file(s), e.g. ${where[0]}`)
      .join('\n')

    expect(phantom.size, `utilities with no matching --color-* token:\n${report}`).toBe(0)
  })

  it('the two that shipped broken are now declared', () => {
    // Named explicitly so the regression is documented, not just prevented.
    expect(declared.has('surface'), '--color-surface is missing again').toBe(true)
    expect(declared.has('line'), '--color-line is missing again').toBe(true)
  })
})
