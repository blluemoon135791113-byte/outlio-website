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
 * Modules that call a model WITHOUT a credit context, permitted only until
 * DECISION-16 prices them.
 *
 * ⚠️ THIS LIST IS THE DEFECT, WRITTEN DOWN. It is not a design. Each entry is
 * an unmetered path a customer can reach; the reason it is here rather than
 * fixed is that pricing is the owner's decision, not an engineering one.
 *
 * ⚠️ ASSERTED IN BOTH DIRECTIONS BELOW. An entry that stops importing a
 * provider must be REMOVED, or the exemption outlives the problem and quietly
 * re-authorises a future import. Shrinking this list to empty is what finishing
 * Phase 12 item 4 looks like.
 */
const UNMETERED_PENDING_DECISION_16 = [
  // → /api/hubble/ask
  'lib/hubble/reason.ts',
  // → /api/intelligence/runs/[id]/summary  (the fourth route; the brief named three)
  'lib/hubble/summarize.ts',
  // → /api/intelligence/query and /api/intelligence/clarify
  'lib/intelligence/planner.ts',
] as const

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
 */
function importsProviderAtRuntime(source: string): boolean {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

  for (const match of withoutComments.matchAll(
    /import\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g,
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

  it('sees at least one known unmetered module', () => {
    expect(OFFENDERS.importers).toContain('lib/hubble/reason.ts')
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

  it('the exception list is the count Phase 12 recorded', () => {
    /*
     * Four routes, three modules — `planner.ts` serves both /query and
     * /clarify. The number is pinned so shrinking it is a visible act: when
     * DECISION-16 is answered and these move inside `hubbleExecute`, this
     * assertion is what fails and asks for the brief to be updated.
     */
    expect(UNMETERED_PENDING_DECISION_16).toHaveLength(3)
  })
})
