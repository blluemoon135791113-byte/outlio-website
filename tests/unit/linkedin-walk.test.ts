/**
 * Walking the workflow — the part that turns a saved plan into tasks.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ BEFORE THIS EXISTED, A SAVED WORKFLOW PRODUCED NOTHING. `tick.ts` had ║
 * ║  ZERO LinkedIn references, so an enrolment that reached a wait parked and  ║
 * ║  was never moved again — indistinguishable from the outside from a         ║
 * ║  sequence that had quietly stopped. The same shape as the reporting rollup ║
 * ║  that had no trigger until 2026-09-12, and as the erasure function that    ║
 * ║  was unreachable its whole life.                                          ║
 * ║                                                                           ║
 * ║  So the first thing asserted here is that the worker calls it at all.     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { compileWorkflow, type WorkflowStep } from '@/lib/linkedin/workflow'
import type { StepAction } from '@/lib/linkedin/steps'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/**
 * ⚠️ COMMENTS STRIPPED BEFORE EVERY SOURCE MATCH. `walk.ts` argues at length
 * about the things being searched for — it names `GOAL_MET` in prose while
 * deliberately writing `NO_REPLY` in code. Matching raw text would find the
 * reasoning and report the opposite of what runs.
 */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

/** One function's body, bounded at the next top-level declaration. */
function body(src: string, declaration: string): string {
  const start = src.indexOf(declaration)
  if (start === -1) throw new Error(`body(): ${declaration} not found`)
  const rest = src.slice(start + declaration.length)
  const next = rest.search(/\n(?:export )?(?:async )?function |\n(?:export )?const /)
  return next === -1 ? rest : rest.slice(0, next)
}

const WALK = code('lib/linkedin/walk.ts')

describe('the scanner sees what it polices', () => {
  it('strips comments rather than matching the argument', () => {
    // The prose explains why GOAL_MET is NOT used. Unstripped, a search for it
    // would find the explanation and pass on code that had it backwards.
    expect(read('lib/linkedin/walk.ts'), 'the rationale was deleted').toContain('GOAL_MET')
    expect(WALK, 'comment stripping is not working').not.toContain('GOAL_MET')
  })
})

describe('the worker actually calls it', () => {
  const TICK = code('lib/workers/tick.ts')

  it('runs a LinkedIn job in the tick', () => {
    /*
     * ⚠️ THE ASSERTION THIS FILE EXISTS FOR. A walker nothing calls is a feature
     * the product appears to have. `releaseDue` is imported AND invoked — the
     * import alone would pass on a file that imported it and never ran it, which
     * is precisely how `rollupWorkspace` sat unreachable.
     */
    expect(TICK).toMatch(/import \{ releaseDue \} from '@\/lib\/linkedin\/walk'/)
    expect(TICK).toMatch(/runJob\(result, 'release_linkedin_waits'/)
    expect(TICK).toMatch(/await releaseDue\(LIMITS\.linkedinDuePerTick\)/)
  })

  it('bounds how many it releases per tick', () => {
    // Each release makes a card a human must perform, against caps of 5-20 a
    // day. An unbounded release builds an inbox nobody can clear.
    expect(TICK).toMatch(/linkedinDuePerTick: \d+/)
  })
})

describe('recording an outcome moves the sequence on', () => {
  const TASKS = code('lib/linkedin/tasks.ts')

  it('advances after the outcome is written, not before', () => {
    /*
     * ⚠️ ORDER MATTERS AND IS ASSERTED BY POSITION. Advancing first would create
     * the next card and then possibly fail to record what happened to this one,
     * leaving an operator looking at step three with step two unrecorded.
     */
    const fn = TASKS.slice(TASKS.indexOf('export async function recordOutcome'))
    const outcomeWrite = fn.indexOf("state: 'COMPLETED'")
    const advance = fn.indexOf('advanceAfterTask')
    expect(outcomeWrite).toBeGreaterThan(-1)
    expect(advance).toBeGreaterThan(-1)
    expect(advance, 'the sequence advances before the outcome is durable').toBeGreaterThan(
      outcomeWrite,
    )
  })

  it('a failure to advance does NOT fail the outcome', () => {
    /*
     * ⚠️ THE OPERATOR HAS ALREADY PERFORMED A REAL ACTION AGAINST A REAL PERSON.
     * Returning an error now invites them to record it again, which is how one
     * connection request becomes two. A missing next card is recoverable — the
     * worker picks the enrolment up. A duplicated action is not.
     */
    const fn = TASKS.slice(TASKS.indexOf('export async function recordOutcome'))
    const tail = fn.slice(fn.indexOf('advanceAfterTask'))
    expect(tail, 'a failed advance rolls back a recorded outcome').not.toMatch(
      /return \{ ok: false/,
    )
    expect(tail).toMatch(/console\.error/)
  })
})

describe('reaching the end is not success', () => {
  it('completes with NO_REPLY rather than GOAL_MET', () => {
    /*
     * ⚠️ `reasonMeansSuccess` TREATS ONLY `GOAL_MET` AS SUCCESS, and every step
     * having been performed with nothing coming back is not that. §4.18 keeps
     * qualified conversations and held meetings as separate denominators
     * precisely so a wall of completed sequences cannot be read as things
     * working — which is the 12,700% shape one level up.
     */
    const fn = body(WALK, 'async function finish')
    expect(fn).toMatch(/terminal_reason: 'NO_REPLY'/)
    expect(fn, 'finishing a workflow is being recorded as the goal being met').not.toContain(
      'GOAL_MET',
    )
  })

  it('clears the pointer so a finished enrolment is not walked again', () => {
    const fn = body(WALK, 'async function finish')
    expect(fn).toMatch(/current_step_id: null/)
    expect(fn).toMatch(/next_step_due_at: null/)
  })
})

describe('the stop check is not a one-time gate', () => {
  it('re-checks do-not-contact at every hop, not only at enrolment', () => {
    /*
     * ⚠️ DAYS PASS BETWEEN STEPS. Somebody who asks not to be contacted after
     * step two must not receive step three, and a check that ran only at
     * enrolment would be answering a question from a week ago.
     */
    const advance = body(WALK, 'export async function advanceAfterTask')
    expect(advance).toMatch(/contactIsStopped/)
    expect(advance).toMatch(/terminal_reason: 'DNC'/)

    // And at enrolment too, so neither is the only one.
    const enroll = body(WALK, 'export async function enrollInCampaign')
    expect(enroll).toMatch(/contactIsStopped/)
  })

  it('does not advance an enrolment that already ended', () => {
    /*
     * Advancing a terminal enrolment restarts outreach at somebody who replied,
     * was marked not-interested, or asked not to be contacted. `enrollment.ts`
     * already decides what a late event means: recorded, never replayed.
     */
    const advance = body(WALK, 'export async function advanceAfterTask')
    expect(advance).toMatch(/\['COMPLETED', 'CANCELLED', 'FAILED'\]\.includes/)
  })
})

describe('idempotence is the database’s job', () => {
  it('treats a duplicate task insert as success, not as a reason to make another', () => {
    /*
     * ⚠️ THE FAILURE MODE IF THIS IS WRONG IS A SECOND CONNECTION REQUEST TO A
     * STRANGER WHO ALREADY HAD ONE. Two ticks race; the loser must adopt the
     * winner's task rather than create a different one or retry forever.
     */
    const fn = body(WALK, 'async function createTaskFor')
    expect(fn).toMatch(/UNIQUE_VIOLATION/)
    expect(fn).toMatch(/kind: 'task_created'/)
  })

  it('keys the task on the STEP id, and omits the attempt number', () => {
    /*
     * §4.17: including the attempt would make a retry a new logical action and
     * could duplicate a real external effect. The step id is what makes two
     * different steps distinct without making one step's retry distinct.
     */
    const fn = body(WALK, 'function logicalActionId')
    expect(fn).toMatch(/\$\{input\.stepId\}/)
    expect(fn, 'the attempt number is in the key').not.toMatch(/attempt/i)
  })

  it('claims a due enrolment before walking it', () => {
    /*
     * ⚠️ WITHOUT THE CLAIM, TWO OVERLAPPING TICKS BOTH WALK THE SAME PERSON. The
     * task insert's unique key stops a duplicate CARD, but `ADD_TAG` has no such
     * key and would be applied twice — harmless for a tag, not harmless as a
     * pattern.
     */
    const fn = body(WALK, 'async function advanceFromWait')
    expect(fn).toMatch(/next_step_due_at: null/)
    expect(fn, 'the claim is not conditional, so both ticks win').toMatch(
      /\.not\('next_step_due_at', 'is', null\)/,
    )
  })
})

describe('what a wait does, and what a task step does', () => {
  it('a wait stores a deadline rather than a remaining duration', () => {
    /*
     * A worker that does not run for a day must not thereby extend everybody's
     * wait by a day.
     */
    const fn = body(WALK, 'async function walkFrom')
    expect(fn).toMatch(/next_step_due_at: until/)
    expect(fn).toMatch(/86_400_000/)
  })

  it('landing on a task step CLEARS the due date', () => {
    /*
     * ⚠️ A STALE `next_step_due_at` WOULD HAVE `releaseDue` PICK THE ENROLMENT
     * UP AGAIN and try to walk past a task nobody has done. An enrolment on a
     * task step is waiting on a person, not on a clock.
     */
    const fn = body(WALK, 'async function pointAt')
    expect(fn).toMatch(/next_step_due_at: null/)
  })

  it('an internal step does not stop the walk, but a wait does', () => {
    const fn = body(WALK, 'async function walkFrom')
    // ADD_TAG runs and the loop continues.
    expect(fn).toMatch(/if \(!producesTask\(step\.action\)\)/)
    expect(fn).toMatch(/continue/)
    // The wait returns.
    expect(fn).toMatch(/return \{ kind: 'waiting'/)
  })

  it('bounds the walk so a cycle cannot spin inside a tick', () => {
    const fn = body(WALK, 'async function walkFrom')
    expect(fn).toMatch(/hop < input\.steps\.length \+ 1/)
  })
})

describe('placeholders at task-creation time', () => {
  it('leaves the body null rather than rendering a gap', () => {
    /*
     * ⚠️ AND STILL CREATES THE TASK. Refusing would strand the enrolment on a
     * step nobody can see; the operator, who can read the profile in front of
     * them, is exactly the person able to fix the record or write the line.
     */
    const fn = body(WALK, 'async function createTaskFor')
    expect(fn).toMatch(/resolved\.ok \? resolved\.text : null/)
  })

  it('never splits a first name out of a full name', () => {
    /*
     * ⚠️ `buildLinkedInContext` ALREADY REFUSES THIS, and a second, more
     * permissive answer here would quietly overrule it. Deriving one at render
     * from whatever `full_name` holds is the inference that produces "Hi Van"
     * for "Van der Berg".
     */
    const fn = body(WALK, 'function contactValues')
    expect(fn).toMatch(/contact\.first_name/)
    expect(fn, 'a first name is being derived from full_name').not.toMatch(
      /full_name[\s\S]{0,120}(split|slice|\[0\])/,
    )
  })

  it('ranks a company name below a verified first name', () => {
    // `placeholders.ts` demands VERIFIED for first_name and accepts
    // USER_RECORDED for company; contactValues must supply matching evidence.
    const fn = body(WALK, 'function contactValues')
    expect(fn).toMatch(/first_name[\s\S]{0,80}'VERIFIED'/)
    expect(fn).toMatch(/company[\s\S]{0,80}'USER_RECORDED'/)
  })
})

describe('entry at any step', () => {
  it('does not backfill the steps before the entry point', () => {
    /*
     * ⚠️ SOMEBODY ENTERING AT STEP FIVE HAS NOT HAD STEPS ONE TO FOUR DONE TO
     * THEM. Creating those tasks would ask an operator to send a first message
     * to a person who is already mid-conversation.
     */
    const fn = body(WALK, 'export async function enrollInCampaign')
    expect(fn).toMatch(/input\.startStepId/)
    expect(fn).toMatch(/from: start/)
    expect(fn, 'entry backfills earlier steps').not.toMatch(/steps\.slice\(0/)
  })

  it('records where they entered, separately from where they are', () => {
    const fn = body(WALK, 'export async function enrollInCampaign')
    expect(fn).toMatch(/entry_step_id: start\.id/)
    expect(fn).toMatch(/current_step_id: start\.id/)
  })

  it('never updates entry_step_id afterwards', () => {
    /*
     * It is the comparison the DM analysis needs: a campaign whose step-3
     * entrants reply and whose step-1 entrants do not is a finding. Updating it
     * would erase that.
     */
    const afterEnroll = WALK.slice(WALK.indexOf('export async function advanceAfterTask'))
    expect(afterEnroll, 'entry_step_id is rewritten after enrolment').not.toContain(
      'entry_step_id',
    )
  })
})

// ---------------------------------------------------------------------------
// ADD_TAG's setting — the hole 0132 fills
// ---------------------------------------------------------------------------

const step = (over: Partial<WorkflowStep> & { action: StepAction }): WorkflowStep => ({
  id: over.id ?? `s-${Math.random().toString(36).slice(2)}`,
  position: over.position ?? 0,
  body: over.body ?? null,
  waitDays: over.waitDays ?? null,
  config: {},
  ...over,
})

describe('a tag step must say which tag', () => {
  it('refuses an ADD_TAG with no tag configured', () => {
    /*
     * ⚠️ THE ALTERNATIVE IS A STEP THAT DOES NOTHING, FOREVER, WITH NO ERROR.
     * The walker performs ADD_TAG itself, so an unconfigured one would either be
     * skipped — silently excluding people from whatever the tag segments — or
     * fail mid-sequence on a workflow already saved as valid.
     */
    const result = compileWorkflow([
      step({ action: 'DIRECT_MESSAGE', position: 0, body: 'hi' }),
      step({ action: 'ADD_TAG', position: 1 }),
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.some((p) => /which tag/i.test(p.message))).toBe(true)
  })

  it('accepts one that does', () => {
    const result = compileWorkflow([
      step({ action: 'DIRECT_MESSAGE', position: 0, body: 'hi' }),
      step({ action: 'ADD_TAG', position: 1, config: { tag: 'Warm' } }),
    ])
    expect(result.ok, JSON.stringify(result)).toBe(true)
  })

  it('treats a whitespace-only tag as absent', () => {
    const result = compileWorkflow([
      step({ action: 'DIRECT_MESSAGE', position: 0, body: 'hi' }),
      step({ action: 'ADD_TAG', position: 1, config: { tag: '   ' } }),
    ])
    expect(result.ok).toBe(false)
  })

  it('refuses a setting on an action that takes none', () => {
    /*
     * Matching how a `wait_days` on a message step is handled. A setting sitting
     * on an action that does not read it looks meaningful to the next person and
     * is not.
     */
    const result = compileWorkflow([
      step({ action: 'DIRECT_MESSAGE', position: 0, body: 'hi', config: { tag: 'x' } }),
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems[0]!.message).toMatch(/takes no settings/)
  })

  it('is enforced by the database too, not only by the validator', () => {
    /*
     * A constraint in TypeScript alone holds until somebody writes a row another
     * way — a backfill, a support script, a future importer. Verified against
     * real Postgres before 0132 was applied; pinned here so removing it is a
     * visible change.
     */
    const sql = read('supabase/migrations/0132_linkedin_step_config.sql')
    expect(sql).toMatch(/linkedin_workflow_steps_tag_configured/)
    expect(sql).toMatch(/btrim\(coalesce\(config ->> 'tag', ''\)\) <> ''/)
    expect(sql).toMatch(/linkedin_workflow_steps_config_shape/)
  })
})

describe('one tag implementation, not two', () => {
  it('the flow engine delegates to the shared module', () => {
    /*
     * ⚠️ `lib/flows/actions/crm.ts` HAD ITS OWN COPY, and the LinkedIn walker
     * needed the same thing. The part two copies would get wrong differently is
     * real: `crm_tags_name_uniq` is a PARTIAL unique index, so the obvious
     * `upsert` fails outright, and the select-then-insert it forces can lose a
     * race.
     */
    const flows = code('lib/flows/actions/crm.ts')
    const fn = body(flows, 'const addTag: ActionHandler')
    expect(fn).toMatch(/ensureTagAttached/)
    expect(fn, 'the flow engine still has its own tag implementation').not.toMatch(
      /from\('crm_tags'\)/,
    )

    // And the walker uses the same one.
    expect(WALK).toMatch(/ensureTagAttached/)
  })

  it('a failed tag stops the walk rather than being skipped', () => {
    /*
     * The customer put the step there. A tag silently not applied is a segment
     * that quietly excludes people, and segments decide who gets messaged next.
     */
    const fn = body(WALK, 'async function walkFrom')
    expect(fn).toMatch(/if \(!tagged\.ok\) return \{ kind: 'failed'/)
  })
})

describe('one enrolment’s failure does not stop the tick', () => {
  it('catches per row', () => {
    /*
     * `runTick` runs every five minutes for every workspace; a single bad row
     * throwing would hold up everybody else's sequences until somebody noticed.
     */
    const fn = body(WALK, 'export async function releaseDue')
    expect(fn).toMatch(/try \{/)
    expect(fn).toMatch(/catch \(error\)/)
    expect(fn).toMatch(/failed \+= 1/)
  })

  it('takes the oldest first', () => {
    /*
     * A campaign enrolling faster than its caps allow would otherwise starve its
     * earliest people — the ones furthest into a sequence, whose conversations
     * are the most worth finishing.
     */
    const fn = body(WALK, 'export async function releaseDue')
    expect(fn).toMatch(/\.order\('next_step_due_at', \{ ascending: true \}\)/)
  })
})
