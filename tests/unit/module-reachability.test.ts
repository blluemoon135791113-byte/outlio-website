/**
 * Which of `lib/` can actually be reached from something that runs.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `orphan-module.test.ts` ASKS "IS ANYTHING BUT A TEST IMPORTING THIS?"    ║
 * ║  THIS ASKS "CAN A REQUEST EVER GET HERE?" — AND THEY DIFFER ON ISLANDS.   ║
 * ║                                                                           ║
 * ║  Seven `lib/linkedin/` modules import each other, are tested, and pass     ║
 * ║  CI. Every one of them has a non-test importer, so the orphan guard is     ║
 * ║  satisfied — and not one is reachable from any page, route or worker.      ║
 * ║  A cluster that only cites itself looks maintained from the inside.        ║
 * ║                                                                           ║
 * ║  This walks the import graph forward from the entry points instead, so a   ║
 * ║  ring of mutual imports counts for nothing unless something outside it     ║
 * ║  points in.                                                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THE RESOLVER IS THE WHOLE TEST, AND IT WAS WRONG THREE TIMES WHILE BEING
 * WRITTEN. Each bug made dead code appear where there was none:
 *
 *   - relative imports ignored → the 20 `providers/*` looked unreachable,
 *     because their barrel imports them as `./apollo` rather than `@/…`
 *   - `import()` ignored → dynamically-loaded modules looked unreachable
 *   - double-quoted imports ignored → `lib/json-ld.ts` looked unreachable,
 *     because the marketing pages quote differently from the product code
 *
 * Every one was caught by disbelieving a suspicious entry and checking it by
 * hand. The vacuity tests below exist so the next such bug fails loudly rather
 * than quietly widening the list.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname, normalize } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(full) && !full.endsWith('.d.ts')) out.push(full)
    }
  }
  walk(dir)
  return out
}

const rel = (p: string) => relative(ROOT, p).split('\\').join('/')

const SOURCE = new Map<string, string>()
for (const file of [
  ...sourceFiles(join(ROOT, 'lib')),
  ...sourceFiles(join(ROOT, 'app')),
  ...sourceFiles(join(ROOT, 'components')),
]) {
  SOURCE.set(rel(file), readFileSync(file, 'utf8'))
}
// The edge guard is an entry point in its own right — Next 16 renamed
// `middleware` to `proxy`, and it imports auth helpers nothing else does.
try {
  SOURCE.set('proxy.ts', readFileSync(join(ROOT, 'proxy.ts'), 'utf8'))
} catch {
  /* absent in some checkouts; the vacuity test below notices if it matters */
}

/** Both quote styles, `from '…'` and `import('…')`. See the banner. */
const SPECIFIER = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g

function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = spec.slice(2)
  else if (spec.startsWith('.'))
    base = normalize(join(dirname(fromFile), spec)).split('\\').join('/')
  else return null

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    base,
  ]) {
    if (SOURCE.has(candidate)) return candidate
  }
  return null
}

const GRAPH = new Map<string, Set<string>>()
for (const [file, code] of SOURCE) {
  const edges = new Set<string>()
  for (const match of code.matchAll(SPECIFIER)) {
    const target = resolveSpecifier(match[1]!, file)
    if (target && target !== file) edges.add(target)
  }
  GRAPH.set(file, edges)
}

/** Everything a request can start at: any route/page/layout, plus the edge guard. */
const ENTRY_POINTS = [...SOURCE.keys()].filter((f) => f.startsWith('app/') || f === 'proxy.ts')

const REACHABLE = new Set<string>()
{
  const stack = [...ENTRY_POINTS]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (REACHABLE.has(node)) continue
    REACHABLE.add(node)
    for (const next of GRAPH.get(node) ?? []) stack.push(next)
  }
}

const LIB = [...SOURCE.keys()].filter((f) => f.startsWith('lib/'))
const unreachable = LIB.filter((f) => !REACHABLE.has(f)).sort()

/**
 * ⚠️ NOT A BACKLOG. Every entry is a decision, and the reason is the point —
 * an allowlist without one becomes the place failures go to be forgotten.
 */
const KNOWN_UNREACHABLE = new Map<string, string>([
  /* ── Already recorded by orphan-module.test.ts; this guard found them again
        independently, which is the main evidence that it works. ───────────── */
  ['lib/companies/links.ts', 'orphan-module KNOWN_ORPHANS'],
  ['lib/crm/custom-fields.ts', 'orphan-module KNOWN_ORPHANS — Phase 0 evidence #4'],
  ['lib/integrations/catalogue.ts', 'orphan-module KNOWN_ORPHANS'],
  ['lib/jobs/lead-pagination.ts', 'orphan-module KNOWN_ORPHANS'],
  [
    'lib/fastspring/access.ts',
    'ADR-002: a deliberate mirror of the Postgres function that decides paid ' +
      'access. Uncalled ON PURPOSE and must not be deleted.',
  ],

  /* ── LinkedIn: the island is mostly gone. ───────────────────────────────── */
  /*
   * ╔═══════════════════════════════════════════════════════════════════════╗
   * ║  SEVEN ENTRIES BECAME THREE, AND THAT IS THIS GUARD PAYING FOR ITSELF. ║
   * ║                                                                       ║
   * ║  `enrollment`, `preflight`, `render`, `profile-reference` are now      ║
   * ║  reachable from /linkedin through `tasks.ts` and `enroll.ts`. The      ║
   * ║  entries below are the ones the release path genuinely does not call   ║
   * ║  YET — kept honest rather than removed early.                         ║
   * ╚═══════════════════════════════════════════════════════════════════════╝
   */
  /*
   * ╔═══════════════════════════════════════════════════════════════════════╗
   * ║  THE LINKEDIN ISLAND IS GONE. Seven entries, then four, now none.      ║
   * ║                                                                       ║
   * ║  The last four said they were waiting on "a LinkedInContext builder    ║
   * ║  that maps a contact's verified evidence into §4.9 variables", and     ║
   * ║  that wiring them to invented values "would fabricate familiarity,     ║
   * ║  which the brief forbids by name". `lib/linkedin/context.ts` is that   ║
   * ║  builder, and it is mostly a list of refusals — it will not split a    ║
   * ║  full name, will not derive `role_area` from a job title, and holds no ║
   * ║  relationship data to ground `connection_context` in.                  ║
   * ║                                                                       ║
   * ║  Which means the honest context usually CANNOT render a grounded       ║
   * ║  opener, and §4.9's own remedy — a human writes the note — is what     ║
   * ║  makes the path reachable. The allowlist emptied because the code      ║
   * ║  changed, not because anybody tidied it.                              ║
   * ╚═══════════════════════════════════════════════════════════════════════╝
   *
   * `metrics.ts` alone remains: it leaves when something REPORTS on LinkedIn
   * outcomes, and there is no outcome history to measure yet.
   */
  [
    'lib/linkedin/metrics.ts',
    'Acceptance and reply rates (§4.18). Nothing reports on LinkedIn outcomes ' +
      'yet — enrollments can only be created from today, so a report would be a ' +
      'screen of zeroes pretending to be a finding.',
  ],
])

describe('the graph is real, not an artefact of a broken resolver', () => {
  it('read the whole product surface', () => {
    expect(SOURCE.size).toBeGreaterThan(400)
    expect(LIB.length).toBeGreaterThan(250)
    expect(ENTRY_POINTS.length).toBeGreaterThan(50)
  })

  it('resolved a large number of edges', () => {
    /*
     * Vacuity: a resolver that returned null for everything would mark the
     * whole of `lib/` unreachable and the allowlist would swallow it.
     */
    const edges = [...GRAPH.values()].reduce((sum, set) => sum + set.size, 0)
    expect(edges).toBeGreaterThan(800)
  })

  it('resolves each import form the codebase actually uses', () => {
    /*
     * ⚠️ ONE ASSERTION PER BUG THIS RESOLVER HAD. Each of these was a real
     * false positive before it was fixed.
     */
    // Alias, single-quoted — the product convention.
    expect(resolveSpecifier('@/lib/crm/contact-stop', 'lib/email/send.ts')).toBe(
      'lib/crm/contact-stop.ts',
    )
    // Relative — how the provider barrel imports its providers.
    expect(resolveSpecifier('./apollo', 'lib/intelligence/providers/index.ts')).toBe(
      'lib/intelligence/providers/apollo.ts',
    )
    // Directory with an index file.
    expect(resolveSpecifier('@/lib/intelligence/providers', 'lib/intelligence/run.ts')).toBe(
      'lib/intelligence/providers/index.ts',
    )
    // A bare package specifier is not ours to resolve.
    expect(resolveSpecifier('react', 'lib/email/send.ts')).toBeNull()
  })

  it('finds modules that are obviously reachable', () => {
    /*
     * If any of these were reported unreachable the resolver is broken, not
     * the codebase. `json-ld` is here because a double-quote bug hid it once.
     */
    for (const file of [
      'lib/crm/contact-stop.ts',
      'lib/email/send.ts',
      'lib/auth/access.ts',
      'lib/json-ld.ts',
      'lib/intelligence/providers/apollo.ts',
      'lib/workers/tick.ts',
    ]) {
      expect(SOURCE.has(file), `${file} moved — update this list`).toBe(true)
      expect(REACHABLE.has(file), `${file} is reported unreachable; suspect the resolver`).toBe(
        true,
      )
    }
  })

  it('treats the edge guard as an entry point', () => {
    // `proxy.ts` imports auth helpers nothing else does; omitting it would
    // report those as dead.
    expect(SOURCE.has('proxy.ts')).toBe(true)
    expect(REACHABLE.has('lib/auth/session-guard.ts')).toBe(true)
  })
})

describe('nothing new is unreachable', () => {
  it('every unreachable module is a recorded decision', () => {
    const unexpected = unreachable.filter((f) => !KNOWN_UNREACHABLE.has(f))
    expect(
      unexpected,
      'These modules cannot be reached from any page, route, or the edge ' +
        'guard. That is code which looks maintained, has tests, passes CI and ' +
        'never runs — the shape that produced lib/crm/custom-fields.ts and left ' +
        'suppressContact with no callers. Wire it up, delete it, or add it here ' +
        'with the reason.',
    ).toEqual([])
  })

  it('the list has not grown', () => {
    /*
     * ⚠️ PINNED. Without this the fix for a failing build is to append, and the
     * allowlist becomes a list of things nobody intends to do anything about.
     */
    expect(KNOWN_UNREACHABLE.size).toBeLessThanOrEqual(15)
  })

  it('no entry is stale', () => {
    /*
     * ⚠️ ASSERTED IN BOTH DIRECTIONS, which is what makes this a ratchet rather
     * than a comment. When the LinkedIn release pipeline lands, those seven
     * become reachable and this fails until they are removed — so the allowlist
     * cannot quietly outlive the reason it was written.
     */
    const stale = [...KNOWN_UNREACHABLE.keys()].filter(
      (f) => !SOURCE.has(f) || REACHABLE.has(f),
    )
    expect(
      stale,
      'These are allowlisted but are now reachable (or gone). Remove them.',
    ).toEqual([])
  })

  it('every entry says why', () => {
    for (const [file, reason] of KNOWN_UNREACHABLE) {
      expect(reason.length, `${file} has no reason recorded`).toBeGreaterThan(20)
    }
  })
})
