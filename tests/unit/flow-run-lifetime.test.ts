/**
 * The two safeguards §10 asked for and nothing implemented — CRM-DN-04.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  WHAT WAS MISSING, AND WHY EACH ONE MATTERS.                              ║
 * ║                                                                           ║
 * ║  1. NO RUN EVER EXPIRED. `MAX_WAIT_HOURS` bounds ONE wait. A graph may    ║
 * ║     chain waits, and a cycle containing a wait is legal by design — a     ║
 * ║     nurture loop. Such a run sat in `waiting` forever: re-claimed by      ║
 * ║     every tick, holding a contact enrolled, and still able to send.       ║
 * ║                                                                           ║
 * ║  2. NOTHING CAPPED SIDE EFFECTS ON ONE PATH. A graph could walk a single  ║
 * ║     contact through any number of sends. The node cap (200) does not      ║
 * ║     help: it counts steps in the graph, not what happens to one person.   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ PROVEN NON-VACUOUS BY BREAKING IT (§2.1): raising
 * MAX_SIDE_EFFECTS_PER_PATH above the fixture's count makes "refuses a path
 * that sends more than the ceiling" fail, and removing the `cycleReached`
 * guard makes "says nothing about a nurture loop's unbounded wait" fail.
 * Verified by mutation before this file shipped.
 */
import { describe, expect, it } from 'vitest'

import {
  MAX_RUN_LIFETIME_HOURS,
  MAX_SIDE_EFFECTS_PER_PATH,
  publishProblems,
  validateFlowDefinition,
  type FlowDefinition,
} from '@/lib/flows/definition'

/** A send is irreversible; the ceiling counts it. */
function send(id: string, next: string | null) {
  return {
    id,
    type: 'ACTION' as const,
    action: 'SEND_EMAIL' as const,
    config: { accountId: 'acct', subject: 's', body: 'b' },
    next,
  }
}

/** A tag is reversible; the ceiling must ignore it however many there are. */
function tag(id: string, next: string | null) {
  return {
    id,
    type: 'ACTION' as const,
    action: 'ADD_TAG' as const,
    config: { tag: 'x' },
    next,
  }
}

function wait(id: string, hours: number, next: string | null) {
  return { id, type: 'WAIT' as const, hours, next }
}

function definition(steps: unknown[], entryStepId: string): FlowDefinition {
  return validateFlowDefinition({
    schemaVersion: 1,
    trigger: { type: 'contact_created' },
    entryStepId,
    steps,
  })
}

/** `n` sends chained head to tail. */
function chainOfSends(n: number) {
  return Array.from({ length: n }, (_, i) => send(`s${i}`, i === n - 1 ? null : `s${i + 1}`))
}

describe('the run lifetime cap', () => {
  it('exceeds the longest single wait, or one legal wait would kill its own run', () => {
    /*
     * ⚠️ THE INVARIANT THE WHOLE DECISION TURNS ON.
     *
     * The spec proposed 90 days for the maximum wait AND for the run lifetime,
     * which cannot both hold: a flow with one legal 90-day wait would be halted
     * at the moment it resumed. CRM-DN-04 kept the 90-day wait, so the lifetime
     * is the number that moved. If someone later lowers the lifetime or raises
     * the wait, this fails rather than silently expiring live nurture flows.
     */
    const maxWaitHours = 24 * 90
    expect(MAX_RUN_LIFETIME_HOURS).toBeGreaterThan(maxWaitHours)
  })

  it('refuses to publish a flow whose waits cannot finish inside it', () => {
    /*
     * One wait cannot exceed the lifetime — the schema caps a single wait at 90
     * days and the lifetime is a year. It takes a CHAIN, which is exactly the
     * case the cap exists for and the one no per-step limit can see.
     */
    const maxWaitHours = 24 * 90
    const needed = Math.floor(MAX_RUN_LIFETIME_HOURS / maxWaitHours) + 1
    const steps = Array.from({ length: needed }, (_, i) =>
      wait(`w${i}`, maxWaitHours, i === needed - 1 ? null : `w${i + 1}`),
    )

    const problems = publishProblems(definition(steps, 'w0'))
    expect(problems.join(' ')).toMatch(/waits .* in total/i)
  })

  it('says nothing about a nurture loop, whose wait is unbounded on purpose', () => {
    /*
     * A cycle containing a wait is legal and deliberate — check back weekly,
     * forever. Its total wait is infinite by construction, so the static check
     * must stay silent and leave it to the runtime cap. Reporting it would
     * make the honest way to build a nurture loop unpublishable.
     */
    const def = definition([wait('w', 24 * 7, 'a'), tag('a', 'w')], 'w')

    expect(publishProblems(def).join(' ')).not.toMatch(/waits .* in total/i)
  })
})

describe('the per-path side-effect ceiling', () => {
  it('allows a path at exactly the ceiling', () => {
    const def = definition(chainOfSends(MAX_SIDE_EFFECTS_PER_PATH), 's0')

    expect(publishProblems(def).join(' ')).not.toMatch(/irreversible/i)
  })

  it('refuses a path that sends more than the ceiling', () => {
    const def = definition(chainOfSends(MAX_SIDE_EFFECTS_PER_PATH + 1), 's0')

    const problems = publishProblems(def).join(' ')
    expect(problems).toMatch(/irreversible actions/i)
    expect(problems).toContain(String(MAX_SIDE_EFFECTS_PER_PATH + 1))
  })

  it('ignores reversible steps however many there are', () => {
    /*
     * The limit is about what cannot be taken back. Twenty tags on one path is
     * untidy, not dangerous, and refusing it would make the ceiling a general
     * complexity budget — which is not what it is for.
     */
    const steps = Array.from({ length: 20 }, (_, i) =>
      tag(`t${i}`, i === 19 ? null : `t${i + 1}`),
    )

    expect(publishProblems(definition(steps, 't0')).join(' ')).not.toMatch(/irreversible/i)
  })

  it('counts per path, not per graph', () => {
    /*
     * ⚠️ THE DISTINCTION THAT MAKES THIS USABLE. A branch whose two arms send
     * six each is twelve sends in the graph and six for any one contact. A
     * per-graph count would refuse a perfectly safe flow and push authors into
     * splitting flows for no benefit.
     */
    const arm = (prefix: string) =>
      Array.from({ length: 6 }, (_, i) =>
        send(`${prefix}${i}`, i === 5 ? null : `${prefix}${i + 1}`),
      )

    const def = definition(
      [
        {
          id: 'b',
          type: 'BRANCH' as const,
          conditions: [{ field: 'contact.job_title', operator: 'is_empty' as const }],
          onTrue: 'L0',
          onFalse: 'R0',
        },
        ...arm('L'),
        ...arm('R'),
      ],
      'b',
    )

    // Twelve sends exist; the worst single contact walks six.
    expect(publishProblems(def).join(' ')).not.toMatch(/irreversible/i)
  })
})

describe('the limits apply at publish, never to a stored definition', () => {
  it('still parses a definition that exceeds the ceiling', () => {
    /*
     * ⚠️ THE TRAP THIS REPO ALREADY FELL INTO ONCE. `advanceRun` parses the
     * run's pinned version on every advance. If the ceiling lived in
     * validateFlowDefinition, every already-published flow above the limit
     * would fail to LOAD — halting live runs mid-sequence for a rule that did
     * not exist when they were published.
     */
    const steps = chainOfSends(MAX_SIDE_EFFECTS_PER_PATH + 5)

    expect(() =>
      validateFlowDefinition({
        schemaVersion: 1,
        trigger: { type: 'contact_created' },
        entryStepId: 's0',
        steps,
      }),
    ).not.toThrow()
  })
})
