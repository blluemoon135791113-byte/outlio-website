/**
 * Model-produced definitions are held to a stricter standard than human ones.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THREE TIERS, AND THE DIFFERENCES BETWEEN THEM ARE THE SUBJECT.           ║
 * ║                                                                           ║
 * ║  PARSE      permissive — `advanceRun` reads every STORED definition, so a ║
 * ║             tightened parser stops a published flow from LOADING and its   ║
 * ║             author can no longer repair it.                              ║
 * ║  PUBLISH    strict — the author is present to fix what it names.         ║
 * ║  GENERATED  strictest — NOBODY IS PRESENT, and the producer will happily  ║
 * ║             emit a plausible capability that does not exist.             ║
 * ║                                                                           ║
 * ║  Every assertion below that says "the parser still accepts this" is        ║
 * ║  guarding the first tier from being tightened by someone who reads the     ║
 * ║  third and thinks it should apply everywhere.                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CAPABILITY_REGISTRY_VERSION, capabilityForFlowAction } from '@/lib/capabilities/registry'
import {
  CONDITION_OPERATORS,
  TRIGGER_TYPES,
  actionIsImplemented,
  validateFlowDefinition,
} from '@/lib/flows/definition'
import {
  compileGeneratedDefinition,
  generatedDraftWarnings,
  registrySnapshot,
  type RegistrySnapshot,
} from '@/lib/flows/generated'

const ROOT = join(__dirname, '..', '..')
const SNAPSHOT = registrySnapshot()

/** A minimal well-formed generated flow: tag the contact, then stop. */
function generated(over: Record<string, unknown> = {}) {
  return {
    trigger: { type: 'contact_created' },
    entryStepId: 's1',
    registryVersion: CAPABILITY_REGISTRY_VERSION,
    steps: [
      { id: 's1', type: 'ACTION', action: 'ADD_TAG', config: { tag: 'from-copilot' }, next: null },
    ],
    ...over,
  }
}

function branchOn(field: string, operator = 'is_not_empty') {
  return generated({
    entryStepId: 'b1',
    steps: [
      {
        id: 'b1',
        type: 'BRANCH',
        conditions: [{ field, operator }],
        match: 'all',
        onTrue: 's1',
        onFalse: null,
      },
      { id: 's1', type: 'ACTION', action: 'ADD_TAG', config: { tag: 't' }, next: null },
    ],
  })
}

function problemsOf(input: unknown, snapshot: RegistrySnapshot = SNAPSHOT): string[] {
  try {
    compileGeneratedDefinition(input, snapshot)
    return []
  } catch (error) {
    return (error as { problems?: string[] }).problems ?? [String(error)]
  }
}

describe('the snapshot is the closed world, and it is not empty', () => {
  it('pins the live registry version', () => {
    expect(SNAPSHOT.version).toBe(CAPABILITY_REGISTRY_VERSION)
  })

  it('offers the facts the builder offers', () => {
    /*
     * ⚠️ THE FLOOR THAT CAUGHT A REAL BUG. This was first written passing
     * `contact: null` to `buildDomainFacts`, which returns `{}` outright — the
     * snapshot offered ZERO fact keys and would have refused every condition a
     * model wrote. The same floor `flow-fact-coverage.test.ts` uses, so a new
     * fact domain added without a key in the probe shape is loud rather than a
     * silently shrinking world.
     */
    expect(SNAPSHOT.factKeys.length).toBeGreaterThanOrEqual(33)
    expect(new Set(SNAPSHOT.factKeys).size).toBe(SNAPSHOT.factKeys.length)
  })

  it('offers every trigger and every comparison', () => {
    expect(SNAPSHOT.triggers).toEqual(TRIGGER_TYPES)
    expect(SNAPSHOT.operators).toEqual(CONDITION_OPERATORS)
    expect(SNAPSHOT.matchModes).toEqual(['all', 'any'])
  })

  it('withholds actions Outlio cannot run', () => {
    /*
     * ⚠️ A MODEL GETS THE MENU A HUMAN GETS. An unimplemented action handed to
     * a generator produces a flow that publishes and dies at execution — the
     * failure `UNIMPLEMENTED_ACTIONS` exists to prevent.
     */
    expect(SNAPSHOT.actions.length).toBeGreaterThan(0)
    for (const action of SNAPSHOT.actions) {
      expect(actionIsImplemented(action), `${action} was offered but has no runner`).toBe(true)
    }

    /*
     * ⚠️ THE LOOP ABOVE CANNOT DETECT THE FILTER BEING REMOVED, and saying so
     * is better than implying otherwise. `UNIMPLEMENTED_ACTIONS` is empty, so
     * `.filter(actionIsImplemented)` is currently a no-op and every action
     * passes either way — proven by mutation: deleting the filter left all 20
     * tests green.
     *
     * So the filter is asserted structurally. It becomes behaviourally
     * testable the day an action is unimplemented, which is exactly the day it
     * starts mattering — and `flow-action-availability.test.ts` fails loudly at
     * that moment to send whoever did it here.
     */
    const source = readFileSync(join(ROOT, 'lib/flows/generated.ts'), 'utf8')
    expect(
      source,
      'the snapshot no longer withholds unimplemented actions; a generator ' +
        'handed one produces a flow that publishes and dies at execution',
    ).toMatch(/\.filter\(actionIsImplemented\)/)
  })

  it('withholds deprecated capabilities, which is a different filter', () => {
    /*
     * ⚠️ NOT THE SAME QUESTION AS "IS IT IMPLEMENTED". A runner can exist while
     * the capability is on its way out: `flowDefinitionWarnings` says so in its
     * own message — deprecated "still runs, but it will not be offered for new
     * flows" — and a generated flow is as new as a flow gets. Offering one has
     * the model author a flow that is deprecated the moment it is written,
     * while §5.10 requires deprecation to come with a migration path rather
     * than fresh adoption.
     *
     * ⚠️ ALSO STRUCTURAL, AND FOR THE SAME REASON. Nothing is deprecated today,
     * so the filter is a no-op that no behavioural assertion can distinguish.
     * It becomes behavioural the first time a capability is retired.
     */
    for (const action of SNAPSHOT.actions) {
      expect(
        capabilityForFlowAction(action).status,
        `${action} is deprecated but was still offered to the generator`,
      ).not.toBe('deprecated')
    }

    const source = readFileSync(join(ROOT, 'lib/flows/generated.ts'), 'utf8')
    expect(
      source,
      'the snapshot no longer withholds deprecated capabilities',
    ).toMatch(/status !== 'deprecated'/)
  })
})

describe('a correct generated flow compiles', () => {
  it('accepts the happy path', () => {
    // Vacuity: if this failed, every rejection below would pass for the wrong
    // reason — a compiler that refuses everything refuses bad input too.
    expect(problemsOf(generated())).toEqual([])
  })

  it('accepts a branch reading a real fact', () => {
    expect(problemsOf(branchOn(SNAPSHOT.factKeys[0]!))).toEqual([])
  })
})

describe('the pinned registry version is required HERE and optional in the parser', () => {
  it('refuses a generated flow with no pin', () => {
    const input = generated()
    delete (input as Record<string, unknown>).registryVersion
    expect(problemsOf(input).join(' ')).toMatch(/does not record which capability registry version/)
  })

  it('refuses a pin that does not match the snapshot', () => {
    expect(problemsOf(generated({ registryVersion: CAPABILITY_REGISTRY_VERSION + 1 })).join(' ')).toMatch(
      /built against registry version/,
    )
  })

  it('the PARSER still accepts an unpinned definition', () => {
    /*
     * ⚠️ THE TIER DIFFERENCE, ASSERTED. Five pre-registry `flow_versions` rows
     * exist in production; making the parser require a pin would stop them
     * loading, turning flows a customer can open and repair into flows that
     * cannot be read at all. If this ever fails, the parser was tightened.
     */
    const input = generated()
    delete (input as Record<string, unknown>).registryVersion
    expect(() => validateFlowDefinition(input)).not.toThrow()
  })
})

describe('only what the snapshot offered may appear', () => {
  it('refuses an action absent from the snapshot', () => {
    /*
     * ⚠️ TESTED VIA A RESTRICTED SNAPSHOT, NOT VIA AN INVENTED ACTION NAME. An
     * unknown name is already rejected by `z.enum` at the parse tier, so it
     * would prove the wrong thing. Restricting the snapshot reproduces the case
     * that actually matters: an action that EXISTS in the catalogue but was not
     * offered to the generator, which is what an unimplemented action is.
     */
    const restricted: RegistrySnapshot = {
      ...SNAPSHOT,
      actions: SNAPSHOT.actions.filter((a) => a !== 'ADD_TAG'),
    }
    expect(problemsOf(generated(), restricted).join(' ')).toMatch(
      /uses ADD_TAG, which was not offered to the generator/,
    )
  })

  it('refuses a trigger absent from the snapshot', () => {
    const restricted: RegistrySnapshot = {
      ...SNAPSHOT,
      triggers: SNAPSHOT.triggers.filter((t) => t !== 'contact_created'),
    }
    expect(problemsOf(generated(), restricted).join(' ')).toMatch(
      /is not a trigger Outlio offers/,
    )
  })

  it('refuses a comparison absent from the snapshot', () => {
    const restricted: RegistrySnapshot = {
      ...SNAPSHOT,
      operators: SNAPSHOT.operators.filter((o) => o !== 'is_not_empty'),
    }
    expect(problemsOf(branchOn(SNAPSHOT.factKeys[0]!), restricted).join(' ')).toMatch(
      /uses the comparison "is_not_empty", which does not exist/,
    )
  })
})

describe('an invented fact key is the failure the parser cannot catch', () => {
  it('refuses a plausible fact that does not exist', () => {
    /*
     * ⚠️ THIS IS THE ONE A MODEL ACTUALLY DOES. `contact.seniority` parses —
     * `condition.field` is an open string — publishes, and then evaluates to
     * undefined on every contact, sending all of them down the same branch.
     * Nothing errors. Nothing is logged. The flow simply does one thing to
     * everybody.
     */
    expect(problemsOf(branchOn('contact.seniority')).join(' ')).toMatch(
      /reads "contact\.seniority", which is not a fact Outlio can observe/,
    )
  })

  it('the PARSER still accepts it, because a stored flow must load', () => {
    // A fact key removed from the catalogue must not stop the flow that used it
    // from opening. Same tier argument as the version pin.
    expect(() => validateFlowDefinition(branchOn('contact.seniority'))).not.toThrow()
  })

  it('allows a vars. reference, which is author-named and not a fact', () => {
    /*
     * Flow variables are named at build time (0108), so they are not in the
     * fact catalogue and cannot be. The engine already distinguishes them by
     * prefix; refusing them here would break every flow that uses one.
     */
    expect(problemsOf(branchOn('vars.score'))).toEqual([])
  })
})

describe('missing ids are handed over, not thrown away', () => {
  /*
   * ╔═══════════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ THIS TIER USED TO RUN `publishProblems` AND REJECT. THAT WAS WRONG,   ║
   * ║  AND THE FIRST REAL EVAL RUN IS WHAT PROVED IT.                          ║
   * ║                                                                           ║
   * ║  The model does not know this workspace's list, stage, pipeline or user   ║
   * ║  ids — it was never given them. Rejecting a draft for a missing `listId`  ║
   * ║  made it DECLINE perfectly buildable requests: "Missing listId for the    ║
   * ║  REMOVE_FROM_LIST action".                                               ║
   * ║                                                                           ║
   * ║  ⚠️ STRICT IN THE WRONG DIMENSION. Be harsh about what a person CANNOT    ║
   * ║  see — an invented capability, a fact Outlio does not observe, a stale    ║
   * ║  pin. A missing list id is the opposite: an empty dropdown beside the     ║
   * ║  step that needs it, in front of the person who knows the answer.        ║
   * ╚═══════════════════════════════════════════════════════════════════════════╝
   */
  it('a step with no required config still compiles', () => {
    const input = generated({
      steps: [{ id: 's1', type: 'ACTION', action: 'ASSIGN_OWNER', config: {}, next: null }],
    })
    expect(problemsOf(input)).toEqual([])
  })

  it('but it is reported as something the draft still needs', () => {
    /*
     * ⚠️ NOT SILENTLY DROPPED. The gap is surfaced so the UI can say the draft
     * is unfinished; it simply is not a reason to throw the draft away.
     */
    const definition = compileGeneratedDefinition(
      generated({
        steps: [{ id: 's1', type: 'ACTION', action: 'ASSIGN_OWNER', config: {}, next: null }],
      }),
      SNAPSHOT,
    )
    expect(generatedDraftWarnings(definition).join(' ')).toMatch(/needs userId set/)
  })

  it('the publish gate is untouched, which is what makes this safe', () => {
    /*
     * `publishFlow` runs `publishProblems` itself, so an unfinished draft
     * cannot become a live flow. Asserted here because the leniency above is
     * only defensible while that remains true.
     */
    const publish = readFileSync(join(ROOT, 'app/(product)/flows/actions.ts'), 'utf8')
    expect(publish).toMatch(/publishProblems\(authorized\)/)
  })

  it('still reports every problem at once, not the first', () => {
    const input = generated({
      registryVersion: CAPABILITY_REGISTRY_VERSION + 5,
      trigger: { type: 'contact_created' },
      entryStepId: 'b1',
      steps: [
        {
          id: 'b1',
          type: 'BRANCH',
          conditions: [{ field: 'contact.invented', operator: 'is_not_empty' }],
          match: 'all',
          onTrue: null,
          onFalse: null,
        },
      ],
    })
    expect(problemsOf(input).length).toBeGreaterThanOrEqual(2)
  })
})

describe('the operator list has one home', () => {
  it('the builder draws from the same list the schema enforces', () => {
    /*
     * ⚠️ IT WAS DUPLICATED AND UNGUARDED. `FlowBuilder.tsx`'s
     * `BRANCH_OPERATORS` is typed `{ key: string }`, so a typo would compile,
     * render a dropdown entry, and produce a condition the schema rejects at
     * publish. They matched; nothing kept them matched. A third copy for the
     * generator is where that stops being survivable.
     */
    const builder = readFileSync(join(ROOT, 'components/flows/FlowBuilder.tsx'), 'utf8')
    /*
     * ⚠️ ANCHOR ON `= [`, NOT ON THE DECLARATION. The line is
     * `const BRANCH_OPERATORS: { key: string; label: string }[] = [`, so the
     * first `]` after the name belongs to the TYPE ANNOTATION — slicing to it
     * captured an empty string and extracted zero keys. The floor below is
     * what surfaced that; without it this test would have passed over nothing
     * and reported parity it never checked.
     */
    const declared = builder.indexOf('const BRANCH_OPERATORS')
    const arrayStart = builder.indexOf('= [', declared)
    const block = builder.slice(arrayStart, builder.indexOf('\n]', arrayStart))
    const keys = [...block.matchAll(/key: '(\w+)'/g)].map((m) => m[1]!)

    expect(keys.length, 'the BRANCH_OPERATORS extraction stopped matching').toBeGreaterThanOrEqual(10)
    for (const key of keys) {
      expect(
        CONDITION_OPERATORS as readonly string[],
        `the builder offers "${key}", which the schema will reject`,
      ).toContain(key)
    }
  })

  it('the schema reads the exported list rather than an inline copy', () => {
    const source = readFileSync(join(ROOT, 'lib/flows/definition.ts'), 'utf8')
    expect(source).toMatch(/operator: z\.enum\(CONDITION_OPERATORS\)/)
  })
})

describe('this tier contains no model call', () => {
  it('imports nothing that talks to a provider', () => {
    /*
     * ⚠️ DELIBERATE, AND THE REASON THE FILE EXISTS BEFORE ANY GENERATION. If
     * this module ever imports a provider, `model-call-boundary.test.ts` will
     * refuse it — but by then the compiler and the prompt would be entangled,
     * which is the two-candidate-causes problem PHASE_13's deferral named.
     */
    const source = readFileSync(join(ROOT, 'lib/flows/generated.ts'), 'utf8')
    expect(source).not.toMatch(/resolveLlmProvider|hubbleExecute|@\/lib\/intelligence\/llm/)
  })
})
