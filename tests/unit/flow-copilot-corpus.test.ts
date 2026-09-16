/**
 * The eval corpus is checked before it is ever used to judge a model.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ A STALE CORPUS BLAMES THE MODEL FOR THE CORPUS'S OWN ROT.            ║
 * ║                                                                           ║
 * ║  If a case expects `ADD_TAG` after that action is renamed, every model     ║
 * ║  scores as failing and the fault reads as the model's. If a REFUSAL case   ║
 * ║  asks for something that later becomes available, a correct answer is      ║
 * ║  scored as a failure forever.                                             ║
 * ║                                                                           ║
 * ║  Both are silent. So every expectation is checked against the LIVE         ║
 * ║  snapshot here — offline, free, and in the default loop — long before      ║
 * ║  anyone spends money running the corpus against a real model.             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import { TRIGGER_TYPES } from '@/lib/flows/definition'
import { registrySnapshot } from '@/lib/flows/generated'
import { CORPUS } from '../eval/flow-copilot-corpus'

const SNAPSHOT = registrySnapshot()
const FLOWS = CORPUS.filter((c) => c.outcome === 'flow')
const REFUSALS = CORPUS.filter((c) => c.outcome === 'refusal')

describe('the corpus is big enough and varied enough to mean something', () => {
  it('has at least the thirty §5.10 asks for', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(30)
  })

  it('asks for the impossible often enough to catch invention', () => {
    /*
     * ⚠️ THE ONE PROPERTY THAT MAKES THIS A TEST RATHER THAN A DEMO. A corpus
     * of only-satisfiable prompts scores a model that invents capabilities
     * exactly as highly as one that refuses honestly — which is the single
     * behaviour §5.10 cares about.
     */
    expect(REFUSALS.length).toBeGreaterThanOrEqual(8)
    expect(FLOWS.length).toBeGreaterThanOrEqual(20)
  })

  it('has unique ids and no duplicated prompts', () => {
    const ids = CORPUS.map((c) => c.id)
    expect(new Set(ids).size, 'two cases share an id').toBe(ids.length)
    const prompts = CORPUS.map((c) => c.prompt.toLowerCase().trim())
    expect(new Set(prompts).size, 'a prompt is duplicated').toBe(prompts.length)
  })

  it('covers most of the trigger surface', () => {
    /*
     * Not all 17: `campaign_enrolled` and friends are covered, but demanding
     * every trigger would pad the corpus with cases nobody would write. Two
     * thirds is enough that a trigger being dropped from the product shows up.
     */
    const covered = new Set(FLOWS.map((c) => c.trigger))
    expect(covered.size).toBeGreaterThanOrEqual(Math.ceil(TRIGGER_TYPES.length * 0.6))
  })

  it('covers a real spread of actions, not the same one thirty times', () => {
    const used = new Set(FLOWS.flatMap((c) => c.mustUse))
    expect(used.size).toBeGreaterThanOrEqual(12)
  })

  it('exercises branches and waits, which is where flows go wrong', () => {
    expect(FLOWS.filter((c) => c.needsBranch).length).toBeGreaterThanOrEqual(3)
    expect(FLOWS.filter((c) => c.needsWait).length).toBeGreaterThanOrEqual(3)
  })
})

describe('every expectation is satisfiable against the live snapshot', () => {
  it('names only triggers that exist', () => {
    const unknown = FLOWS.filter((c) => !SNAPSHOT.triggers.includes(c.trigger)).map((c) => c.id)
    expect(
      unknown,
      'These cases expect a trigger the product no longer offers, so every ' +
        'model will score as failing and the fault will look like the model’s.',
    ).toEqual([])
  })

  it('names only actions that exist and are offered', () => {
    const unknown = FLOWS.flatMap((c) =>
      [...c.mustUse, ...(c.mustNotUse ?? [])]
        .filter((a) => !SNAPSHOT.actions.includes(a))
        .map((a) => `${c.id}: ${a}`),
    )
    expect(
      unknown,
      'These cases name an action absent from the snapshot the model is given — ' +
        'either renamed, unimplemented, or deprecated. The case is wrong, not the model.',
    ).toEqual([])
  })

  it('does not expect and forbid the same action in one case', () => {
    const contradictory = FLOWS.filter((c) =>
      c.mustUse.some((a) => (c.mustNotUse ?? []).includes(a)),
    ).map((c) => c.id)
    expect(contradictory, 'unsatisfiable by construction').toEqual([])
  })
})

describe('every refusal case is still genuinely impossible', () => {
  /*
   * ⚠️ THE DIRECTION NOBODY CHECKS. A refusal case silently becomes wrong the
   * day the product gains the capability it asks for — and then a model that
   * correctly builds the flow is marked down, forever, for being right.
   */
  const IMPOSSIBLE_TERMS: Record<string, RegExp> = {
    'refuse-seniority': /seniority/i,
    'refuse-revenue': /revenue/i,
    'refuse-score': /score/i,
  }

  it('the facts they rely on being absent are still absent', () => {
    for (const [id, term] of Object.entries(IMPOSSIBLE_TERMS)) {
      expect(CORPUS.some((c) => c.id === id), `${id} was removed from the corpus`).toBe(true)
      const present = SNAPSHOT.factKeys.filter((k) => term.test(k))
      expect(
        present,
        `${id} expects a refusal, but the snapshot now offers ${present.join(', ')} — ` +
          'the case is stale and would mark a correct answer wrong.',
      ).toEqual([])
    }
  })

  it('the capabilities they rely on being absent are still absent', () => {
    /*
     * Matched against the ACTION names actually offered. If a SEND_SMS or a
     * LINKEDIN_* action ever lands, these cases must be rewritten rather than
     * left to fail a model that did the right thing.
     */
    for (const term of [/SMS/i, /LINKEDIN/i, /DELETE/i, /CHARGE|PAYMENT|BILL/i, /CALL(?!_)/i]) {
      const present = SNAPSHOT.actions.filter((a) => term.test(a))
      expect(
        present,
        `The corpus has refusal cases assuming nothing matches ${term}, but the ` +
          `snapshot now offers ${present.join(', ')}.`,
      ).toEqual([])
    }
  })

  it('each states what is absent, rather than being vaguely unsatisfiable', () => {
    // "The model should refuse vague things" is a mood, not a test. A named
    // absence is what makes the case checkable by the two tests above.
    for (const c of REFUSALS) {
      expect(c.because.length, `${c.id} has no reason recorded`).toBeGreaterThan(20)
    }
  })
})

describe('the corpus scanner is not vacuous', () => {
  it('actually read the cases', () => {
    // Every assertion above filters. An empty CORPUS satisfies all of them.
    expect(CORPUS.length).toBeGreaterThan(0)
    expect(FLOWS.length + REFUSALS.length).toBe(CORPUS.length)
    expect(SNAPSHOT.actions.length).toBeGreaterThan(0)
    expect(SNAPSHOT.factKeys.length).toBeGreaterThan(0)
  })
})
