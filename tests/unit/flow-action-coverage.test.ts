/**
 * The action catalogue must not promise what no handler delivers.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `ACTION_TYPES` LISTS 29 ACTIONS. 22 HAVE A HANDLER.                     ║
 * ║                                                                           ║
 * ║  ADD_TO_LIST, CREATE_OPPORTUNITY, DATE_CALC, MOVE_STAGE,                 ║
 * ║  REMOVE_FROM_LIST, TEXT_TRANSFORM and WEBHOOK were offered by the step    ║
 * ║  picker, accepted by the validator and publishable — with no runner       ║
 * ║  registered for any of them. A flow using one published cleanly and died  ║
 * ║  on its first contact with "the X action is not available yet".           ║
 * ║                                                                           ║
 * ║  ⚠️ THIS TEST IS THE THING THAT KEEPS THE LIST HONEST. It derives the     ║
 * ║  registered set from the actual `registerAction` calls, so implementing   ║
 * ║  one of them — or adding a new unbacked action — fails here until the     ║
 * ║  declaration is updated. Without it the list rots into another promise.   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ACTION_TYPES,
  UNIMPLEMENTED_ACTIONS,
  actionIsImplemented,
  type ActionType,
} from '@/lib/flows/definition'

const ROOT = join(__dirname, '..', '..')
const ACTIONS_DIR = join(ROOT, 'lib', 'flows', 'actions')

/**
 * Every action a handler is actually registered for.
 *
 * ⚠️ THE HUBBLE ACTIONS ARE REGISTERED IN A LOOP, not by literal name — an
 * earlier version of this scan grepped for `registerAction('NAME'` and reported
 * all seven as missing. They come from `TASK_FOR` in `hubble.ts` instead.
 */
function registeredActions(): Set<string> {
  const found = new Set<string>()

  for (const file of readdirSync(ACTIONS_DIR)) {
    if (!file.endsWith('.ts')) continue
    const source = readFileSync(join(ACTIONS_DIR, file), 'utf8')

    for (const match of source.matchAll(/registerAction\(\s*'([A-Z_]+)'/g)) {
      found.add(match[1]!)
    }

    // `registerHubbleActions` loops `Object.keys(TASK_FOR)`.
    if (file === 'hubble.ts' && /registerAction\(action as ActionType/.test(source)) {
      const table = source.slice(source.indexOf('TASK_FOR'), source.indexOf('}', source.indexOf('TASK_FOR')))
      for (const match of table.matchAll(/([A-Z_]+):\s*'/g)) found.add(match[1]!)
    }
  }

  return found
}

describe('the declared gap matches reality', () => {
  const registered = registeredActions()
  const all = Object.keys(ACTION_TYPES) as ActionType[]

  it('the scan finds a plausible number of handlers', () => {
    // Guards the scanner: a rename of `registerAction` would otherwise make
    // every assertion below vacuous against an empty set.
    expect(registered.size).toBeGreaterThan(15)
    expect(registered.has('ASSIGN_OWNER')).toBe(true)
    expect(registered.has('HUBBLE_ICP_SCORE'), 'the loop registration was missed').toBe(true)
  })

  it('every action declared unimplemented really has no handler', () => {
    /*
     * The direction that matters most: if one of these gains a handler and
     * nobody updates the list, it stays hidden from the picker forever —
     * shipped and unreachable, which is this codebase's signature failure.
     */
    for (const action of UNIMPLEMENTED_ACTIONS) {
      expect(
        registered.has(action),
        `${action} is declared unimplemented but HAS a handler — remove it from UNIMPLEMENTED_ACTIONS or it stays hidden`,
      ).toBe(false)
    }
  })

  it('every action NOT declared unimplemented has a handler', () => {
    /*
     * The other direction: a new action added to `ACTION_TYPES` without a
     * runner would be offered, published, and fail on the first contact.
     */
    const missing = all.filter((a) => actionIsImplemented(a) && !registered.has(a))
    expect(
      missing,
      `offered with no handler — add a runner, or list them in UNIMPLEMENTED_ACTIONS:\n${missing.join('\n')}`,
    ).toEqual([])
  })

  it('names the seven that were found unbacked', () => {
    // Documented rather than merely prevented, so the next reader knows this
    // list came from measurement and not from taste.
    expect([...UNIMPLEMENTED_ACTIONS].sort()).toEqual([
      'ADD_TO_LIST',
      'CREATE_OPPORTUNITY',
      'DATE_CALC',
      'MOVE_STAGE',
      'REMOVE_FROM_LIST',
      'TEXT_TRANSFORM',
      'WEBHOOK',
    ])
  })
})

describe('the builder offers only what works', () => {
  const BUILDER = readFileSync(join(ROOT, 'components', 'flows', 'FlowBuilder.tsx'), 'utf8')

  it('filters both pickers on implementation', () => {
    /*
     * ⚠️ VERIFIED NON-VACUOUS: dropping `actionIsImplemented` from either
     * filter puts the seven dead actions back in the picker.
     */
    expect(BUILDER).toContain('!ACTION_TYPES[a].costsCredits && actionIsImplemented(a)')
    expect(BUILDER).toContain('ACTION_TYPES[a].costsCredits && actionIsImplemented(a)')
  })

  it('does not simply hide them from the type', () => {
    /*
     * They stay in `ACTION_TYPES` deliberately. A flow published before this
     * change may already use one, and removing the enum member would make that
     * definition fail to PARSE — turning a step that fails into a flow that
     * cannot be opened or repaired.
     */
    for (const action of UNIMPLEMENTED_ACTIONS) {
      expect(ACTION_TYPES[action], `${action} was removed from the catalogue`).toBeDefined()
    }
  })
})
