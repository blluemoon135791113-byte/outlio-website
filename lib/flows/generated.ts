/**
 * The third validation tier: a flow definition that a MODEL produced.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THERE ARE NOW THREE TIERS, AND THEY ARE DELIBERATELY DIFFERENT.          ║
 * ║                                                                           ║
 * ║  PARSE    `validateFlowDefinition` — must stay permissive. `advanceRun`   ║
 * ║           parses every STORED definition on every run, so tightening it   ║
 * ║           stops a published flow from LOADING and its author can no       ║
 * ║           longer open it to repair it. "Retroactively invalidating stored ║
 * ║           data is a migration, not a validation."                        ║
 * ║                                                                           ║
 * ║  PUBLISH  `publishProblems` — strict, and the author is present to fix    ║
 * ║           what it names.                                                  ║
 * ║                                                                           ║
 * ║  GENERATED  this file — strictest, because NOBODY IS PRESENT. There is no ║
 * ║           author to read a message, and the producer is a model that will ║
 * ║           happily emit a plausible capability ID that does not exist.     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * §5.10, verbatim: *"the model may emit only capability IDs and enum values
 * present in the registry snapshot handed to it. Anything else = validation
 * failure, not a repair opportunity."*
 *
 * ⚠️ "NOT A REPAIR OPPORTUNITY" IS THE LOAD-BEARING HALF. The tempting design
 * is to fix what the model got nearly right — map `ADD_TAGS` to `ADD_TAG`,
 * coerce `is_blank` to `is_empty`. Every such repair is a guess about intent
 * made on behalf of someone who is not here, and it converts a loud failure
 * into a flow that runs and does something subtly different from what was
 * asked. The repair loop belongs upstream: hand the errors back to the model
 * and let it try again, which is a second attempt, not a silent correction.
 *
 * ⚠️ THIS FILE CONTAINS NO MODEL CALL, ON PURPOSE. It is the thing that makes
 * generated output safe, so it exists before anything generates. Building the
 * generation first would give every bad output two candidate causes — the
 * prompt and the compiler — which is the two-candidate-causes problem
 * PHASE_13's original deferral was written to avoid.
 */
import {
  ACTION_TYPES,
  CONDITION_OPERATORS,
  FlowDefinitionError,
  TRIGGER_TYPES,
  actionIsImplemented,
  publishProblems,
  validateFlowDefinition,
  type ActionType,
  type ConditionOperator,
  type FlowDefinition,
  type TriggerType,
} from '@/lib/flows/definition'
import { buildDomainFacts } from '@/lib/flows/facts'
import {
  CAPABILITY_REGISTRY_VERSION,
  capabilityForFlowAction,
} from '@/lib/capabilities/registry'

/** The closed world a model is allowed to draw from. */
export type RegistrySnapshot = {
  /** Pinned onto the definition and re-checked here. */
  version: number
  actions: readonly ActionType[]
  triggers: readonly TriggerType[]
  operators: readonly ConditionOperator[]
  matchModes: readonly ('all' | 'any')[]
  /** Fact keys a BRANCH condition may read. */
  factKeys: readonly string[]
}

/**
 * Fact keys, derived from the builder rather than restated.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ EVERY DOMAIN KEY MUST BE PRESENT, AND `contact` MUST NOT BE NULL.     ║
 * ║                                                                           ║
 * ║  I first wrote this with `contact: null` and asserted in a comment that    ║
 * ║  the key set was stable across empty input. It is not, and the comment     ║
 * ║  was false: `buildDomainFacts` returns `{}` outright for a null contact,   ║
 * ║  so the snapshot offered ZERO fact keys and would have rejected every      ║
 * ║  condition a model wrote. Caught by probing the value instead of trusting  ║
 * ║  the prose.                                                               ║
 * ║                                                                           ║
 * ║  The real contract is three-way, and this shape is built from it:          ║
 * ║    `contact: null`         → no facts at all, "no contact on this run"     ║
 * ║    a domain key `undefined` → that domain's keys ABSENT, "could not        ║
 * ║                               observe"                                    ║
 * ║    a domain key present     → keys PRESENT with null, "observed absent"    ║
 * ║                                                                           ║
 * ║  So enumerating the catalogue means one contact and every domain present.  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THIS SHAPE CAN GO STALE, so it is not trusted on its own. A new fact
 * domain added to `buildDomainFacts` without a key here would silently shrink
 * the snapshot — the model would be offered fewer facts and its correct
 * conditions refused. `flow-generated-tier.test.ts` asserts the count against
 * the same floor `flow-fact-coverage.test.ts` uses, so the shrink is loud.
 */
function factKeys(): string[] {
  return Object.keys(
    buildDomainFacts({
      // Values are irrelevant — only the KEYS are read. Nulls exercise the
      // observed-absent path, which still yields keys.
      contact: {
        full_name: null,
        first_name: null,
        last_name: null,
        job_title: null,
        headline: null,
        location: null,
        owner_user_id: null,
        primary_company_id: null,
      },
      company: null,
      opportunities: [],
      activities: [],
      tasks: [],
      messages: [],
      threads: [],
    }),
  )
}

/**
 * The snapshot as of right now.
 *
 * ⚠️ ONLY IMPLEMENTED ACTIONS ARE OFFERED. An action in the catalogue without a
 * runner is exactly what `UNIMPLEMENTED_ACTIONS` exists to withhold, and a
 * model given it would produce a flow that publishes and dies at execution.
 * This is the same filter `FlowBuilder.tsx` applies to its pickers — the model
 * gets the menu a human gets.
 */
export function registrySnapshot(): RegistrySnapshot {
  return {
    version: CAPABILITY_REGISTRY_VERSION,
    /*
     * ⚠️ DEPRECATED IS WITHHELD TOO, AND THAT IS NOT THE SAME FILTER.
     * `actionIsImplemented` asks "does a runner exist"; `status` asks "should
     * anything NEW use this". `flowDefinitionWarnings` states the intent in its
     * own message — a deprecated capability "still runs, but it will not be
     * offered for new flows" — and a generated flow is as new as a flow gets.
     *
     * Offering one would have the model author a flow that is deprecated the
     * moment it is written, and §5.10 requires deprecation to come with a
     * migration path rather than fresh adoption.
     *
     * ⚠️ LATENT TODAY: nothing is deprecated, so this filter is currently a
     * no-op, exactly like the implemented filter beside it. Both are asserted
     * structurally in the test for that reason.
     */
    actions: (Object.keys(ACTION_TYPES) as ActionType[])
      .filter(actionIsImplemented)
      .filter((action) => capabilityForFlowAction(action).status !== 'deprecated'),
    triggers: TRIGGER_TYPES,
    operators: CONDITION_OPERATORS,
    matchModes: ['all', 'any'],
    factKeys: factKeys(),
  }
}

/**
 * Validates a definition a model produced, against the snapshot it was given.
 *
 * Throws `FlowDefinitionError` with every problem found — collected rather than
 * first-only, so a repair attempt upstream gets the whole picture instead of
 * discovering one fault per round trip.
 */
export function compileGeneratedDefinition(
  input: unknown,
  snapshot: RegistrySnapshot,
): FlowDefinition {
  /*
   * Parse first, and do NOT catch. A definition that is not even well-formed
   * has nothing for the checks below to read, and `FlowDefinitionError`'s
   * problems already say what is wrong.
   */
  const definition = validateFlowDefinition(input)

  const problems: string[] = []

  /*
   * ╔═════════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ THE PINNED VERSION IS REQUIRED HERE AND OPTIONAL IN THE PARSER.     ║
   * ║                                                                         ║
   * ║  `flowDefinitionSchema` makes `registryVersion` optional so that five    ║
   * ║  pre-registry `flow_versions` rows in production still parse — absent    ║
   * ║  means "compiled before versions were recorded". A GENERATED definition  ║
   * ║  has no such history: if it arrives unpinned, we cannot know which       ║
   * ║  closed set the model was working from, and §5.10's whole mechanism is   ║
   * ║  the pin. Absent is therefore a failure here and silence there.         ║
   * ╚═════════════════════════════════════════════════════════════════════════╝
   */
  if (definition.registryVersion === undefined) {
    problems.push(
      'The generated flow does not record which capability registry version it was built against.',
    )
  } else if (definition.registryVersion !== snapshot.version) {
    problems.push(
      `The generated flow was built against registry version ${definition.registryVersion}, but the current version is ${snapshot.version}.`,
    )
  }

  if (!snapshot.triggers.includes(definition.trigger.type)) {
    problems.push(`"${definition.trigger.type}" is not a trigger Outlio offers.`)
  }

  for (const step of definition.steps) {
    const where = step.label?.trim() || step.id

    if (step.type === 'ACTION') {
      /*
       * ⚠️ CHECKED AGAINST THE SNAPSHOT, NOT AGAINST `ACTION_TYPES`. The
       * snapshot withholds unimplemented actions, so reading the catalogue
       * directly would accept exactly the ones the model was never offered.
       */
      if (!snapshot.actions.includes(step.action)) {
        problems.push(`"${where}" uses ${step.action}, which was not offered to the generator.`)
      }
      continue
    }

    if (step.type === 'BRANCH') {
      if (!snapshot.matchModes.includes(step.match)) {
        problems.push(`"${where}" matches on "${step.match}", which is not a match mode.`)
      }
      for (const condition of step.conditions) {
        if (!snapshot.operators.includes(condition.operator)) {
          problems.push(`"${where}" uses the comparison "${condition.operator}", which does not exist.`)
        }
        /*
         * ⚠️ THE ONE CHECK THE PARSER CANNOT MAKE. `condition.field` is an open
         * string in the schema, deliberately, so a stored flow referencing a
         * removed fact still loads. A model, though, will invent a
         * plausible-looking key — `contact.seniority`, `company.revenue` —
         * which parses, publishes, and then silently evaluates to undefined
         * on every contact, sending all of them down the same branch.
         *
         * ⚠️ `vars.` IS EXEMPT. Flow variables are named by the author at
         * build time (0108), so they are not in the fact catalogue and cannot
         * be; the prefix is how the engine already tells them apart.
         */
        if (
          !condition.field.startsWith('vars.') &&
          !snapshot.factKeys.includes(condition.field)
        ) {
          problems.push(
            `"${where}" reads "${condition.field}", which is not a fact Outlio can observe.`,
          )
        }
      }
    }
  }

  /*
   * ⚠️ THE PUBLISH TIER RUNS TOO, AND IS NOT DUPLICATED HERE. It catches the
   * missing required config — an ASSIGN_OWNER with no `userId` — that a model
   * omits constantly because the shape looks complete without it. Re-stating
   * those rules would be the two-implementations defect; calling them is the
   * whole point of them being a function.
   */
  problems.push(...publishProblems(definition))

  if (problems.length > 0) throw new FlowDefinitionError(problems)
  return definition
}
