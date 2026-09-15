/**
 * Prospect messages, AI drafting, and the strategy analysis — Phase 20.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE DANGEROUS PART OF THE ANALYSIS IS NOT THE MODEL. IT IS THE        ║
 * ║  ARITHMETIC UNDERNEATH IT.                                                ║
 * ║                                                                           ║
 * ║  `email_events` still holds 254 false `replied` rows — a whole mailbox    ║
 * ║  counted as prospect replies against two messages ever sent, which        ║
 * ║  renders 12,700%. A model handed numbers like those writes a confident,    ║
 * ║  well-argued report about a rep who is doing brilliantly, and nobody       ║
 * ║  reading it can tell.                                                     ║
 * ║                                                                           ║
 * ║  So `rateOf` and `caveatFor` are pure and are tested behaviourally here.   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { caveatFor, rateOf, RATE_FLOOR, type RepStats } from '@/lib/linkedin/analysis'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

function body(src: string, declaration: string): string {
  const start = src.indexOf(declaration)
  if (start === -1) throw new Error(`body(): ${declaration} not found`)
  const rest = src.slice(start + declaration.length)
  const next = rest.search(/\n(?:export )?(?:async )?function |\n(?:export )?const /)
  return next === -1 ? rest : rest.slice(0, next)
}

const stats = (over: Partial<RepStats> = {}): RepStats => ({
  userId: null,
  name: null,
  sent: 0,
  unconfirmed: 0,
  replies: 0,
  meetings: 0,
  replyRate: null,
  openers: 0,
  pitches: 0,
  ...over,
})

// ---------------------------------------------------------------------------
// The arithmetic
// ---------------------------------------------------------------------------

describe('a rate is refused rather than invented', () => {
  it('returns null below the floor, however good the ratio looks', () => {
    /*
     * ⚠️ TWO SENDS AND ONE REPLY IS NOT A 50% REPLY RATE. Presenting it as one
     * is how a team reorganises itself around noise — and it is the number a
     * manager would act on.
     */
    expect(rateOf(1, 2)).toBeNull()
    expect(rateOf(5, RATE_FLOOR - 1)).toBeNull()
  })

  it('computes one at the floor and above', () => {
    // The boundary is `< FLOOR`, not `<= FLOOR`.
    expect(rateOf(5, RATE_FLOOR)).toBe(25)
    expect(rateOf(10, 40)).toBe(25)
  })

  it('distinguishes "none replied" from "not enough data"', () => {
    /*
     * ⚠️ 0 AND null MEAN DIFFERENT THINGS TO THE REP THEY ARE ABOUT. Zero is
     * "we sent thirty and nobody answered", which is a finding. Null is "we
     * have not sent enough to say", which is not. Collapsing them tells someone
     * their approach failed when it has not been tried.
     */
    expect(rateOf(0, 40)).toBe(0)
    expect(rateOf(0, 2)).toBeNull()
  })

  it('refuses an impossible rate instead of printing it', () => {
    /*
     * ⚠️ THIS IS THE 12,700% SHAPE, AND IT IS THE REASON THIS FUNCTION EXISTS.
     * A rate above 100 means replies are being counted against outreach that
     * was never recorded. Printing it makes the product look broken; printing
     * it as 100% hides a data fault. Refusing says the honest thing.
     */
    expect(rateOf(254, 2)).toBeNull()
    expect(rateOf(41, 40)).toBeNull()
    // Exactly 100 is possible and is kept.
    expect(rateOf(40, 40)).toBe(100)
  })
})

describe('the caveat is computed, never asked of the model', () => {
  it('says so when no outreach has been recorded at all', () => {
    const note = caveatFor(stats({ sent: 0 }))
    expect(note).toMatch(/No outreach has been recorded/)
  })

  it('says so when there is too little to rate', () => {
    /*
     * ⚠️ THE SAME THRESHOLD `rateOf` USES, so the sentence and the missing
     * percentage can never disagree. A model told "add a caveat if the data is
     * thin" adds one when it FEELS uncertain, which is neither the same thing
     * nor checkable.
     */
    const note = caveatFor(stats({ sent: RATE_FLOOR - 1 }))
    expect(note).toMatch(new RegExp(String(RATE_FLOOR - 1)))
    expect(note).toMatch(/too few to compute a reply rate/)
  })

  it('discloses unconfirmed sends and which way they bias the number', () => {
    /*
     * §4.17 counts an unknown outcome as possibly delivered, so it sits in the
     * denominator. A reader has to be told, or the rate looks worse than the
     * evidence supports.
     */
    const note = caveatFor(stats({ sent: 40, unconfirmed: 8 }))
    expect(note).toMatch(/8 of 40/)
    expect(note).toMatch(/20%/)
    expect(note, 'the direction of the bias is not stated').toMatch(/understated/)
  })

  it('is silent when the data supports the numbers', () => {
    expect(caveatFor(stats({ sent: 40, unconfirmed: 0 }))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// What the model is and is not shown
// ---------------------------------------------------------------------------

describe('the drafting model is never shown the recipient', () => {
  const DRAFT = code('lib/linkedin/draft.ts')

  it('builds its prompt from the instruction only', () => {
    /*
     * ⚠️ WITHHOLDING THE CONTACT IS THE ANTI-FABRICATION CONTROL, NOT A PRIVACY
     * GESTURE. A model shown "VP Engineering at Acme, Berlin" writes "loved what
     * you're building on the payments side" — plausible, specific, invented.
     * Rule 4 forbids exactly that, and no prompt instruction reliably stops a
     * model using a fact it can see.
     */
    const fn = body(DRAFT, 'export async function draftMessage')
    for (const leak of ['fullName', 'full_name', 'company', 'headline', 'jobTitle', 'contactId']) {
      expect(fn, `the draft prompt carries ${leak}`).not.toContain(leak)
    }
  })

  it('states the absence as a fact rather than as a rule to obey', () => {
    /*
     * "Do not invent details" invites a model to decide what counts as
     * inventing. "You have not been given any information about the recipient"
     * is a fact it can act on — and it is true.
     */
    expect(DRAFT).toMatch(/YOU HAVE NOT BEEN GIVEN ANY INFORMATION ABOUT THE RECIPIENT/)
  })

  it('declares every schema property it needs back', () => {
    /*
     * ⚠️ PHASE 13'S DEFECT, WHICH NO UNIT TEST COULD SEE AT THE TIME: the
     * copilot's `config: { type: 'object' }` had no declared properties, so
     * structured output STRIPPED everything inside it and the feature could
     * never work. An undeclared property is not optional — it is deleted.
     */
    const schema = body(DRAFT, 'function schema')
    expect(schema).toMatch(/message:/)
    expect(schema).toMatch(/required: \['message'\]/)
  })

  it('validates the placeholders the model returns rather than trusting them', () => {
    /*
     * An enum in a response schema is ADVISORY with these providers unless
     * strict mode applies, and strict mode needs every property in `required`.
     * A bad placeholder is REPORTED, never stripped: stripping silently changes
     * a sentence, and leaving it lands `{{industry}}` in a stranger's inbox.
     */
    const fn = body(DRAFT, 'export async function draftMessage')
    expect(fn).toMatch(/validateBody\(text\)/)
    expect(fn, 'a bad placeholder is stripped instead of reported').not.toMatch(
      /\.replace\([^)]*\{\{/,
    )
  })

  it('refuses an empty instruction rather than inventing a brief', () => {
    /*
     * Owner: "for that the user has to give input into ai on how he wants it
     * written". A button that produces generic outreach from nothing is the
     * feature they were careful to say they did not want.
     */
    const fn = body(DRAFT, 'export async function draftMessage')
    expect(fn).toMatch(/instruction\.length < 3/)
  })

  it('refuses an overlong draft rather than truncating it', () => {
    // Matching `enroll.ts` and `compileWorkflow`: a note clipped mid-sentence is
    // worse than one that was never written.
    const fn = body(DRAFT, 'export async function draftMessage')
    expect(fn).toMatch(/text\.length > spec\.limit/)
    expect(fn, 'the draft is being truncated').not.toMatch(/text\.slice\(0, spec\.limit\)/)
  })
})

describe('the analysis model is given counts it cannot recompute', () => {
  const ANALYSIS = code('lib/linkedin/analysis.ts')

  it('forbids the model from doing arithmetic', () => {
    /*
     * It is bad at it and the reader cannot tell. Every number that matters was
     * computed in `gatherStats` against rules about what counts as a reply.
     */
    expect(read('lib/linkedin/analysis.ts')).toMatch(
      /NEVER compute, restate, or estimate a rate, percentage or ratio/,
    )
  })

  it('never puts a prospect’s name in the prompt', () => {
    /*
     * ⚠️ A THIRD PARTY'S PERSONAL DATA IN A VENDOR PROMPT, for a report about a
     * REP'S WRITING. The names add nothing to judging prose.
     */
    const fn = body(ANALYSIS, 'function promptFor')
    expect(fn, 'the prompt names prospects').not.toMatch(/contactName/)
  })

  it('numbers the reps in the prompt rather than naming them', () => {
    const fn = body(ANALYSIS, 'function promptFor')
    expect(fn).toMatch(/Rep \$\{/)
    expect(fn, 'rep names are sent to the vendor').not.toMatch(/r\.name/)
  })

  it('renders a null rate as words, never as a number', () => {
    const fn = body(ANALYSIS, 'function promptFor')
    expect(fn).toMatch(/not enough data/)
  })

  it('refuses to analyse when there is nothing to read', () => {
    /*
     * A model asked to write a report about nothing will happily produce one,
     * and it will be entirely invented — the failure this whole module is
     * arranged against.
     */
    const fn = body(ANALYSIS, 'export async function analyseStrategy')
    expect(fn).toMatch(/reason: 'no_data'/)
  })

  it('checks the plan before it reads a single row', () => {
    const fn = body(ANALYSIS, 'export async function analyseStrategy')
    const gate = fn.indexOf('analysisEntitled')
    const read_ = fn.indexOf('gatherStats')
    expect(gate).toBeGreaterThan(-1)
    expect(read_).toBeGreaterThan(-1)
    expect(gate, 'rows are read before the plan is checked').toBeLessThan(read_)
  })

  it('lets a platform admin through, which the owner asked for explicitly', () => {
    /*
     * ⚠️ "for premium users only AND ADMIN" — the second half was missing on the
     * first pass, and the symptom was immediate: 27 of 33 workspace owners in
     * production carry no `plan_id`, so `resolveModules` grants them every
     * module through its own admin bypass while this function refused them the
     * analysis. A workspace with the LinkedIn module and no way to analyse it.
     *
     * The same bypass exists in `decideAccess`, `hasHubbleEntitlement` and
     * `resolveModules`, whose comment says extending it "keeps one rule rather
     * than three". This is the fourth place, and it now agrees.
     */
    const fn = body(ANALYSIS, 'export async function analysisEntitled')
    expect(fn).toMatch(/profile\?\.role === 'admin'/)
    const bypass = fn.indexOf("role === 'admin'")
    const planCheck = fn.indexOf('linkedin_analysis_enabled')
    expect(bypass, 'the admin bypass runs after the plan check').toBeLessThan(planCheck)
  })

  it('reads the entitlement from plans.limits, never from a plan name', () => {
    /*
     * CLAUDE.md: "All plan limits come from `plans.limits` JSONB at runtime.
     * Never hardcode." A list of premium plan keys in code is a second source
     * of truth that drifts the first time a plan is renamed — and it drifts in
     * the direction of giving the feature away.
     */
    const fn = body(ANALYSIS, 'export async function analysisEntitled')
    expect(fn).toMatch(/linkedin_analysis_enabled/)
    expect(fn, 'the plan is identified by name').not.toMatch(
      /'(starter|professional|agency|custom|trial)'/,
    )
  })
})

describe('attribution survives a reassignment', () => {
  const ANALYSIS = code('lib/linkedin/analysis.ts')

  it('credits outreach to who completed the task, not who owns the contact', () => {
    /*
     * ⚠️ THE QUESTION IS WHOSE OUTREACH WORKED. Reassigning a book of leads must
     * not move last month's results onto their new owner — `completed_by` is
     * stamped when the outcome is recorded and never moves, while
     * `owner_user_id` changes whenever a manager redistributes accounts.
     */
    const fn = body(ANALYSIS, 'export async function gatherStats')
    expect(fn).toMatch(/rep\(task\.completed_by\)/)
    expect(fn, 'outreach is credited to the current contact owner').not.toMatch(
      /rep\([^)]*owner_user_id/,
    )
  })

  it('counts an unconfirmed send in the denominator AND reports it separately', () => {
    /*
     * ⚠️ BOTH, DELIBERATELY. §4.17 treats an unknown outcome as possibly
     * delivered, so excluding it understates the denominator and inflates every
     * rate. Adding it silently asserts something nobody can support.
     */
    const fn = body(ANALYSIS, 'export async function gatherStats')
    const branch = fn.slice(fn.indexOf("task.outcome === 'OUTCOME_UNKNOWN'"))
    expect(branch).toMatch(/r\.sent \+= 1/)
    expect(branch).toMatch(/r\.unconfirmed \+= 1/)
  })

  it('stores the message author at write time', () => {
    /*
     * 0133: deriving it later attributes a message to whoever owns the contact
     * today, so reassigning a book of leads silently rewrites who said what —
     * and the per-rep report the owner asked for is exactly that grouping.
     */
    const store = code('lib/linkedin/prospect-messages.ts')
    const fn = body(store, 'export async function saveProspectMessage')
    expect(fn).toMatch(/authored_by: input\.actorUserId/)
  })
})

// ---------------------------------------------------------------------------
// The prospect messages themselves
// ---------------------------------------------------------------------------

describe('a prospect message is the rep’s, and it is checked', () => {
  const STORE = code('lib/linkedin/prospect-messages.ts')

  it('validates placeholders before saving', () => {
    /*
     * The same reason the workflow builder validates at save: `{{firstname}}`
     * is a plausible typo, and the only alternatives at use-time are leaking
     * the braces or silently altering the rep's sentence.
     */
    const fn = body(STORE, 'export async function saveProspectMessage')
    expect(fn).toMatch(/validateBody\(body\)/)
  })

  it('proves the contact is in this workspace before writing', () => {
    /*
     * ⚠️ `contact_id` ARRIVES FROM A FORM. Without this the insert attaches a
     * message to another tenant's contact under this workspace's id — a row
     * that reads as ours and points at theirs.
     */
    const fn = body(STORE, 'export async function saveProspectMessage')
    expect(fn).toMatch(/from\('crm_contacts'\)/)
    expect(fn).toMatch(/not in this workspace/)
  })

  it('does not treat an empty submission as a deletion', () => {
    /*
     * ⚠️ AMBIGUOUS INPUT, AND GUESSING DESTROYS WORK. An empty body could be a
     * rep clearing a draft or a form that failed to carry its value. Removal
     * has its own verb.
     */
    const fn = body(STORE, 'export async function saveProspectMessage')
    expect(fn).toMatch(/use Remove to clear it/)
    expect(fn, 'an empty body silently deletes').not.toMatch(/\.delete\(\)/)
  })

  it('bounds the read that feeds the model', () => {
    /*
     * An unbounded read builds a prompt whose size depends on how long the
     * customer has been using the product, and the failure mode is a request
     * rejected or silently truncated at the vendor.
     */
    const fn = body(STORE, 'export async function allProspectMessages')
    expect(fn).toMatch(/\.limit\(limit\)/)
    expect(fn).toMatch(/ascending: false/)
  })
})

describe('the drafted text is never saved on the rep’s behalf', () => {
  it('lands in the textarea for them to edit', () => {
    /*
     * ⚠️ THE REP IS THE AUTHOR, and the analysis groups by author. A button
     * that wrote a model's words straight into the record would make that
     * byline false.
     */
    const ui = code('components/linkedin/ProspectMessages.tsx')
    expect(ui).toMatch(/setBody\(result\.text\)/)

    const action = code('app/(product)/linkedin/strategy-actions.ts')
    const fn = body(action, 'export async function draftAction')
    expect(fn, 'the draft is saved without the rep seeing it').not.toMatch(
      /saveProspectMessage/,
    )
  })
})
