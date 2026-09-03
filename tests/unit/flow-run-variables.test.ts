/**
 * A run's working state, and the two steps that needed it.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `DATE_CALC` AND `TEXT_TRANSFORM` WERE BLOCKED ON STORAGE, NOT EFFORT.   ║
 * ║                                                                           ║
 * ║  Both COMPUTE a value, and until migration 0108 a run had nowhere to keep ║
 * ║  one: `gatherFacts` read only the contact, and Hubble's `storeAs` wrote   ║
 * ║  an activity row nothing read back. A handler would have produced the     ║
 * ║  right answer and discarded it.                                           ║
 * ║                                                                           ║
 * ║  ⚠️ BOTH HANDLERS ARE PURE, so these run them for real rather than        ║
 * ║  asserting on their source — the first tests in this suite that can.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { registerComputeActions, TEXT_OPERATIONS } from '@/lib/flows/actions/compute'
import { handlerFor, type ActionResult } from '@/lib/flows/engine'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

beforeAll(() => registerComputeActions())

const run = (
  action: 'DATE_CALC' | 'TEXT_TRANSFORM',
  config: Record<string, unknown>,
  facts: Record<string, unknown> = {},
): Promise<ActionResult> => {
  const handler = handlerFor(action)
  if (!handler) throw new Error(`${action} is not registered`)
  return handler({ workspaceId: 'ws', runId: 'run', contactId: 'c', facts }, config)
}

const value = (result: ActionResult) => (result.ok ? result.output?.value : undefined)

describe('DATE_CALC', () => {
  it('adds days to now', async () => {
    const before = Date.now()
    const result = await run('DATE_CALC', { addDays: 3, storeAs: 'followup' })
    expect(result.ok).toBe(true)

    const produced = new Date(String(value(result))).getTime()
    const expected = before + 3 * 86_400_000
    // Within a second of the expected instant; the handler reads its own clock.
    expect(Math.abs(produced - expected)).toBeLessThan(1_000)
  })

  it('goes backwards on a negative offset', async () => {
    /*
     * "Three days BEFORE the close date" is a real thing to want, so a
     * negative number must not be clamped to zero.
     */
    const result = await run('DATE_CALC', { from: '2026-06-15T12:00:00.000Z', addDays: -5 })
    expect(value(result)).toBe('2026-06-10T12:00:00.000Z')
  })

  it('reads a date from an earlier step', async () => {
    const result = await run(
      'DATE_CALC',
      { from: 'vars.replied_at', addHours: 48 },
      { 'vars.replied_at': '2026-06-01T00:00:00.000Z' },
    )
    expect(value(result)).toBe('2026-06-03T00:00:00.000Z')
  })

  it('refuses an unreadable date rather than defaulting to the epoch', async () => {
    /*
     * ⚠️ THE FAILURE THIS PREVENTS IS SILENT. `new Date('not a date')` is
     * Invalid Date, and arithmetic on it yields NaN — which formats as a
     * 1970 timestamp under a naive implementation and dates every follow-up
     * to the epoch.
     */
    const result = await run('DATE_CALC', { from: 'not a date', addDays: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('BAD_DATE')
  })

  it('refuses an absurd offset', async () => {
    const result = await run('DATE_CALC', { addDays: 99_999 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('OFFSET_TOO_LARGE')
  })

  it('always produces UTC ISO 8601', async () => {
    /*
     * The value may be compared by a branch, fed to another step, or read by
     * someone in a different timezone. One canonical form is the only way
     * those agree.
     */
    const result = await run('DATE_CALC', { addDays: 1 })
    expect(String(value(result))).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})

describe('TEXT_TRANSFORM', () => {
  it('applies each operation it advertises', async () => {
    const cases: [string, string, string][] = [
      ['lowercase', 'Ada LOVELACE', 'ada lovelace'],
      ['uppercase', 'Ada Lovelace', 'ADA LOVELACE'],
      ['titlecase', 'ada lovelace', 'Ada Lovelace'],
      ['trim', '  spaced  ', 'spaced'],
      ['first_word', 'Ada Lovelace', 'Ada'],
      ['last_word', 'Ada Lovelace', 'Lovelace'],
    ]

    for (const [operation, input, expected] of cases) {
      const result = await run('TEXT_TRANSFORM', { operation, source: input, storeAs: 'x' })
      expect(value(result), operation).toBe(expected)
    }
  })

  it('every advertised operation is actually implemented', () => {
    // The editor's list and the handler's map must agree, or a chosen
    // operation refuses at run time.
    const BUILDER = read('components/flows/FlowBuilder.tsx')
    for (const operation of TEXT_OPERATIONS) {
      expect(BUILDER, `${operation} is not offered by the editor`).toContain(`key: '${operation}'`)
    }
  })

  it('reads a value an earlier step stored', async () => {
    const result = await run(
      'TEXT_TRANSFORM',
      { operation: 'uppercase', sourceField: 'vars.guess', storeAs: 'x' },
      { 'vars.guess': 'acme' },
    )
    expect(value(result)).toBe('ACME')
  })

  it('refuses when the source field is empty', async () => {
    /*
     * ⚠️ NOT AN EMPTY STRING. Transforming nothing into "" and carrying on is
     * how a flow writes a blank over something real three steps later.
     */
    const result = await run(
      'TEXT_TRANSFORM',
      { operation: 'uppercase', sourceField: 'contact.job_title', storeAs: 'x' },
      { 'contact.job_title': null },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('NO_INPUT')
      // Names the key, so the author knows which one to fix.
      expect(result.message).toContain('contact.job_title')
    }
  })

  it('refuses an operation it does not have', async () => {
    const result = await run('TEXT_TRANSFORM', { operation: 'reverse', source: 'x', storeAs: 'y' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('BAD_OPERATION')
  })
})

describe('the engine keeps and namespaces the values', () => {
  const ENGINE = read('lib/flows/engine.ts')

  it('reads the run’s variables into the fact set', () => {
    expect(ENGINE).toContain('run.variables')
    expect(ENGINE).toContain('facts[`vars.${key}`] = value')
  })

  it('namespaces them so a contact field cannot be shadowed', () => {
    /*
     * ⚠️ THE POINT OF THE PREFIX. A step storing `job_title` must not change
     * what `contact.job_title` means to a condition written before it existed.
     */
    expect(ENGINE).toContain('vars.')
    const merge = ENGINE.slice(ENGINE.indexOf('const variables:'), ENGINE.indexOf('let currentStepId'))
    expect(merge).not.toMatch(/facts\[key\] = value/)
  })

  it('persists after a successful step, not before', () => {
    /*
     * Writing before the action succeeds would record an answer a failed step
     * never produced. Sliced from the `if`, not from the `typeof` — the first
     * version of this assertion cut the condition off and then complained it
     * was missing.
     */
    const guard = ENGINE.indexOf('if (result.ok && typeof step.config.storeAs')
    expect(guard, 'the store is not guarded on success').toBeGreaterThan(-1)
    expect(ENGINE).toContain("from('flow_runs').update({ variables:")
  })

  it('makes it readable by the very next step in the same pass', () => {
    /*
     * The in-memory map is updated alongside the row, so a branch immediately
     * below a compute step sees what it just wrote — rather than reading a
     * stale fact set until the next tick.
     */
    const block = ENGINE.slice(ENGINE.indexOf('typeof step.config.storeAs'))
    expect(block).toContain('variables[key] =')
    expect(block).toContain('facts[`vars.${key}`] =')
  })

  it('the engine stores it, not the handlers', () => {
    /*
     * One implementation of "remember this" rather than one per action — and a
     * handler cannot write under a key another step is using.
     */
    /*
     * ⚠️ ASSERTED ON COMMENT-STRIPPED SOURCE. `compute.ts` explains in prose
     * that the ENGINE persists under `storeAs`, and the first version of this
     * assertion matched that sentence — failing against correct code for
     * saying the right thing.
     */
    const COMPUTE = read('lib/flows/actions/compute.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(COMPUTE).not.toContain("from('flow_runs')")
    expect(COMPUTE).not.toContain('storeAs')
  })
})

describe('the migration', () => {
  const SQL = read('supabase/migrations/0108_flow_run_variables.sql')

  it('defaults to an object so runs already in flight keep working', () => {
    expect(SQL).toContain("default '{}'::jsonb")
    expect(SQL).toContain('not null')
  })

  it('refuses anything that is not an object', () => {
    // The engine spreads it; an array or scalar would lose keys or throw.
    expect(SQL).toContain("jsonb_typeof(variables) = 'object'")
  })

  it('is additive', () => {
    // A column add on a live table, nothing dropped or rewritten.
    expect(SQL).toContain('add column if not exists variables')
    expect(SQL).not.toMatch(/drop\s+column/i)
  })
})
