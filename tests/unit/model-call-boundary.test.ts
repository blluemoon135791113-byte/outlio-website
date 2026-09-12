/**
 * Only the guarded entry point may reach a model — Phase 12 item 3.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS IS THE DELIVERABLE. THE REGISTRY AND THE ENTRY POINT ARE NOT.       ║
 * ║                                                                           ║
 * ║  `lib/hubble/execute.ts` was already careful — it reserved before the      ║
 * ║  call, refunded on failure, and shouted when a refund failed. It was       ║
 * ║  correct the entire time. Four HTTP routes still called a model without    ║
 * ║  it, because BEING METERED DEPENDED ON A CALLER REMEMBERING TO IMPORT IT.  ║
 * ║                                                                           ║
 * ║  §5.11 says metering is "enforced by the capability registry's `is_ai`     ║
 * ║  flag, not by convention". Convention is precisely what failed. A registry ║
 * ║  and an entry point are still convention until something refuses the       ║
 * ║  import — which is this file.                                             ║
 * ║                                                                           ║
 * ║  ⚠️ WITHOUT THIS TEST, ITEMS 1 AND 2 PRODUCE A FIFTH UNMETERED ROUTE the   ║
 * ║  first time someone is in a hurry, and it will look exactly as reasonable  ║
 * ║  as the first four did.                                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

/** The modules that can hand you something able to call a model. */
const PROVIDER_MODULES = [
  'lib/intelligence/llm/provider',
  'lib/hubble/providers/ollama-llm',
] as const

/**
 * The provider layer itself, plus the one metered door.
 *
 * ⚠️ `lib/hubble/execute.ts` IS THE WHOLE POINT. It is the only non-provider
 * module allowed to construct a model, and it hands it to the runner as a tool
 * rather than letting the runner fetch one.
 */
const INSIDE_THE_BOUNDARY = [
  'lib/hubble/execute.ts',
  'lib/intelligence/llm/',
  'lib/hubble/providers/',
] as const

/**
 * Modules permitted to import a provider WITHOUT being the door: none.
 *
 * ⚠️ THIS LIST WAS THE DEFECT, WRITTEN DOWN — AND EMPTIED 2026-09-08. It
 * held the three modules behind the four unmetered HTTP routes Phase 12
 * found (`reason.ts` → /api/hubble/ask, `summarize.ts` → the run-summary
 * route, `planner.ts` → /query and /clarify). DECISION-16's starting answer
 * (meter at 0) let all three move inside `hubbleExecute` as runners that
 * receive `tools.llm`, which is why none of them imports a provider at
 * runtime any more.
 *
 * It stays DECLARED and EMPTY rather than being deleted, for the same reason
 * a vacuous-looking guard is kept: the next person to add an HTTP AI route
 * will reach for a provider import, and this list is where that reflex goes
 * to be either justified in review (an entry, with the route it serves) or
 * rejected by the assertions below.
 */
const UNMETERED_PENDING_DECISION_16 = [] as const

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
      else if (/\.tsx?$/.test(full)) out.push(full)
    }
  }
  walk(dir)
  return out
}

/**
 * Does this file obtain a model at runtime?
 *
 * ⚠️ A TYPE-ONLY IMPORT IS NOT A MODEL. `import type { LLMProvider }` cannot
 * call anything; it disappears at compile time. Counting it would flag files
 * that merely describe a provider in a signature, and a guard that cries wolf
 * gets an allowlist entry rather than a fix.
 *
 * ⚠️ THE MATCH MUST NOT CROSS AN IMPORT BOUNDARY — found the hard way while
 * closing Phase 12 item 4. A bare side-effect import (`import 'server-only'`)
 * has no `from` clause of its own, and the lazy `([\s\S]*?)` first used here
 * happily matched from it all the way to the NEXT import's `from`, so
 * `import type { LLMProvider }` two lines down was read as that side-effect
 * import's bindings — a runtime import that did not exist. The guard then
 * failed for a reason that was wrong, which is the mirror image of this
 * project's signature defect (a check that passes for a reason that is
 * wrong): either way the colour of the test says nothing about the code.
 * One import's bindings can never contain the `import` keyword, so a negative
 * lookahead on it keeps each match inside one statement.
 *
 * ⚠️ DYNAMIC IMPORTS ARE SCANNED TOO. `await import('…/ollama-llm')` bypasses
 * the static scanner above entirely, and the boundary is only as good as its
 * least convenient path.
 */
function importsProviderAtRuntime(source: string): boolean {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

  for (const match of withoutComments.matchAll(
    /import\s+(type\s+)?((?:(?!import\b)[^;])*?)\s*from\s*['"]([^'";]+)['"]/g,
  )) {
    const [, typeKeyword, bindings, spec] = match
    const resolved = spec!.replace(/^@\//, '').replace(/^\.\.?\//, '')
    if (!PROVIDER_MODULES.some((m) => spec!.includes(m) || m.endsWith(resolved))) continue

    // `import type { … } from` — erased entirely.
    if (typeKeyword) continue

    // `import { type A, type B } from` — every binding erased.
    const named = bindings!.match(/\{([\s\S]*)\}/)
    if (named) {
      const parts = named[1]!
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
      if (parts.length > 0 && parts.every((p) => p.startsWith('type '))) continue
    }

    return true
  }

  /*
   * `await import('…')` hands you the same module without a `from` clause.
   * The spec is matched directly; there are no bindings to inspect because a
   * dynamic import with no runtime use would be a lint error, not a pattern
   * anyone writes.
   */
  for (const match of withoutComments.matchAll(
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  )) {
    const resolved = match[1]!.replace(/^@\//, '').replace(/^\.\.?\//, '')
    if (PROVIDER_MODULES.some((m) => match[1]!.includes(m) || m.endsWith(resolved))) {
      return true
    }
  }

  return false
}

const OFFENDERS = (() => {
  const files = [
    ...sourceFiles(join(ROOT, 'lib')),
    ...sourceFiles(join(ROOT, 'app')),
    ...sourceFiles(join(ROOT, 'components')),
  ]
  const importers = files
    .filter((f) => importsProviderAtRuntime(readFileSync(f, 'utf8')))
    .map((f) => relative(ROOT, f).split('\\').join('/'))

  return { scanned: files.length, importers }
})()

describe('the scan can actually see the thing it polices', () => {
  /*
   * ⚠️ THE VACUITY GUARD. Rename a provider module, break the walker, or let
   * the import regex rot and every assertion below passes against an empty
   * set — which is this project's signature defect, and the reason the flow
   * action scan broke loudly earlier in this phase rather than silently.
   */
  it('scans a plausible number of files', () => {
    expect(OFFENDERS.scanned).toBeGreaterThan(300)
  })

  it('sees the guarded entry point importing a provider', () => {
    expect(
      OFFENDERS.importers,
      'lib/hubble/execute.ts must import a provider — if it does not, the scan is broken or the boundary moved',
    ).toContain('lib/hubble/execute.ts')
  })

  it('still sees the door, and the door alone, as a non-provider importer', () => {
    /*
     * Phase 12 item 4 closed 2026-09-08: the three exemption entries moved
     * inside `hubbleExecute` and no longer import a provider. The scan must
     * not have gone blind with them — `execute.ts` is still visible — and
     * the closed set is pinned so a NEW importer appears as a length change,
     * not a silent member.
     *
     * The provider layer itself (`lib/intelligence/llm/`, including the
     * `catalog.ts` picker, and `lib/hubble/providers/`) is excluded before
     * pinning: those files construct models BECAUSE they are the provider
     * layer — counting them here would make this test about listing the
     * provider directory rather than about who reaches AROUND it.
     */
    const nonProviderImporters = OFFENDERS.importers.filter(
      (f) => !INSIDE_THE_BOUNDARY.some((p) => f !== 'lib/hubble/execute.ts' && (f === p || f.startsWith(p))),
    )
    expect(nonProviderImporters).toContain('lib/hubble/execute.ts')
    expect(
      nonProviderImporters,
      'the non-provider importer set changed; a new file is reaching a provider',
    ).toEqual(['lib/hubble/execute.ts'])
  })
})

describe('no module reaches a model except through the boundary', () => {
  const allowed = (file: string): boolean =>
    INSIDE_THE_BOUNDARY.some((p) => file === p || file.startsWith(p)) ||
    (UNMETERED_PENDING_DECISION_16 as readonly string[]).includes(file)

  it('every provider import is either the boundary or a written-down exception', () => {
    const unexpected = OFFENDERS.importers.filter((f) => !allowed(f))

    expect(
      unexpected,
      'These modules obtain a model without going through hubbleExecute, so their ' +
        'calls are charged to nobody:\n' +
        unexpected.map((f) => `  ${f}`).join('\n') +
        '\n\nEither call it inside a metered runner (the model is handed to you as ' +
        '`tools.llm`), or add it to UNMETERED_PENDING_DECISION_16 with the route it ' +
        'serves — deliberately, in a diff someone reviews.',
    ).toEqual([])
  })

  /*
   * ⚠️ THE OTHER DIRECTION, AND THE ONE THAT ROTS. A stale exemption is
   * indistinguishable from a live one, and it silently pre-authorises the next
   * import into that file.
   */
  it('every exception still needs its exemption', () => {
    const stale = UNMETERED_PENDING_DECISION_16.filter((f) => !OFFENDERS.importers.includes(f))

    expect(
      stale,
      'These no longer import a provider, so their exemption is dead and must be ' +
        'deleted:\n' + stale.map((f) => `  ${f}`).join('\n'),
    ).toEqual([])
  })

  it('the exception list is the count Phase 12 closed at', () => {
    /*
     * Zero since 2026-09-08 — the four unmetered routes entered the door.
     * Pinned at zero so an entry REAPPEARING is a visible act that fails this
     * test, rather than a quiet re-authorisation of the next unmetered import.
     */
    expect(UNMETERED_PENDING_DECISION_16).toHaveLength(0)
  })
})
