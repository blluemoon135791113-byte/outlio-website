import 'server-only'

/**
 * Steps that work something out.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THESE TWO WERE THE LAST UNBACKED ACTIONS, AND NOT FOR WANT OF EFFORT.   ║
 * ║                                                                           ║
 * ║  `DATE_CALC` and `TEXT_TRANSFORM` COMPUTE a value, and until migration    ║
 * ║  0108 a run had nowhere to keep one — `gatherFacts` read only the         ║
 * ║  contact, and Hubble's `storeAs` wrote an activity row nothing read back. ║
 * ║  A handler would have produced the right answer and discarded it.         ║
 * ║                                                                           ║
 * ║  ⚠️ NEITHER WRITES ANYTHING ITSELF. Each returns `output.value` and the   ║
 * ║  ENGINE persists it under the step's `storeAs` key, so there is one       ║
 * ║  implementation of "remember this" rather than one per action — and a     ║
 * ║  handler cannot write under a key another step is using.                  ║
 * ║                                                                           ║
 * ║  ⚠️ BOTH ARE PURE. No database, no clock beyond `Date.now()`, no network. ║
 * ║  That is what makes them the two actions a unit test can exercise end to  ║
 * ║  end rather than assert structurally.                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { registerAction, type ActionHandler, type ActionResult } from '@/lib/flows/engine'

const ok = (value: string | number | null): ActionResult => ({ ok: true, output: { value } })

const fail = (code: string, message: string): ActionResult => ({
  ok: false,
  code,
  message,
  retryable: false,
})

function str(config: Record<string, unknown>, key: string): string | null {
  const value = config[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Reads the step's input: either a literal, or a fact/variable reference.
 *
 * ⚠️ A REFERENCE THAT RESOLVES TO NOTHING IS AN ERROR, NOT AN EMPTY STRING.
 * Transforming an absent value into "" and carrying on is how a flow writes a
 * blank over something real three steps later. The step refuses and says which
 * key was missing.
 */
function resolveInput(
  config: Record<string, unknown>,
  facts: Record<string, unknown>,
): { ok: true; value: string } | { ok: false; missing: string } {
  const reference = str(config, 'sourceField')
  if (reference) {
    const found = facts[reference]
    if (found === null || found === undefined || found === '') {
      return { ok: false, missing: reference }
    }
    return { ok: true, value: String(found) }
  }

  return { ok: true, value: str(config, 'source') ?? '' }
}

// ---------------------------------------------------------------------------
// DATE_CALC
// ---------------------------------------------------------------------------

/** Bounded for the same reason a WAIT is: a date ten years out is a typo. */
const MAX_OFFSET_DAYS = 3650

const dateCalc: ActionHandler = async (ctx, config) => {
  const from = str(config, 'from') ?? 'now'

  let base: Date
  if (from === 'now') {
    base = new Date()
  } else {
    /*
     * A named fact — `contact.created_at`, or a `vars.*` key an earlier step
     * wrote. Anything unparseable refuses rather than silently becoming the
     * epoch, which would date every follow-up to 1970.
     */
    const raw = ctx.facts[from] ?? from
    base = new Date(String(raw))
    if (Number.isNaN(base.getTime())) {
      return fail('BAD_DATE', `"${from}" is not a date this step can read.`)
    }
  }

  const days = Number(config.addDays ?? 0)
  const hours = Number(config.addHours ?? 0)

  if (!Number.isFinite(days) || !Number.isFinite(hours)) {
    return fail('BAD_OFFSET', 'The offset must be a number of days or hours.')
  }

  if (Math.abs(days) > MAX_OFFSET_DAYS) {
    return fail('OFFSET_TOO_LARGE', `An offset of ${days} days is beyond what a flow may set.`)
  }

  const result = new Date(base.getTime() + days * 86_400_000 + hours * 3_600_000)

  /*
   * ⚠️ ISO 8601 IN UTC, ALWAYS. The value may end up compared by a branch, fed
   * to another step, or read by a human in a different timezone — one canonical
   * form is the only way those agree. Formatting for a reader is the UI's job.
   */
  return ok(result.toISOString())
}

// ---------------------------------------------------------------------------
// TEXT_TRANSFORM
// ---------------------------------------------------------------------------

const OPERATIONS = {
  lowercase: (input: string) => input.toLowerCase(),
  uppercase: (input: string) => input.toUpperCase(),
  trim: (input: string) => input.trim(),
  /*
   * Deliberately simple: capitalise each word. Real name-casing is not
   * solvable — "van der Berg", "o'Neill", "McDonald" all disagree — so this
   * does the obvious thing and does not pretend to be a name formatter.
   */
  titlecase: (input: string) =>
    input.toLowerCase().replace(/(^|\s)(\S)/g, (_, space: string, char: string) => space + char.toUpperCase()),
  first_word: (input: string) => input.trim().split(/\s+/)[0] ?? '',
  last_word: (input: string) => {
    const words = input.trim().split(/\s+/).filter(Boolean)
    return words[words.length - 1] ?? ''
  },
} as const

export const TEXT_OPERATIONS = Object.keys(OPERATIONS) as (keyof typeof OPERATIONS)[]

const textTransform: ActionHandler = async (ctx, config) => {
  const operation = str(config, 'operation')
  if (!operation || !(operation in OPERATIONS)) {
    return fail(
      'BAD_OPERATION',
      `"${operation ?? 'nothing'}" is not a transform. Choose one of: ${TEXT_OPERATIONS.join(', ')}.`,
    )
  }

  const input = resolveInput(config, ctx.facts)
  if (!input.ok) {
    return fail('NO_INPUT', `This step reads "${input.missing}", and this contact has no value there.`)
  }

  const transform = OPERATIONS[operation as keyof typeof OPERATIONS]
  return ok(transform(input.value))
}

export function registerComputeActions(): void {
  registerAction('DATE_CALC', dateCalc)
  registerAction('TEXT_TRANSFORM', textTransform)
}
