/**
 * Every declared flow trigger must have something that fires it.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ELEVEN OF SEVENTEEN TRIGGERS COULD NEVER FIRE, AND ALL SEVENTEEN WERE   ║
 * ║  SELECTABLE IN THE BUILDER.                                              ║
 * ║                                                                           ║
 * ║  A user could build a flow on `no_activity`, publish it, activate it, and ║
 * ║  watch it do nothing forever. No error, no warning, no row in             ║
 * ║  `flow_runs` — which held 0 rows platform-wide when Phase 0 measured it.  ║
 * ║                                                                           ║
 * ║  ⚠️ THE TYPE SYSTEM ACTIVELY HID THIS. `TriggerType` is a union derived   ║
 * ║  from `TRIGGER_TYPES`, so every one of the eleven is a perfectly valid    ║
 * ║  value everywhere it appears. `tsc` cannot distinguish a trigger with a   ║
 * ║  producer from one without: both are strings in the same union.          ║
 * ║                                                                           ║
 * ║  Nor could a runtime test. There is nothing to call. The defect is the    ║
 * ║  ABSENCE of a call site, and only a structural scan sees an absence.     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry)
    const full = join(ROOT, rel)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      out.push(...sourceFiles(rel))
    } else if (/\.tsx?$/.test(entry)) {
      out.push(rel)
    }
  }
  return out
}

const FILES = [...sourceFiles('app'), ...sourceFiles('lib')]

/**
 * ⚠️ COMMENTS ARE STRIPPED FIRST.
 *
 * `lib/flows/definition.ts` documents these trigger names in prose, and
 * `dispatch.ts` names several in a comment explaining the contract. A scan that
 * counts those as producers reports every trigger as wired and passes against a
 * completely disconnected system — the exact failure this file exists to catch.
 * Two earlier guards in this project shipped with that bug.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const CODE = new Map(FILES.map((f) => [f, stripComments(readFileSync(join(ROOT, f), 'utf8'))]))

/** The declared trigger vocabulary, read from its single source. */
function declaredTriggers(): string[] {
  const definition = CODE.get(join('lib', 'flows', 'definition.ts'))!
  const block = definition.match(/export const TRIGGER_TYPES = \[([\s\S]*?)\] as const/)
  if (!block) return []
  return [...block[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!)
}

/**
 * Every trigger name passed to something that actually starts or dispatches a
 * run, anywhere outside the flow module's own plumbing.
 *
 * ⚠️ `lib/flows/dispatch.ts` and `engine.ts` are EXCLUDED as producers. They
 * are the machinery that receives a trigger, not a source of one; counting them
 * would make every trigger look wired the moment the dispatcher mentioned it.
 */
function firedTriggers(): Map<string, string[]> {
  const fired = new Map<string, string[]>()
  const plumbing = [join('lib', 'flows', 'dispatch.ts'), join('lib', 'flows', 'engine.ts')]

  for (const [file, code] of CODE) {
    if (plumbing.includes(file)) continue
    if (!/dispatchFlowTrigger\s*\(|startRun\s*\(/.test(code)) continue

    for (const match of code.matchAll(/trigger(?:Type)?\s*:\s*'([a-z_]+)'/g)) {
      const name = match[1]!
      fired.set(name, [...(fired.get(name) ?? []), file])
    }
  }
  return fired
}

/**
 * Triggers that are known to have no producer today.
 *
 * ⚠️ THIS LIST MAY ONLY EVER SHRINK. It exists so the guard can be landed
 * against the real backlog and still block anything NEW, rather than being
 * disabled until someone finds time for eleven features. Deleting an entry when
 * you wire the trigger up is the point; adding one is not.
 *
 * ⚠️ `call_booked` IS DELIBERATELY NOT IN THIS LIST, even though it never fires
 * in practice. It has a real call site, so this scanner correctly sees a
 * producer; what it cannot see is that the call site is behind a condition no
 * caller satisfies. Putting it here would have been the convenient lie — the
 * guard would go green while describing the code wrongly. It gets its own
 * assertion below instead, against the actual defect.
 */
const KNOWN_UNWIRED = new Set([
  'contact_assigned',
  'list_added',
  'batch_added',
  'campaign_enrolled',
  'email_sent',
  'email_unsubscribed',
  'no_activity',
  'webhook',
  'scheduled',
])

describe('the scanner itself', () => {
  it('reads the declared trigger vocabulary', () => {
    // Without this, a rename of TRIGGER_TYPES makes every assertion below
    // vacuous against an empty list.
    const declared = declaredTriggers()
    expect(declared.length).toBeGreaterThanOrEqual(17)
    expect(declared).toContain('contact_created')
    expect(declared).toContain('no_activity')
  })

  it('finds real producers', () => {
    // And without this, a rename of dispatchFlowTrigger would report every
    // trigger as dead — a guard that cries wolf gets deleted.
    const fired = firedTriggers()
    expect(fired.size).toBeGreaterThanOrEqual(5)
    expect([...fired.keys()]).toContain('contact_created')
  })

  it('does not count a comment as a producer', () => {
    const withOnlyAComment = "// dispatchFlowTrigger({ triggerType: 'no_activity' })"
    expect(stripComments(withOnlyAComment).trim()).toBe('')
  })
})

describe('every declared trigger has a producer', () => {
  const fired = firedTriggers()

  for (const trigger of declaredTriggers()) {
    const known = KNOWN_UNWIRED.has(trigger)

    it(`${trigger}${known ? ' (known unwired)' : ''}`, () => {
      const producers = fired.get(trigger) ?? []

      if (known) {
        /*
         * ⚠️ THE ALLOWLIST IS ASSERTED IN BOTH DIRECTIONS. If someone wires up
         * `no_activity` and forgets to remove it from KNOWN_UNWIRED, this fails
         * and tells them to. Otherwise the list silently rots into a permanent
         * exemption, which is how allowlists stop meaning anything.
         */
        expect(
          producers,
          `${trigger} now HAS a producer (${producers.join(', ')}). Remove it from ` +
            `KNOWN_UNWIRED — the list may only ever shrink.`,
        ).toEqual([])
        return
      }

      expect(
        producers.length,
        `${trigger} is offered in the flow builder but nothing anywhere calls ` +
          `dispatchFlowTrigger or startRun with it. A user can build, publish and ` +
          `activate a flow on this trigger and it will never run, with no error. ` +
          `Either wire up a producer or remove it from TRIGGER_TYPES.`,
      ).toBeGreaterThan(0)
    })
  }
})

/**
 * `call_booked`: a producer that exists and cannot be reached.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS IS THE HARDER HALF OF THE SAME BUG, AND THE SCANNER ABOVE IS BLIND ║
 * ║  TO IT BY CONSTRUCTION.                                                  ║
 * ║                                                                           ║
 * ║  `lib/meetings/ingest.ts` fires `call_booked` — but only inside           ║
 * ║  `if (options.triggerFlowId && …)`, and NO CALLER ANYWHERE PASSES         ║
 * ║  `triggerFlowId`. So a grep for producers finds one, `tsc` is happy, the  ║
 * ║  code reads as correct, and the trigger has never fired.                 ║
 * ║                                                                           ║
 * ║  The decoupling itself is RIGHT, and the comment above it says so: the    ║
 * ║  meeting pipeline must not look up which flows exist. The other half —    ║
 * ║  something that decides the flow id and passes it — was never built.     ║
 * ║                                                                           ║
 * ║  ⚠️ WHEN YOU BUILD IT, THIS TEST FLIPS. That is intended: it fails to     ║
 * ║  tell you to delete it, exactly as the KNOWN_UNWIRED entries do.         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
describe('call_booked is wired but unreachable', () => {
  const ingest = CODE.get(join('lib', 'meetings', 'ingest.ts'))

  it('the producer still exists', () => {
    // If this fails the call site was removed, and the block below is stale.
    expect(ingest, 'lib/meetings/ingest.ts is missing').toBeDefined()
    expect(ingest).toContain("triggerType: 'call_booked'")
  })

  it('is guarded by options.triggerFlowId', () => {
    expect(ingest).toContain('options.triggerFlowId')
  })

  it('and nothing passes triggerFlowId, so it never fires', () => {
    const callers = [...CODE.entries()]
      .filter(([file]) => file !== join('lib', 'meetings', 'ingest.ts'))
      .filter(([, code]) => /triggerFlowId\s*:/.test(code))
      .map(([file]) => file)

    expect(
      callers,
      `Something now passes triggerFlowId (${callers.join(', ')}), so call_booked ` +
        `can finally fire. Delete this describe block — the trigger is genuinely ` +
        `wired and the scanner above covers it.`,
    ).toEqual([])
  })
})
