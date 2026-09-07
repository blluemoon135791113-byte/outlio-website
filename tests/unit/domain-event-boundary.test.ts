/**
 * A domain event goes out one door — Phase 23.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS IS THE SAME DEFECT, THE SAME BUILDING, FOR THE THIRD TIME.          ║
 * ║                                                                           ║
 * ║  R8: seventeen flow triggers declared, one ever fired.                    ║
 * ║  Phase 12: one metered AI door, four routes that walked past it.          ║
 * ║  Phase 23: twelve webhook events offered, none ever published.            ║
 * ║                                                                           ║
 * ║  Every time, the code was correct and the wiring depended on an author     ║
 * ║  remembering. `emitDomainEvent` is the one door; this file is what stops   ║
 * ║  the fourth occurrence, when someone adds a domain event and wires the     ║
 * ║  flow engine because that is the system they were thinking about.         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import { webhookEventForTrigger } from '@/lib/events/emit'

const ROOT = join(__dirname, '..', '..')

/** Calling either of these directly wires one system and silently skips the other. */
const FANOUT_FUNCTIONS = ['dispatchFlowTrigger', 'publishEvent'] as const

/**
 * The one door, plus the two modules that define the halves.
 *
 * ⚠️ NOTHING ELSE BELONGS HERE. An exception would be a module that fires a
 * flow without a webhook or the reverse, which is the bug, not a use case.
 */
const ALLOWED = [
  'lib/events/emit.ts',
  'lib/flows/dispatch.ts',
  'lib/api/webhooks.ts',
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
 * ⚠️ COMMENTS STRIPPED FIRST. `lib/flows/actions/webhook.ts` says "THIS IS NOT
 * `publishEvent`" in a banner, and matching prose would report a file that does
 * exactly the right thing. This project's own memory names comment-matching as
 * the trap that has bitten six guards.
 */
function callsFanoutDirectly(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  return FANOUT_FUNCTIONS.filter((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(code))
}

const SCAN = (() => {
  const files = [
    ...sourceFiles(join(ROOT, 'lib')),
    ...sourceFiles(join(ROOT, 'app')),
    ...sourceFiles(join(ROOT, 'components')),
  ]
  const callers = files
    .map((f) => ({ file: relative(ROOT, f).split('\\').join('/'), fns: callsFanoutDirectly(readFileSync(f, 'utf8')) }))
    .filter((r) => r.fns.length > 0)

  return { scanned: files.length, callers }
})()

describe('the scan can see what it polices', () => {
  it('scans a plausible number of files', () => {
    expect(SCAN.scanned).toBeGreaterThan(300)
  })

  it('sees the one door calling both halves', () => {
    /*
     * The vacuity guard. If `emitDomainEvent` stops calling both, every
     * assertion below passes against a set that means nothing.
     */
    const door = SCAN.callers.find((c) => c.file === 'lib/events/emit.ts')
    expect(door, 'lib/events/emit.ts must call both halves').toBeDefined()
    expect([...door!.fns].sort()).toEqual(['dispatchFlowTrigger', 'publishEvent'])
  })
})

describe('nothing fires half a domain event', () => {
  it('no module calls the fan-out functions except the door', () => {
    const rogue = SCAN.callers.filter((c) => !(ALLOWED as readonly string[]).includes(c.file))

    expect(
      rogue.map((r) => `${r.file} → ${r.fns.join(', ')}`),
      'These wire one event system and silently skip the other. Call ' +
        '`emitDomainEvent` instead — it fans out to both, and adding a mapping ' +
        'entry is how a new event becomes a webhook.',
    ).toEqual([])
  })
})

describe('the mapping covers every trigger that has a source', () => {
  /*
   * ⚠️ THE SIX THAT ARE WIRED, PINNED. Each corresponds to a real dispatch
   * point in the product. If one loses its mapping the webhook silently stops
   * while the flow keeps running — the exact asymmetry this phase found.
   */
  const WIRED = [
    ['contact_created', 'crm.contact.created'],
    ['stage_changed', 'crm.opportunity.stage_changed'],
    ['opportunity_won', 'crm.opportunity.won'],
    ['task_completed', 'crm.task.completed'],
    ['email_replied', 'email.message.replied'],
    ['email_bounced', 'email.message.bounced'],
  ] as const

  for (const [trigger, event] of WIRED) {
    it(`${trigger} publishes ${event}`, () => {
      expect(webhookEventForTrigger(trigger)).toBe(event)
    })
  }

  it('does not invent a public event for a trigger that has no payload contract', () => {
    /*
     * `call_booked` is Calendly's own concern and starts a run directly.
     * Mapping it here would publish `meeting.booked` with a shape nobody has
     * specified — fabricating an API rather than filling a gap.
     */
    expect(webhookEventForTrigger('call_booked')).toBeNull()
  })
})
