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
import { NOTIFIABLE_EVENTS } from '@/lib/notifications/format'

const ROOT = join(__dirname, '..', '..')

/** Calling any of these directly wires one system and silently skips the others. */
const FANOUT_FUNCTIONS = ['dispatchFlowTrigger', 'publishEvent', 'notifyDomainEvent'] as const

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
  // Defines notifyDomainEvent. `notifyChannels` itself is NOT policed here: it
  // has two legitimate non-domain callers, the settings test button and the
  // NOTIFY flow step, where the event is the author's own choice.
  'lib/notifications/domain.ts',
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
    expect(door, 'lib/events/emit.ts must call every listener').toBeDefined()
    expect([...door!.fns].sort()).toEqual([
      'dispatchFlowTrigger',
      'notifyDomainEvent',
      'publishEvent',
    ])
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
   * ⚠️ THE NINE THAT ARE WIRED, PINNED. Each corresponds to a real dispatch
   * point in the product. If one loses its mapping the webhook silently stops
   * while the flow keeps running — the exact asymmetry this phase found.
   * The last three joined 2026-09-09 when their sources landed: assignment
   * (manual path + both flow actions), the send worker's post-hand-off moment,
   * and the one-click unsubscribe. Behavior tests live in
   * `domain-event-sources.test.ts`.
   */
  const WIRED = [
    ['contact_created', 'crm.contact.created'],
    ['contact_assigned', 'crm.contact.assigned'],
    ['stage_changed', 'crm.opportunity.stage_changed'],
    ['opportunity_won', 'crm.opportunity.won'],
    ['task_completed', 'crm.task.completed'],
    ['email_sent', 'email.message.sent'],
    ['email_replied', 'email.message.replied'],
    ['email_bounced', 'email.message.bounced'],
    ['email_unsubscribed', 'email.contact.unsubscribed'],
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

/**
 * Every event Settings offers must be able to arrive.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS IS THE CHECK THAT WAS MISSING, AND ITS ABSENCE COST EIGHT EVENTS.   ║
 * ║                                                                           ║
 * ║  `NOTIFIABLE_EVENTS` is a promise rendered as checkboxes: "Someone         ║
 * ║  replies", "A deal is won". Until 2026-09-09 nothing in the product ever  ║
 * ║  sent one — `notifyChannels` had two callers, the settings test button    ║
 * ║  and a flow step's typed-in string.                                      ║
 * ║                                                                           ║
 * ║  ⚠️ AND THE TEST BUTTON MADE IT LOOK WIRED. "Send test" passes            ║
 * ║  `onlyChannelId`, which bypasses the event filter on purpose, so it       ║
 * ║  always delivers. The customer sees Slack light up and concludes the      ║
 * ║  subscription works. A green signal about the wrong thing.               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
describe('every notifiable event has a source', () => {
  /*
   * ⚠️ MAY ONLY SHRINK. Both remain unsourced for the payload-contract reason
   * in PHASE_23.md — Calendly's normalized shape is not a published API, and
   * inventing a body is fabricating one. Sourcing them means deleting the
   * entry, which is what makes this list a backlog rather than an excuse.
   */
  const KNOWN_UNSOURCED = ['meeting.booked', 'meeting.cancelled'] as const

  /** The webhook event names `emitDomainEvent` can actually produce. */
  const emittable = new Set(
    (['contact_created', 'contact_assigned', 'stage_changed', 'opportunity_won',
      'task_completed', 'email_sent', 'email_replied', 'email_bounced',
      'email_unsubscribed'] as const)
      .map((t) => webhookEventForTrigger(t))
      .filter((e): e is NonNullable<typeof e> => e !== null),
  )

  it('the emittable set is not empty', () => {
    // Vacuity: a rename in the mapping would otherwise pass everything below.
    expect(emittable.size).toBeGreaterThanOrEqual(9)
  })

  it('every offered event is either emittable or a written-down gap', () => {
    const unreachable = NOTIFIABLE_EVENTS.map((e) => e.value).filter(
      (value) =>
        !emittable.has(value as never) &&
        !(KNOWN_UNSOURCED as readonly string[]).includes(value),
    )

    expect(
      unreachable,
      'Settings offers these as "notify me when…" and no moment in the product ' +
        'emits them, so ticking the box does nothing forever:\n' +
        unreachable.map((v) => `  ${v}`).join('\n'),
    ).toEqual([])
  })

  it('every written-down gap is still a gap', () => {
    // The other direction: a sourced event must lose its exemption, or the
    // list rots into a permanent excuse.
    const stale = KNOWN_UNSOURCED.filter((value) => emittable.has(value as never))
    expect(stale, 'These now have a source — delete them from KNOWN_UNSOURCED').toEqual([])
  })
})
