/**
 * The customer's own campaign workflow — Phase 20.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THESE ARE BEHAVIOURAL TESTS, NOT SOURCE SCANS, and that is possible   ║
 * ║  because `steps.ts`, `placeholders.ts` and `workflow.ts` are pure. Where   ║
 * ║  this repository has had to grep its own source it was because the thing   ║
 * ║  under test needed a database; none of these do, so nothing here asserts   ║
 * ║  about text when it could assert about a result.                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import { POSITIVE } from '@/lib/linkedin/outcomes'
import {
  PLACEHOLDERS,
  resolveBody,
  validateBody,
} from '@/lib/linkedin/placeholders'
import {
  campaignOutcomes,
  consumesBudget,
  outcomesForStep,
  positiveOutcomeFor,
  producesTask,
  STEPS,
  STEP_ACTIONS,
  taskKindFor,
  type StepAction,
} from '@/lib/linkedin/steps'
import { KIND_FOR_TASK } from '@/lib/linkedin/budget'
import {
  canRemoveStep,
  compileWorkflow,
  nextStep,
  type WorkflowStep,
} from '@/lib/linkedin/workflow'

// ---------------------------------------------------------------------------
// The owner's corrections, encoded
// ---------------------------------------------------------------------------

describe("what Outlio prepares — the owner's 2026-09-15 corrections", () => {
  it('prepares no message text: every text step is operator-authored', () => {
    /*
     * "outlio does not prepare the note text or the message it will be written
     *  manually". So no step may declare that Outlio composes anything — the
     *  only `prepares` values are the operator's own text, a validated link,
     *  nothing at all, or internal.
     */
    for (const action of STEP_ACTIONS) {
      expect(['text', 'link', 'nothing', 'internal']).toContain(STEPS[action].prepares)
    }
  })

  it('prepares NOTHING for a comment — no draft, by decision', () => {
    /*
     * ⚠️ THE OWNER'S EXPLICIT CASE. "outlio does not prepares the comment draft
     * it would just be marked as comments/engagement done". A draft would be
     * Outlio inventing a reaction to a post it has never seen.
     */
    expect(STEPS.COMMENT_POST.prepares).toBe('nothing')
    expect(STEPS.COMMENT_POST.body).toBe('none')
  })

  it('cannot fetch a post URL, so the post steps carry the profile instead', () => {
    // Rule 1 forbids requests to linkedin.com, and post feeds need a session.
    expect(STEPS.LIKE_POST.prepares).toBe('link')
    expect(STEPS.LIKE_POST.performs).toMatch(/profile/i)
  })

  it('has no voice-note action — deferred, not stubbed', () => {
    /*
     * "THE VOICE CLONING AND TEXT TO SPEECH KEEP IT FOR LATER". Rule 7: an enum
     * value with no implementation is a selectable action that does nothing,
     * which is the shape of the complaint that produced this phase.
     */
    expect(STEP_ACTIONS).not.toContain('VOICE_NOTE')
  })

  it('names who performs every step, and only WAIT/ADD_TAG have no human half', () => {
    const internal = STEP_ACTIONS.filter((a) => STEPS[a].performs === null)
    expect([...internal].sort()).toEqual(['ADD_TAG', 'WAIT'])
    for (const action of STEP_ACTIONS) {
      if (STEPS[action].performs === null) continue
      // Non-empty: the card renders this as "You do this: …".
      expect(STEPS[action].performs!.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Outcomes derive from the workflow, not from a constant
// ---------------------------------------------------------------------------

describe("the owner's outcome requirement", () => {
  it('offers only the outcomes the built steps can produce', () => {
    /*
     * "once its save then they have the option on actions they added only not
     *  fixed actions like, sent connection, booked a meeting, etc etc"
     */
    const messagingOnly = campaignOutcomes(['DIRECT_MESSAGE', 'WAIT'])
    expect(messagingOnly).toContain('MESSAGE_MARKED_SENT')
    expect(messagingOnly, 'a campaign with no connection step offered one').not.toContain(
      'REQUEST_MARKED_SENT',
    )
    expect(messagingOnly, 'a campaign with no like/comment step offered one').not.toContain(
      'ENGAGEMENT_RECORDED',
    )
  })

  it('always offers skipped, failed and unknown whatever was built', () => {
    /*
     * ⚠️ NOT DERIVED, AND THAT IS THE POINT. These describe what happened to the
     * OPERATOR, not to the campaign. Removing `OUTCOME_UNKNOWN` from a step
     * would leave somebody who genuinely cannot tell with no honest answer —
     * and §4.17 exists because the answer they would pick instead is "sent".
     */
    for (const action of STEP_ACTIONS) {
      const offered = outcomesForStep(action)
      expect(offered).toContain('SKIPPED')
      expect(offered).toContain('FAILED')
      expect(offered).toContain('OUTCOME_UNKNOWN')
    }
  })

  it('never offers an Observation as a task outcome', () => {
    /*
     * §4.13's rule survives the change: "mark request sent" cannot mark
     * acceptance, because acceptance gates the first DM.
     */
    const everything = campaignOutcomes(STEP_ACTIONS)
    for (const observation of [
      'CONNECTION_ACCEPTANCE_RECORDED',
      'REPLY_RECORDED',
      'MEETING_BOOKED_RECORDED',
      'MEETING_HELD_RECORDED',
      'INBOX_REVIEW_RECORDED',
    ]) {
      expect(everything, `${observation} leaked into task outcomes`).not.toContain(observation)
    }
  })

  it('gives internal steps no affirmative outcome at all', () => {
    expect(positiveOutcomeFor('WAIT')).toBeNull()
    expect(positiveOutcomeFor('ADD_TAG')).toBeNull()
  })

  it('offers exactly one affirmative outcome per step', () => {
    // "A task is a request to perform exactly one action, so 'what happened'
    //  has exactly one affirmative answer."
    for (const action of STEP_ACTIONS) {
      const offered = outcomesForStep(action)
      const affirmative = offered.filter(
        (o) => o !== 'SKIPPED' && o !== 'FAILED' && o !== 'OUTCOME_UNKNOWN',
      )
      expect(affirmative.length, `${action} offers ${affirmative.length}`).toBeLessThanOrEqual(1)
    }
  })
})

describe('one question, one implementation', () => {
  it('derives the positive outcome from outcomes.ts rather than redeclaring it', () => {
    /*
     * ⚠️ THE DEFECT THIS TEST EXISTS FOR WAS REAL AND MINE. `steps.ts` first
     * shipped with a `positiveOutcome` per step — a second copy of `POSITIVE`,
     * keyed differently. Two maps that must agree are two maps that will not,
     * and the failure mode is a result form offering an outcome the validator
     * rejects.
     */
    for (const action of STEP_ACTIONS) {
      const kind = taskKindFor(action)
      expect(positiveOutcomeFor(action)).toBe(kind ? POSITIVE[kind] : null)
    }
  })

  it('maps VISIT_PROFILE onto the EXISTING REVIEW_PROFILE kind', () => {
    /*
     * The builder card is called "Visit LinkedIn profile" because that is what
     * the owner's reference calls it. Adding a `VISIT_PROFILE` task kind would
     * split existing Phase 10 history across two labels for the same act.
     */
    expect(taskKindFor('VISIT_PROFILE')).toBe('REVIEW_PROFILE')
  })

  it('gives every task-producing step a budget bucket', () => {
    /*
     * A step with no bucket is a step that can be repeated without limit from an
     * account somebody actually owns.
     */
    for (const action of STEP_ACTIONS) {
      const kind = taskKindFor(action)
      if (!kind) continue
      expect(KIND_FOR_TASK[kind], `${action} spends no budget`).toBeTruthy()
    }
  })

  it('spends the engagement budget on likes and comments, not profile_review', () => {
    /*
     * ⚠️ §4.10 CAPS `engagement` AT ZERO AT EVERY STAGE. Mapping these to
     * `profile_review` — the tempting choice, since it is also cheap — would
     * overturn a safety limit by picking a bucket rather than by deciding to.
     */
    expect(KIND_FOR_TASK.LIKE_POST).toBe('engagement')
    expect(KIND_FOR_TASK.COMMENT_POST).toBe('engagement')
  })

  it('agrees with itself about which steps produce tasks', () => {
    for (const action of STEP_ACTIONS) {
      expect(producesTask(action)).toBe(taskKindFor(action) !== null)
      expect(consumesBudget(action)).toBe(producesTask(action))
    }
  })
})

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

describe('placeholders — rule 4 applied to the operator’s own sentence', () => {
  it('accepts the three the owner named', () => {
    expect([...PLACEHOLDERS].sort()).toEqual(['company', 'first_name', 'location'])
    const result = validateBody('Hi {{first_name}} at {{company}} in {{location}}')
    expect(result.ok).toBe(true)
    if (result.ok) expect([...result.used].sort()).toEqual(['company', 'first_name', 'location'])
  })

  it('refuses an unknown placeholder AT SAVE, and names it', () => {
    /*
     * ⚠️ THE TIMING IS THE FEATURE. `{{firstname}}` is a plausible typo for
     * `{{first_name}}`. Caught here it is a squiggle in the builder. Discovered
     * at send there are only bad options: leave it literal and a stranger reads
     * "Hey {{firstname}}", or strip it and silently send a sentence nobody wrote.
     */
    const result = validateBody('Hey {{firstname}}, about {{revenue}}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect([...result.unknown].sort()).toEqual(['firstname', 'revenue'])
  })

  it('tolerates inner whitespace, because a person typing braces will add it', () => {
    expect(validateBody('Hi {{ first_name }}').ok).toBe(true)
    const resolved = resolveBody('Hi {{ first_name }}', {
      first_name: { value: 'Jo', verification: 'VERIFIED' },
    })
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.text).toBe('Hi Jo')
  })

  it('BLOCKS rather than renders a gap when a value is missing', () => {
    /*
     * ⚠️ THE LOAD-BEARING ASSERTION. "I loved what you're building at " is not a
     * degraded message — it tells the recipient they were mail-merged, and the
     * operator whose account sends it is the one who pays for that.
     */
    const result = resolveBody('Loved your work at {{company}}', {
      first_name: { value: 'Jo', verification: 'VERIFIED' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.missing).toEqual(['company'])
  })

  it('reports EVERY missing placeholder, not just the first', () => {
    /*
     * Failing on the first would have an operator fix the company, retry, and be
     * told about the location — one round trip per gap, on a contact they may
     * decide to skip entirely once they can see the whole bill.
     */
    const result = resolveBody('{{company}} in {{location}}', {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect([...result.missing].sort()).toEqual(['company', 'location'])
  })

  it('treats a verified empty string as absent', () => {
    // "'Verified empty string' is how a blank lands in the middle of a sentence."
    const result = resolveBody('Hi {{first_name}}', {
      first_name: { value: '   ', verification: 'VERIFIED' },
    })
    expect(result.ok).toBe(false)
  })

  it('refuses an INFERRED first name — it is the first word a stranger reads', () => {
    /*
     * ⚠️ THE ASSERTION THAT PROVES THE LADDER IS WIRED UP. Splitting a full name
     * is exactly the inference that produces "Hi Van" for "Van der Berg", so
     * `first_name` demands VERIFIED while `company` accepts USER_RECORDED.
     */
    const inferred = resolveBody('Hi {{first_name}}', {
      first_name: { value: 'Van', verification: 'INFERRED' },
    })
    expect(inferred.ok).toBe(false)

    // The same evidence strength IS enough for a company name.
    const company = resolveBody('at {{company}}', {
      company: { value: 'Example Ltd', verification: 'USER_RECORDED' },
    })
    expect(company.ok).toBe(true)

    // ...and USER_RECORDED is NOT enough for a first name. This is the pair
    // that makes the two specs distinguishable rather than decorative.
    const weakName = resolveBody('Hi {{first_name}}', {
      first_name: { value: 'Jo', verification: 'USER_RECORDED' },
    })
    expect(weakName.ok).toBe(false)
  })

  it('throws rather than guessing if an unvalidated body reaches rendering', () => {
    /*
     * It cannot be reported as "missing" — the operator would go looking for a
     * contact field that does not exist — and it must not be left in place.
     * Reaching this means a caller skipped `validateBody`, which is a bug.
     */
    expect(() => resolveBody('Hi {{nope}}', {})).toThrow(/unvalidated placeholder/)
  })
})

// ---------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------

const step = (over: Partial<WorkflowStep> & { action: StepAction }): WorkflowStep => ({
  id: over.id ?? `s-${Math.random().toString(36).slice(2)}`,
  position: over.position ?? 0,
  body: over.body ?? null,
  waitDays: over.waitDays ?? null,
  /*
   * ⚠️ THE SPREAD COMES LAST AND THE DEFAULTS FIRST, so a test that passes
   * `config` overrides this and one that does not still gets `{}` rather than
   * `undefined`. `compileWorkflow` reads `step.config.tag`, which throws on
   * undefined — a helper that produced an invalid shape would fail tests for a
   * reason that has nothing to do with what they assert.
   */
  config: {},
  ...over,
})

describe('compiling a linear workflow', () => {
  it('accepts a workflow shaped like the owner’s reference', () => {
    const result = compileWorkflow([
      step({ action: 'VISIT_PROFILE', position: 0 }),
      step({ action: 'LIKE_POST', position: 1 }),
      step({ action: 'CONNECTION_REQUEST', position: 2, body: 'Hi {{first_name}}' }),
      step({ action: 'DIRECT_MESSAGE', position: 3, body: 'Thanks for connecting.' }),
      step({ action: 'WAIT', position: 4, waitDays: 1 }),
      step({ action: 'DIRECT_MESSAGE', position: 5, body: 'Following up.' }),
    ])
    expect(result.ok, JSON.stringify(result)).toBe(true)
  })

  it('refuses an empty workflow', () => {
    expect(compileWorkflow([]).ok).toBe(false)
  })

  it('refuses a workflow that asks nobody to do anything on LinkedIn', () => {
    /*
     * A campaign built only from WAIT and ADD_TAG enrols people, completes
     * instantly, and reports activity that involved no outreach at all.
     */
    const result = compileWorkflow([
      step({ action: 'ADD_TAG', position: 0 }),
      step({ action: 'WAIT', position: 1, waitDays: 2 }),
      step({ action: 'ADD_TAG', position: 2 }),
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problems.some((p) => /never asks anyone to do anything/.test(p.message))).toBe(
        true,
      )
    }
  })

  it('refuses a trailing wait, and allows a LEADING one', () => {
    /*
     * ⚠️ BOTH DIRECTIONS, because only asserting the refusal would pass on an
     * implementation that rejected every wait at either end. A leading wait is
     * "add them today, first touch on Monday" — a real thing to want, and more
     * so given people enter at different points.
     */
    const trailing = compileWorkflow([
      step({ action: 'DIRECT_MESSAGE', position: 0, body: 'hi' }),
      step({ action: 'WAIT', position: 1, waitDays: 3 }),
    ])
    expect(trailing.ok).toBe(false)

    const leading = compileWorkflow([
      step({ action: 'WAIT', position: 0, waitDays: 3 }),
      step({ action: 'DIRECT_MESSAGE', position: 1, body: 'hi' }),
    ])
    expect(leading.ok, JSON.stringify(leading)).toBe(true)
  })

  it('refuses two waits in a row', () => {
    const result = compileWorkflow([
      step({ action: 'DIRECT_MESSAGE', position: 0, body: 'hi' }),
      step({ action: 'WAIT', position: 1, waitDays: 1 }),
      step({ action: 'WAIT', position: 2, waitDays: 2 }),
      step({ action: 'DIRECT_MESSAGE', position: 3, body: 'again' }),
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.some((p) => /two waits/i.test(p.message))).toBe(true)
  })

  it('requires a message on a DM and permits a noteless connection request', () => {
    const noMessage = compileWorkflow([step({ action: 'DIRECT_MESSAGE', position: 0 })])
    expect(noMessage.ok).toBe(false)

    const noNote = compileWorkflow([step({ action: 'CONNECTION_REQUEST', position: 0 })])
    expect(noNote.ok, 'a noteless request is a real choice').toBe(true)
  })

  it('refuses a body on a step that prepares nothing', () => {
    /*
     * ⚠️ REFUSED, NOT DISCARDED. Somebody typed that text expecting it to be
     * used; dropping it silently means they find out when a card arrives with
     * their comment missing, on a post they are now looking at.
     */
    const result = compileWorkflow([
      step({ action: 'COMMENT_POST', position: 0, body: 'nice post!' }),
    ])
    expect(result.ok).toBe(false)
  })

  it('refuses an overlong connection note rather than truncating it', () => {
    const result = compileWorkflow([
      step({ action: 'CONNECTION_REQUEST', position: 0, body: 'x'.repeat(301) }),
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems[0]!.message).toMatch(/300 characters/)

    // 300 exactly is fine — proving the boundary is `>` and not `>=`.
    expect(
      compileWorkflow([step({ action: 'CONNECTION_REQUEST', position: 0, body: 'x'.repeat(300) })])
        .ok,
    ).toBe(true)
  })

  it('refuses a wait of zero days and one longer than the cap', () => {
    for (const days of [0, -1, 91]) {
      const result = compileWorkflow([
        step({ action: 'WAIT', position: 0, waitDays: days }),
        step({ action: 'DIRECT_MESSAGE', position: 1, body: 'hi' }),
      ])
      expect(result.ok, `waitDays=${days} was accepted`).toBe(false)
    }
  })

  it('refuses a duration on a step that is not a wait', () => {
    const result = compileWorkflow([
      step({ action: 'DIRECT_MESSAGE', position: 0, body: 'hi', waitDays: 3 }),
    ])
    expect(result.ok).toBe(false)
  })

  it('refuses a bad placeholder in a step body', () => {
    const result = compileWorkflow([
      step({ action: 'DIRECT_MESSAGE', position: 0, body: 'Hi {{firstname}}' }),
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems[0]!.message).toMatch(/\{\{firstname\}\}/)
  })

  it('reports EVERY problem, not the first', () => {
    // The builder marks bad cards in place; stopping at one would have somebody
    // fix a DM, save, and only then learn the wait is also wrong.
    const result = compileWorkflow([
      step({ id: 'a', action: 'DIRECT_MESSAGE', position: 0 }),
      step({ id: 'b', action: 'DIRECT_MESSAGE', position: 1, body: 'Hi {{nope}}' }),
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problems.length).toBeGreaterThanOrEqual(2)
      expect(result.problems.map((p) => p.stepId)).toContain('a')
      expect(result.problems.map((p) => p.stepId)).toContain('b')
    }
  })

  it('does not throw on an action from a newer schema than this build', () => {
    /*
     * ⚠️ THE GUARD ORDERING BUG THIS TEST CAUGHT. `compileWorkflow` indexed
     * `STEPS[step.action]` before checking the action was known, so a value from
     * a migration applied ahead of the deploy — this project's normal order —
     * threw inside a validator whose whole job is to RETURN problems.
     */
    const rogue = { id: 'x', position: 0, action: 'VOICE_NOTE', body: null, waitDays: null }
    const result = compileWorkflow([rogue as unknown as WorkflowStep])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems[0]!.message).toMatch(/VOICE_NOTE/)
  })
})

// ---------------------------------------------------------------------------
// The pointer
// ---------------------------------------------------------------------------

describe('advancing, and editing under people’s feet', () => {
  const steps: WorkflowStep[] = [
    step({ id: 'one', action: 'VISIT_PROFILE', position: 0 }),
    step({ id: 'two', action: 'DIRECT_MESSAGE', position: 1, body: 'hi' }),
    step({ id: 'three', action: 'WAIT', position: 2, waitDays: 2 }),
  ]

  it('finds the next step by id, so inserting above does not move anybody', () => {
    /*
     * ⚠️ THE WHOLE REASON THE POINTER IS AN ID. With a position pointer,
     * inserting a step above somebody shifts them onto a different step with no
     * error at all — the wrong message, from a real account, to a real stranger.
     */
    const before = nextStep(steps, 'two')
    expect(before).toEqual({ kind: 'step', step: steps[2] })

    const withInsertion = [
      steps[0]!,
      step({ id: 'inserted', action: 'LIKE_POST', position: 0.5 }),
      steps[1]!,
      steps[2]!,
    ]
    expect(nextStep(withInsertion, 'two')).toEqual({ kind: 'step', step: steps[2] })
  })

  it('distinguishes the end of the workflow from a deleted step', () => {
    /*
     * ⚠️ CONFLATING THEM WOULD REPORT A COMPLETION NOBODY PERFORMED. Both mean
     * "no next step", so returning null for each would have an enrolment whose
     * step was deleted mid-flight look like one that finished the campaign.
     */
    expect(nextStep(steps, 'three')).toEqual({ kind: 'end' })
    expect(nextStep(steps, 'gone')).toEqual({ kind: 'deleted' })
  })

  it('refuses to remove a step somebody is standing on, and says how many', () => {
    expect(canRemoveStep('two', 0)).toEqual({ ok: true })

    const one = canRemoveStep('two', 1)
    expect(one.ok).toBe(false)
    if (!one.ok) expect(one.message).toMatch(/One person/)

    const many = canRemoveStep('two', 4)
    expect(many.ok).toBe(false)
    if (!many.ok) expect(many.message).toMatch(/4 people/)
  })
})
