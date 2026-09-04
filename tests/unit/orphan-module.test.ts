/**
 * No module under `lib/` may exist with nothing but its own test importing it.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `lib/crm/custom-fields.ts` IS 326 LINES, HANDLES EIGHT FIELD TYPES, HAS  ║
 * ║  A PASSING TEST FILE, AND IS IMPORTED BY NOTHING.                        ║
 * ║                                                                           ║
 * ║  Both tables behind it — `crm_custom_field_definitions` and               ║
 * ║  `crm_custom_field_values` — are empty in production. There is no UI to   ║
 * ║  define a custom field and no read path that renders one.                ║
 * ║                                                                           ║
 * ║  ⚠️ A FULLY-TESTED MODULE WITH NO IMPORTERS IS INDISTINGUISHABLE FROM A   ║
 * ║  LIBRARY. `tsc` sees exported symbols and is satisfied. ESLint's          ║
 * ║  unused-vars rule works inside a file, never across one. The test suite   ║
 * ║  imports it, so coverage looks fine. Every signal says "healthy code".    ║
 * ║                                                                           ║
 * ║  The cost is not the dead bytes. It is that the next person reads the     ║
 * ║  file, the tests and the schema, and concludes the product HAS custom     ║
 * ║  fields.                                                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry)
    if (statSync(join(ROOT, rel)).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      out.push(...walk(rel))
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(rel)
    }
  }
  return out
}

const LIB = walk('lib')
const CONSUMERS = [...walk('app'), ...walk('components'), ...LIB, ...walk('extensions')]

const SOURCE = new Map(
  [...new Set([...CONSUMERS, ...walk('tests')])].map((f) => [
    f,
    readFileSync(join(ROOT, f), 'utf8'),
  ]),
)

/**
 * Resolve one import specifier to a repo-relative file, or null for a package.
 *
 * ⚠️ BOTH FORMS MUST BE HANDLED, AND THE FIRST VERSION OF THIS FILE HANDLED
 * ONLY ONE. Matching just `@/lib/...` missed every relative import and reported
 * all seventeen `lib/intelligence/providers/*` as orphans — they are imported by
 * `providers/index.ts` as `'./github'`, `'./wikidata'` and so on. A guard that
 * accuses seventeen live modules gets muted, and then it protects nothing.
 */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = spec.slice(2)
  else if (spec.startsWith('.')) base = join(dirname(fromFile), spec)
  else return null

  base = base.replace(/\\/g, '/')
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (SOURCE.has(candidate.replace(/\//g, sep))) return candidate.replace(/\//g, sep)
  }
  return null
}

/**
 * Reverse import graph: module → files that import it.
 *
 * Built once from real specifiers rather than per-module regex, so a prefix can
 * never be mistaken for a match (`@/lib/crm/contact` vs `contact-actions`).
 */
const IMPORTERS = (() => {
  const graph = new Map<string, { production: string[]; tests: string[] }>()
  for (const [file, code] of SOURCE) {
    for (const match of code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const target = resolveSpecifier(file, match[1]!)
      if (!target || target === file) continue
      const entry = graph.get(target) ?? { production: [], tests: [] }
      if (file.startsWith('tests')) entry.tests.push(file)
      else entry.production.push(file)
      graph.set(target, entry)
    }
  }
  return graph
})()

/**
 * Files that import the given module, excluding the module itself.
 *
 * ⚠️ TESTS ARE COUNTED SEPARATELY, NOT AS IMPORTERS. That distinction IS the
 * guard: `custom-fields.ts` has a test importing it, and if a test counted the
 * module would look alive. A module whose only importer is its own test is
 * precisely the thing being detected.
 */
function importersOf(file: string): { production: string[]; tests: string[] } {
  return IMPORTERS.get(file) ?? { production: [], tests: [] }
}

/**
 * Modules known to have no production importer today.
 *
 * ⚠️ THIS LIST MAY ONLY EVER SHRINK, and every entry needs a decision attached
 * — wire it up or delete it. An entry that sits here for a release is a feature
 * the product does not have and appears to.
 */
const KNOWN_ORPHANS = new Set(
  [
    // Phase 0, evidence #4. 326 lines, eight field types, two empty tables.
    'lib/crm/custom-fields.ts',
    /*
     * The four below were found by this guard, NOT by Phase 0's manual audit —
     * which is the argument for the guard. Each has a test file and no
     * production caller. Verified individually before being listed here; the
     * near-miss to avoid is `lib/fastspring/access.ts`, which greps as busy
     * only because `lib/auth/access.ts` shares its basename.
     */
    'lib/companies/links.ts',
    'lib/fastspring/access.ts',
    'lib/integrations/catalogue.ts',
    'lib/jobs/lead-pagination.ts',
  ].map((p) => p.replace(/\//g, sep)),
)

describe('the scanner itself', () => {
  it('sees the lib tree', () => {
    expect(LIB.length).toBeGreaterThan(50)
  })

  it('detects a real importer', () => {
    // Guards against a specifier-building bug silently reporting everything as
    // an orphan, which would make the allowlist meaningless.
    const { production } = importersOf('lib/crm/contacts-list.ts')
    expect(production.length).toBeGreaterThan(0)
  })

  it('resolves relative imports, not just @/ ones', () => {
    /*
     * ⚠️ THE REGRESSION THIS PINS. `lib/intelligence/providers/index.ts` imports
     * its seventeen providers as './github', './wikidata' and so on. The first
     * version of this scanner matched only '@/…' and reported all seventeen as
     * dead.
     */
    const { production } = importersOf(join('lib', 'intelligence', 'providers', 'github.ts'))
    expect(production).toContain(join('lib', 'intelligence', 'providers', 'index.ts'))
  })
})

describe('no lib module is imported only by its own test', () => {
  const orphans: string[] = []

  for (const file of LIB) {
    const { production, tests } = importersOf(file)
    // A module nothing imports at all is dead weight but harmless and often
    // intentional (entry points, type-only modules). The dangerous shape is a
    // module with a TEST and no production caller: it looks maintained.
    if (production.length === 0 && tests.length > 0) orphans.push(file)
  }

  it('finds the known orphans and no others', () => {
    const unexpected = orphans.filter((f) => !KNOWN_ORPHANS.has(f))
    expect(
      unexpected,
      `These modules are imported by their tests and by nothing else. That is ` +
        `code which looks maintained, passes CI, and never runs — the shape that ` +
        `produced lib/crm/custom-fields.ts. Wire it up, delete it, or add it to ` +
        `KNOWN_ORPHANS with a decision recorded in 03_ADRS.md.`,
    ).toEqual([])
  })

  for (const known of KNOWN_ORPHANS) {
    it(`${known} is still orphaned (remove from the list once fixed)`, () => {
      /*
       * Asserted in both directions, so the allowlist cannot rot into a
       * permanent exemption: wiring the module up fails this and tells you to
       * delete the entry.
       */
      expect(
        orphans,
        `${known} now has a production importer — remove it from KNOWN_ORPHANS.`,
      ).toContain(known)
    })
  }
})
