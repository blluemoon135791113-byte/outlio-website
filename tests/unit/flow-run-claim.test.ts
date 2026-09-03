/**
 * A triggered flow run must actually be picked up, and picked up once.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  EVERY TRIGGERED FLOW HUNG AT STEP ONE.                                  ║
 * ║                                                                           ║
 * ║  `startRun` creates a run with `status: 'running'`, `current_step` set to ║
 * ║  the first step and `resume_at: null` — it does NOT advance it. The tick  ║
 * ║  is `advanceRun`'s only caller, and it fed on `claimWaitingRuns`, which   ║
 * ║  selected `status = 'waiting'` AND `resume_at <= now()`.                  ║
 * ║                                                                           ║
 * ║  A freshly triggered run matched neither. It sat at step one forever.     ║
 * ║                                                                           ║
 * ║  Reproduced on production: publishing a flow and creating a contact fired ║
 * ║  `contact_created` and wrote a run that never moved. Across every         ║
 * ║  workspace there were 2 stuck at `running` and ZERO `waiting` — so the    ║
 * ║  query had never returned a row in its life.                              ║
 * ║                                                                           ║
 * ║  ⚠️ `advanceRun` ALREADY GUARDED ON `running || waiting`. The engine was  ║
 * ║  right. Only the thing feeding it was wrong.                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const ENGINE = read('lib/flows/engine.ts')

/** The body of `claimWaitingRuns`. */
const CLAIM = ENGINE.slice(
  ENGINE.indexOf('export async function claimWaitingRuns'),
  ENGINE.indexOf('\nexport ', ENGINE.indexOf('export async function claimWaitingRuns') + 10),
)

describe('the claim covers runs that were never advanced', () => {
  it('claims running runs, not only waiting ones', () => {
    /*
     * ⚠️ VERIFIED NON-VACUOUS: deleting the `status = 'running'` branch makes
     * this fail, and reproduces the production hang exactly.
     */
    expect(CLAIM).toContain("eq('status', 'waiting')")
    expect(CLAIM).toContain("eq('status', 'running')")
  })

  it('still honours resume_at for parked runs', () => {
    // A WAIT step parks the run until its hour arrives. Claiming it early
    // would resume a sequence before the delay the author asked for.
    expect(CLAIM).toContain("lte('resume_at'")
  })

  it('advanceRun accepts both states, which is why this is safe', () => {
    // The claim widening only works because the engine was already willing to
    // advance a `running` run. If it were not, this would strand them louder.
    const advance = ENGINE.slice(ENGINE.indexOf('export async function advanceRun'))
    expect(advance).toContain("run.status !== 'running' && run.status !== 'waiting'")
  })
})

describe('a run cannot be advanced twice at once', () => {
  it('claims by conditional UPDATE, not by SELECT alone', () => {
    /*
     * ⚠️ THE RISK THIS EXISTS FOR IS A DUPLICATE SEND. Two overlapping ticks
     * that both SELECT the same run would both advance it, and a SEND_EMAIL
     * step would mail the same person twice — irreversible, and invisible
     * until the recipient says something.
     *
     * `UPDATE … WHERE updated_at < cutoff RETURNING` is atomic per row: the
     * first tick's update stops the second tick's WHERE from matching.
     */
    expect(CLAIM).toContain('.update({ updated_at:')
    expect(CLAIM).toContain(".lt('updated_at', leaseCutoff)")
    expect(CLAIM).toContain(".select('id, workspace_id')")
  })

  it('returns only rows it actually won', () => {
    // Returning the candidates rather than the claimed rows would hand every
    // overlapping tick the same list and defeat the whole mechanism.
    expect(CLAIM).toMatch(/return \(claimed \?\? \[\]\)/)
    expect(CLAIM).not.toMatch(/return \(candidates/)
  })

  it('has a lease long enough to cover an advance in progress', () => {
    const lease = ENGINE.match(/const RUN_LEASE_MS = ([\d_]+)/)
    expect(lease, 'RUN_LEASE_MS is gone').not.toBeNull()
    expect(Number(lease![1]!.replace(/_/g, ''))).toBeGreaterThanOrEqual(30_000)
  })
})

/**
 * A step that can only ever fail must not be publishable.
 *
 * Observed in production: an ASSIGN_OWNER step with `userId: ""` published
 * cleanly, triggered on a real contact and died at step one with NO_USER. The
 * message was correct and nobody was ever going to read it — the only place it
 * appeared was a failed run.
 */
describe('publish refuses a step with no config', () => {
  const DEFINITION = read('lib/flows/definition.ts')
  const PUBLISH = read('app/(product)/flows/actions.ts')

  it('is checked at publish, not at parse', () => {
    /*
     * ⚠️ THE DISTINCTION THAT MATTERS. `validateFlowDefinition` also parses
     * definitions ALREADY STORED — `advanceRun` calls it on every run to read
     * the pinned version. Putting this check there retroactively invalidated
     * flows published before it existed, and broke 22 tests on first attempt.
     * Refusing at publish is cheap; refusing at parse is a migration.
     */
    expect(DEFINITION).toContain('export function publishProblems')
    expect(PUBLISH).toContain('publishProblems(definition)')

    const validator = DEFINITION.slice(
      DEFINITION.indexOf('export function validateFlowDefinition'),
      DEFINITION.indexOf('export function publishProblems'),
    )
    expect(validator).not.toContain('REQUIRED_ACTION_CONFIG')
  })

  it('requires the keys the handlers actually read', () => {
    /*
     * ⚠️ THE KEY NAMES COME FROM THE HANDLERS, NOT FROM GUESSWORK. `ADD_TAG`
     * reads `config.tag`, not `config.name` — validating the wrong key would
     * block a correct flow while still letting the broken one publish.
     */
    const table = DEFINITION.slice(
      DEFINITION.indexOf('const REQUIRED_ACTION_CONFIG'),
      DEFINITION.indexOf('}', DEFINITION.indexOf('const REQUIRED_ACTION_CONFIG')),
    )
    expect(table).toContain("ASSIGN_OWNER: ['userId']")
    expect(table).toContain("ROUND_ROBIN: ['userIds']")
    expect(table).toContain("ADD_TAG: ['tag']")
    expect(table).toContain("ENROLL_SEQUENCE: ['campaignId']")

    // And each of those keys is genuinely read by its handler.
    const crm = read('lib/flows/actions/crm.ts')
    const email = read('lib/flows/actions/email.ts')
    expect(crm).toContain("str(config, 'userId')")
    expect(crm).toContain("str(config, 'tag')")
    expect(crm).toContain('config.userIds')
    expect(email).toContain("str(config, 'campaignId')")
  })

  it('blocks the publish rather than warning', () => {
    const body = PUBLISH.slice(PUBLISH.indexOf('const blockers = publishProblems'))
    expect(body).toContain('if (blockers.length > 0)')
    expect(body).toContain('return { ok: false')
  })
})
