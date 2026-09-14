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

  /*
   * ╔═════════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ THE LOOP ABOVE CANNOT DETECT A MISSING MAPPING, WHICH IS THE ONE     ║
   * ║  FAILURE THE COMMENT ABOVE CLAIMS IT PREVENTS.                          ║
   * ║                                                                         ║
   * ║  `WIRED` lives in this file and GENERATES its own test cases, so         ║
   * ║  deleting a row deletes the assertion. Proven by mutation: removing      ║
   * ║  `['opportunity_won', ...]` left 18 tests passing and nothing red. It    ║
   * ║  catches a WRONG mapping — changing the value to `crm.opportunity.WRONG` ║
   * ║  does fail — and is blind to an ABSENT one.                             ║
   * ║                                                                         ║
   * ║  That is this project's signature defect sitting inside the guard        ║
   * ║  written against it: a check whose expectations are its own data         ║
   * ║  answers a question it asked itself.                                    ║
   * ╚═════════════════════════════════════════════════════════════════════════╝
   *
   * So compare KEY SETS against the product's own table. `WEBHOOK_FOR_TRIGGER`
   * is deliberately not exported — widening the product API to be testable is
   * how the API grows shapes nobody wanted — so it is read from source, which
   * is the established pattern here.
   */
  it('the product wires exactly these nine triggers, no more and no fewer', () => {
    const source = readFileSync(join(ROOT, 'lib/events/emit.ts'), 'utf8')
    const open = source.indexOf('const WEBHOOK_FOR_TRIGGER')
    expect(open, 'WEBHOOK_FOR_TRIGGER was renamed').toBeGreaterThan(-1)
    const close = source.indexOf('}', open)

    /*
     * ⚠️ COMMENTS STRIPPED FIRST. `emit.ts` names events in prose immediately
     * above this table — including the three `meeting.*` events it deliberately
     * does NOT wire. Matching the raw slice would read those as mappings and
     * report a product that publishes an API it refuses to publish.
     */
    const table = source
      .slice(open, close)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n')

    const inProduct = [...table.matchAll(/^\s*(\w+):\s*'[\w.]+',/gm)].map((m) => m[1]!)

    expect(
      inProduct.slice().sort(),
      'The product\'s trigger→webhook table and this file\'s WIRED list ' +
        'disagree. A trigger in the product but not in WIRED is an event ' +
        'shipping unreviewed; a trigger in WIRED but not in the product is a ' +
        'webhook that silently stopped while its flow kept running — the exact ' +
        'asymmetry Phase 23 found.',
    ).toEqual(
      WIRED.map(([trigger]) => trigger)
        .slice()
        .sort(),
    )
  })

  it('the door still actually calls the publisher', () => {
    /*
     * ⚠️ A VACUITY GUARD, AND IT WAS MISSING. `BUILD_HANDOFF` §0.2 assumed one
     * existed; mutation proved it did not. Neutering the call —
     * `webhooksQueued = 0 && await publishEvent(...)` — left all 19 tests
     * green, so every mapping assertion above would have kept passing about a
     * door that queued nothing.
     *
     * Asserted on the assignment, because the RESULT is what the caller reads:
     * a `publishEvent` whose return value is discarded reports zero deliveries
     * forever, and `webhooksQueued` is what tells a customer their webhook
     * fired.
     */
    const source = readFileSync(join(ROOT, 'lib/events/emit.ts'), 'utf8')
    expect(source).toMatch(/webhooksQueued = await publishEvent\(/)
    expect(
      source,
      'the publishEvent call is short-circuited; the door queues nothing',
    ).not.toMatch(/webhooksQueued = [^a]\S*\s*&&\s*await publishEvent\(/)
  })

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
   * ╔═══════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ EMPTY AS OF 2026-09-13, AND IT EMPTIED THE OTHER WAY.             ║
   * ║                                                                       ║
   * ║  This held `meeting.booked` and `meeting.cancelled`. The comment said  ║
   * ║  "sourcing them means deleting the entry, which is what makes this a   ║
   * ║  backlog rather than an excuse" — and assumed the only exit was        ║
   * ║  building them.                                                       ║
   * ║                                                                       ║
   * ║  DECISION-18 took the other exit: WITHDRAWN. They were offered for     ║
   * ║  months and fired zero times, there are zero subscribers, and no       ║
   * ║  payload contract existed to build against. Removing a promise nobody  ║
   * ║  could keep is as valid a way to close a gap as keeping it.            ║
   * ║                                                                       ║
   * ║  ⚠️ IT MAY ONLY SHRINK, AND IT IS ALREADY EMPTY — so an addition here  ║
   * ║  is now always wrong. Offer an event you can emit, or do not offer it. ║
   * ╚═══════════════════════════════════════════════════════════════════════╝
   */
  const KNOWN_UNSOURCED: readonly string[] = []

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

  it('the exemption list is empty, so every offer is backed by a source', () => {
    /*
     * ⚠️ THE STRONGEST FORM THIS GUARD CAN TAKE, and it is only reachable
     * because the last two entries were withdrawn rather than built. Adding an
     * entry from here is always the wrong move: it would mean shipping a
     * checkbox that does nothing, which is what this file exists to stop.
     */
    expect(
      KNOWN_UNSOURCED,
      'An unsourced event is being offered again. Emit it or withdraw it — do ' +
        'not exempt it.',
    ).toEqual([])
  })
})

/**
 * Notifications go out only for events the customer was offered.
 *
 * ⚠️ THE MIRROR OF THE GUARD ABOVE, AND IT CATCHES THE OPPOSITE MISTAKE. That
 * one refuses an offered event with no source. This one refuses a source with
 * no offer.
 *
 * `emitDomainEvent` can produce nine event names; Settings lists eight; six
 * overlap. `notifyChannels` treats an empty `events` array as "everything", so
 * emitting the other three would have made every channel with nothing ticked
 * start receiving `crm.contact.created` — one Slack message per imported lead,
 * for an event the UI offers no way to switch off. Nearly shipped 2026-09-09.
 */
describe('notifications never fire for an event nobody was offered', () => {
  /*
   * ⚠️ `Set<string>`, AND THE REASON IS THE FINDING ITSELF. Typed from
   * NOTIFIABLE_EVENTS' literal union, `.has()` rejects a webhook event name
   * that is not offered — tsc refused `crm.contact.created` here. That is the
   * compiler agreeing the two sets differ, which is exactly what this test is
   * about, so the comparison is widened rather than the sets reconciled.
   */
  const offered = new Set<string>(NOTIFIABLE_EVENTS.map((e) => e.value))

  const emittable = (['contact_created', 'contact_assigned', 'stage_changed',
    'opportunity_won', 'task_completed', 'email_sent', 'email_replied',
    'email_bounced', 'email_unsubscribed'] as const)
    .map((t) => webhookEventForTrigger(t))
    .filter((e): e is NonNullable<typeof e> => e !== null)

  it('the emittable set really is wider than the offered set', () => {
    /*
     * Vacuity: if these ever coincide the filter is untested, and this test
     * should be deleted rather than left passing for the wrong reason.
     */
    const notOffered = emittable.filter((e) => !offered.has(e))
    expect(notOffered.length).toBeGreaterThan(0)
    expect(notOffered).toContain('crm.contact.created')
  })

  it('domain.ts filters on the offered list before doing any work', () => {
    const source = readFileSync(join(ROOT, 'lib/notifications/domain.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')

    // Built from NOTIFIABLE_EVENTS, not a second hand-written copy of it.
    expect(source).toContain('NOTIFIABLE_EVENTS.map')
    expect(source).toMatch(/if \(!OFFERED\.has\(event\)\) return/)
  })
})
