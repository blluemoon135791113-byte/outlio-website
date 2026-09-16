/**
 * The release pipeline: what may be shown as actionable, and what a person's
 * answer does to a real account's budget.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ NOTHING IN THIS PIPELINE TOUCHES LINKEDIN, AND THE TESTS ARE SHAPED   ║
 * ║  BY THAT. There is no send to assert on. What there is: a decision about  ║
 * ║  whether to show a card, and a record of what a human said afterwards.    ║
 * ║  Every failure mode here lands on a customer's real account, which is the ║
 * ║  one thing Outlio cannot undo for them.                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/* ── A PostgREST double that records what was written ────────────────────── */

type Reply = { data: unknown; error: unknown }
const replies = new Map<string, Reply>()
const writes: { table: string; op: string; payload: unknown }[] = []

function builder(table: string) {
  const self: Record<string, unknown> = {}
  const chain = () => self as never
  Object.assign(self, {
    select: chain,
    eq: chain,
    in: chain,
    is: chain,
    order: chain,
    limit: chain,
    maybeSingle: () => Promise.resolve(replies.get(table) ?? { data: null, error: null }),
    single: () => Promise.resolve(replies.get(table) ?? { data: null, error: null }),
    insert: (payload: unknown) => {
      writes.push({ table, op: 'insert', payload })
      return {
        select: () => ({
          single: () =>
            Promise.resolve(replies.get(`${table}:insert`) ?? { data: { id: 'new' }, error: null }),
        }),
        then: (r: (v: Reply) => unknown) =>
          Promise.resolve(replies.get(`${table}:insert`) ?? { data: null, error: null }).then(r),
      }
    },
    update: (payload: unknown) => {
      writes.push({ table, op: 'update', payload })
      const u: Record<string, unknown> = {}
      Object.assign(u, {
        eq: () => u,
        select: () => Promise.resolve({ data: [{ id: 'x' }], error: null }),
        then: (r: (v: Reply) => unknown) =>
          Promise.resolve(replies.get(`${table}:update`) ?? { data: null, error: null }).then(r),
      })
      return u as never
    },
    then: (r: (v: Reply) => unknown) =>
      Promise.resolve(replies.get(table) ?? { data: [], error: null }).then(r),
  })
  return self as never
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (t: string) => builder(t) }),
}))

const stopped = vi.fn()
vi.mock('@/lib/crm/contact-stop', () => ({
  contactIsStopped: (...a: unknown[]) => stopped(...a),
}))

const budget = vi.fn()
vi.mock('@/lib/linkedin/senders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/linkedin/senders')>()
  return { ...actual, senderBudget: (...a: unknown[]) => budget(...a) }
})

const { releaseTask, recordOutcome } = await import('@/lib/linkedin/tasks')

beforeEach(() => {
  replies.clear()
  writes.length = 0
  stopped.mockResolvedValue({ stopped: false })
  budget.mockResolvedValue({ remaining: 5, limitedBy: null })
})

/** A card that would pass every gate. */
function healthyTask(over: Record<string, unknown> = {}) {
  replies.set('linkedin_tasks', {
    data: {
      id: 't1',
      kind: 'CONNECTION_REQUEST',
      state: 'PENDING',
      contact_id: 'c1',
      sender_id: 's1',
      enrollment_id: 'e1',
      approved_at_contact_version: 7,
      last_thread_check_at: new Date().toISOString(),
      logical_action_id: 'w:e1:n1:1',
      ...over,
    },
    error: null,
  })
  replies.set('crm_contacts', { data: { version: 7 }, error: null })
  replies.set('linkedin_senders', { data: { status: 'owner_reviewed', stage: 2 }, error: null })
}

describe('a card is only released when every gate passes', () => {
  it('releases a healthy task and reserves its quota slot', async () => {
    healthyTask()
    const result = await releaseTask({ workspaceId: 'w', taskId: 't1' })
    expect(result.released).toBe(true)

    const ledger = writes.find((w) => w.table === 'linkedin_sender_actions')
    expect(ledger, 'no reservation was written').toBeDefined()
    expect(ledger!.payload).toMatchObject({ lifecycle: 'reserved', logical_action_id: 'w:e1:n1:1' })
  })

  it('refuses when the contact changed since the content was approved', async () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ §4.7's DURABLE CANCELLATION, AND THE WHOLE REASON 0132 ADDED       ║
     * ║  `crm_contacts.version`.                                              ║
     * ║                                                                       ║
     * ║  "Lost UI notifications must not restore action permission." A         ║
     * ║  cancellation sent as a message can be missed — a dropped socket, a    ║
     * ║  closed laptop — and a missed one leaves the card clickable. Comparing ║
     * ║  versions inverts that: permission is re-earned at the moment of use.  ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    healthyTask()
    replies.set('crm_contacts', { data: { version: 8 }, error: null })

    const result = await releaseTask({ workspaceId: 'w', taskId: 't1' })
    expect(result.released).toBe(false)
    expect(writes.some((w) => w.table === 'linkedin_sender_actions')).toBe(false)
  })

  it('refuses a contact who is marked do-not-contact on LinkedIn', async () => {
    healthyTask()
    stopped.mockResolvedValue({ stopped: true, via: 'contact', reason: 'explicit_request' })

    const result = await releaseTask({ workspaceId: 'w', taskId: 't1' })
    expect(result.released).toBe(false)
  })

  it('asks the stop predicate about LINKEDIN, not email', async () => {
    /*
     * ⚠️ §4.15: an address suppression says nothing about whether that person
     * may be approached on LinkedIn. Asking with the wrong channel would either
     * over-block or, worse, ignore a LinkedIn-scoped DNC.
     */
    healthyTask()
    await releaseTask({ workspaceId: 'w', taskId: 't1' })
    expect(stopped).toHaveBeenCalledWith(expect.objectContaining({ channel: 'linkedin' }))
  })

  it('refuses when the sender has no budget left', async () => {
    healthyTask()
    budget.mockResolvedValue({ remaining: 0, limitedBy: 'day' })

    const result = await releaseTask({ workspaceId: 'w', taskId: 't1' })
    expect(result.released).toBe(false)
    expect(writes.some((w) => w.table === 'linkedin_sender_actions')).toBe(false)
  })

  it('refuses when the account is restricted, whatever the budget says', async () => {
    // §4.10: a restricted account releases nothing. Budget is irrelevant when
    // the account itself is in trouble.
    healthyTask()
    replies.set('linkedin_senders', { data: { status: 'restricted', stage: 3 }, error: null })

    const result = await releaseTask({ workspaceId: 'w', taskId: 't1' })
    expect(result.released).toBe(false)
  })

  it('refuses a task that is not awaiting release', async () => {
    healthyTask({ state: 'COMPLETED' })
    const result = await releaseTask({ workspaceId: 'w', taskId: 't1' })
    expect(result.released).toBe(false)
  })
})

describe('an outcome is what the operator did, never what they later saw', () => {
  beforeEach(() => {
    replies.set('linkedin_tasks', {
      data: {
        id: 't1',
        kind: 'CONNECTION_REQUEST',
        state: 'RELEASED',
        sender_id: 's1',
        logical_action_id: 'w:e1:n1:1',
      },
      error: null,
    })
  })

  it('refuses an Observation outright', async () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ §4.13: "'Mark request sent' cannot mark acceptance."              ║
     * ║                                                                       ║
     * ║  Acceptance gates the first direct message. Recording it as the        ║
     * ║  OUTCOME of sending a request would send a message into a connection   ║
     * ║  that was never made — to a stranger, from a customer's real account.  ║
     * ║  0132's enum refuses it too; both, because one says what the database  ║
     * ║  stores and the other says what the product means.                     ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    const result = await recordOutcome({
      workspaceId: 'w',
      taskId: 't1',
      outcome: 'CONNECTION_ACCEPTANCE_RECORDED',
      actorUserId: 'u1',
    })
    expect(result.ok).toBe(false)
    expect(writes).toHaveLength(0)

    /*
     * ⚠️ THE MESSAGE IS ASSERTED, NOT JUST THE REFUSAL — and this line exists
     * because the first version of this test passed for the wrong reason.
     * Deleting the `isObservation` guard entirely still refused, because
     * `isAllowedOutcome` catches the value one step later. Defence in depth is
     * welcome; a test that cannot tell which defence fired is not.
     *
     * The two paths say different things, and the difference matters to the
     * person reading it: "that is not a result this task can have" invites
     * trying another option, while this one explains that acceptance is
     * recorded elsewhere.
     */
    expect(result.ok === false && result.error).toMatch(/observed later/)
  })

  it('refuses an outcome that does not belong to this task kind', async () => {
    // "I sent the message" is not a result a connection request can have.
    const result = await recordOutcome({
      workspaceId: 'w',
      taskId: 't1',
      outcome: 'MESSAGE_MARKED_SENT',
      actorUserId: 'u1',
    })
    expect(result.ok).toBe(false)
  })

  it('requires a reason for a skip', async () => {
    const result = await recordOutcome({
      workspaceId: 'w',
      taskId: 't1',
      outcome: 'SKIPPED',
      actorUserId: 'u1',
    })
    expect(result.ok).toBe(false)
  })

  it('marks the slot performed when the request was sent', async () => {
    const result = await recordOutcome({
      workspaceId: 'w',
      taskId: 't1',
      outcome: 'REQUEST_MARKED_SENT',
      actorUserId: 'u1',
    })
    expect(result.ok).toBe(true)
    const ledger = writes.find((w) => w.table === 'linkedin_sender_actions')
    expect(ledger!.payload).toMatchObject({ lifecycle: 'performed' })
  })

  it('KEEPS the slot when the outcome is unknown', async () => {
    /*
     * ⚠️ §4.17. An action we cannot rule out having happened must keep
     * counting: the cost of being wrong is a restriction on somebody's real
     * account, and a freed slot would release another attempt at a stranger who
     * may already have received one.
     */
    const result = await recordOutcome({
      workspaceId: 'w',
      taskId: 't1',
      outcome: 'OUTCOME_UNKNOWN',
      reason: 'Session expired mid-send',
      actorUserId: 'u1',
    })
    expect(result.ok).toBe(true)
    const ledger = writes.find((w) => w.table === 'linkedin_sender_actions')
    expect(ledger!.payload).toMatchObject({ lifecycle: 'unknown' })
    expect(ledger!.payload).not.toMatchObject({ lifecycle: 'skipped' })
  })

  it('frees the slot only for a definite non-action', async () => {
    const result = await recordOutcome({
      workspaceId: 'w',
      taskId: 't1',
      outcome: 'SKIPPED',
      reason: 'Already connected',
      actorUserId: 'u1',
    })
    expect(result.ok).toBe(true)
    expect(writes.find((w) => w.table === 'linkedin_sender_actions')!.payload).toMatchObject({
      lifecycle: 'skipped',
    })
  })
})

describe('the version invalidates exactly what could make a draft wrong', () => {
  const VERSION_FN = readFileSync(
    join(ROOT, 'supabase/migrations/0133_contact_version_columns.sql'),
    'utf8',
  )

  /** Columns the trigger compares. */
  const bumpsOn = [...VERSION_FN.matchAll(/new\.(\w+)\s+is distinct from old\.\1/g)].map(
    (m) => m[1]!,
  )

  it('covers every field the drafted message is built from', () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ 0132 MISSED `first_name`, WHICH IS THE GREETING.                  ║
     * ║                                                                       ║
     * ║  A contact corrected from "Ada" to "Adaeze" left a pending card        ║
     * ║  reading "Hi Ada," and nothing invalidated it — the exact failure the  ║
     * ║  version was added to prevent, uncovered by the version itself.        ║
     * ║                                                                       ║
     * ║  `source` is here for a subtler reason: it decides the VERIFICATION    ║
     * ║  level, so a demotion can make an allowed greeting no longer allowed   ║
     * ║  with the text unchanged.                                             ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    for (const column of [
      'first_name',
      'last_name',
      'full_name',
      'job_title',
      'headline',
      'linkedin_url',
      'primary_company_id',
      'source',
      'deleted_at',
    ]) {
      expect(bumpsOn, `${column} can change a draft and does not invalidate it`).toContain(
        column,
      )
    }
  })

  it('does NOT invalidate on things a draft never contains', () => {
    /*
     * ⚠️ OVER-INVALIDATING IS NOT THE SAFE SIDE. 0132 bumped on
     * `owner_user_id`, so a routine bulk reassignment of 200 contacts silently
     * staled every pending card for them — and the operator saw "the contact
     * changed" about a contact that had not changed in any way they could see.
     *
     * A version that bumps on everything makes re-approval a reflex, and a
     * reflex waves a genuinely stale draft through with the rest.
     */
    for (const column of ['owner_user_id', 'timezone', 'updated_at', 'location']) {
      expect(bumpsOn, `${column} invalidates approved content for no reason`).not.toContain(
        column,
      )
    }
  })

  it('the sender is on the enrollment, which is why owner does not matter', () => {
    /*
     * The reasoning behind excluding `owner_user_id`, asserted rather than
     * only written down: reassigning a contact cannot change who performs the
     * action, because the account is fixed at enrollment.
     */
    const migration = readFileSync(
      join(ROOT, 'supabase/migrations/0132_linkedin_tasks.sql'),
      'utf8',
    )
    expect(migration).toMatch(/sender_id\s+uuid not null references public\.linkedin_senders/)
  })
})

describe('the schema and the code agree on every vocabulary', () => {
  const MIGRATION = readFileSync(
    join(ROOT, 'supabase/migrations/0132_linkedin_tasks.sql'),
    'utf8',
  )

  function enumValues(name: string): string[] {
    const block = new RegExp(`create type public\\.${name} as enum \\(([\\s\\S]*?)\\)`).exec(
      MIGRATION,
    )
    return [...(block?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!)
  }

  it('task outcomes match lib/linkedin/outcomes.ts exactly', async () => {
    /*
     * ⚠️ A VALUE IN ONE AND NOT THE OTHER IS A SILENT FAILURE EITHER WAY: a
     * database value the code cannot produce is a state nothing can leave, and
     * a code value the database rejects is a write that fails at the worst
     * moment — after somebody has already done the thing in LinkedIn.
     */
    const { allowedOutcomes } = await import('@/lib/linkedin/outcomes')
    const fromCode = new Set(
      (['REVIEW_PROFILE', 'CONNECTION_REQUEST', 'DIRECT_MESSAGE', 'INMAIL'] as const).flatMap(
        (k) => [...allowedOutcomes(k)],
      ),
    )
    expect(new Set(enumValues('linkedin_task_outcome'))).toEqual(fromCode)
  })

  it('an Observation is absent from the outcome enum', async () => {
    const { OBSERVATIONS } = await import('@/lib/linkedin/outcomes')
    const stored = new Set(enumValues('linkedin_task_outcome'))
    for (const observation of OBSERVATIONS) {
      expect(stored.has(observation), `${observation} is storable as an outcome`).toBe(false)
    }
  })

  it('enrollment states match the state machine', async () => {
    const stateMachine = strip(readFileSync(join(ROOT, 'lib/linkedin/enrollment.ts'), 'utf8'))
    const fromCode = [
      ...(/export type EnrollmentState =([\s\S]*?)\n\n/.exec(stateMachine)?.[1] ?? '').matchAll(
        /'([A-Z_]+)'/g,
      ),
    ].map((m) => m[1]!)
    expect(fromCode.length).toBeGreaterThan(5)
    expect(new Set(enumValues('linkedin_enrollment_state'))).toEqual(new Set(fromCode))
  })
})
