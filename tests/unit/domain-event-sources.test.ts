/**
 * The three sources that joined the door — Phase 23, the second half.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  STRUCTURAL GUARDS SAY A CALL SITE EXISTS. THIS FILE PROVES IT FIRES.    ║
 * ║                                                                           ║
 * ║  Phase 23's finding was twelve offered webhook events and a publish       ║
 * ║  function with zero product callers — every test green because every     ║
 * ║  test called the publisher directly. The boundary guard now refuses a     ║
 * ║  second door, and `trigger-producer.test.ts` refuses an unwired trigger. ║
 * ║  Neither can see a call site that exists but is dead code, which is      ║
 * ║  `call_booked`'s known failure shape. So these tests TRAVEL THE PATH:    ║
 * ║  the real assignment function, the real send worker, the real            ║
 * ║  unsubscribe recorder — with only the database edge mocked — and assert  ║
 * ║  `emitDomainEvent` actually ran, with the occurrence's own idempotency    ║
 * ║  key.                                                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ PROVEN NON-VACUOUS BY BREAKING IT: deleting any `emitDomainEvent` call
 * this file covers makes its test fail (verified before shipping — see the
 * mutation table in PHASE_23.md).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  /** Every `emitDomainEvent` call, in order. */
  emits: [] as Array<Record<string, unknown>>,
  /** Seeded rows per table, plus the claim RPC's result. */
  rows: new Map<string, Array<Record<string, unknown>>>(),
  nextId: 100,
}))

vi.mock('server-only', () => ({}))

/*
 * The door is mocked AT ITS OWN BOUNDARY. Its internals (dispatch, publish)
 * are integration-tested elsewhere; what this file proves is that the
 * business moments REACH it — the exact defect Phase 23 found.
 */
vi.mock('@/lib/events/emit', () => ({
  emitDomainEvent: vi.fn(async (input: Record<string, unknown>) => {
    mocks.emits.push(input)
    return { flow: { dispatched: 0 }, webhooksQueued: 0 }
  }),
}))

/*
 * A chainable PostgREST stand-in. Reads return the seeded rows; `.update`
 * patches them in place (so the send worker's `sending → sent` write works);
 * `.insert` allocates an id — which is the activity id `recordActivity`
 * returns, and therefore the occurrence identity for assignment keys.
 *
 * ⚠️ THE CHAIN IS THENABLE. PostgREST queries are awaited with no terminal
 * call (`const { data } = await q.in('id', ids)`), so the chain resolves
 * like a query builder does; `.maybeSingle()`/`.single()` return promises
 * and are awaited directly.
 */
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    const read = (table: string) => mocks.rows.get(table) ?? []
    const chain: Record<string, unknown> = {}
    Object.assign(chain, {
      select: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      order: vi.fn(() => chain),
      range: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      is: vi.fn(() => chain),
      in: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({
        data: read('current')[0] ? { ...read('current')[0] } : null,
        error: null,
      })),
      single: vi.fn(async () => ({
        data: read('current')[0] ? { ...read('current')[0] } : null,
        error: null,
      })),
      /*
       * Mutators return the chain synchronously, like PostgREST's builder:
       * `.insert(...).select(...).single()` chains, a bare `await` resolves
       * through `then`. Reads resolve to CLONES (see maybeSingle/then): a
       * real PostgREST read is a snapshot, so `assignContact` keeps the
       * owner it read even across the update that changes it.
       */
      upsert: vi.fn(() => chain),
      update: vi.fn((patch: Record<string, unknown>) => {
        for (const row of read('current')) Object.assign(row, patch)
        return chain
      }),
      insert: vi.fn((row: Record<string, unknown>) => {
        const withId = { id: String(mocks.nextId++), ...row }
        mocks.rows.set('current', [withId, ...read('current')])
        return chain
      }),
      // A bare `await query` resolves like PostgREST's builder does.
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: read('current').map((r) => ({ ...r })), error: null }),
    })
    return {
      rpc: vi.fn(async (name: string) => {
        if (name === 'claim_email_messages')
          return { data: read('email_messages'), error: null }
        if (name === 'stop_enrollments_for_email') return { data: 1, error: null }
        if (name === 'record_email_event') return { data: true, error: null }
        if (name === 'email_thread_mark_outbound') return { data: null, error: null }
        return { data: null, error: null }
      }),
      from: vi.fn((table: string) => {
        // Reads and writes target the seeded rows for THIS table.
        mocks.rows.set('current', [...(mocks.rows.get(table) ?? [])])
        return chain
      }),
    }
  },
}))

/*
 * The send worker's provider edge. Deterministic by subject: the first
 * seeded message is accepted, the second refused — proving the event fires
 * for what the provider took and NOT for what it rejected.
 */
vi.mock('@/lib/email/providers/registry', () => ({
  providerFor: () => ({
    send: async (_account: unknown, message: { subject: string }) =>
      message.subject === 'A fabricated subject'
        ? { ok: true, providerMessageId: 'prov-1', threadId: null }
        : { ok: false, retryable: false, code: 'REJECTED', message: 'refused' },
  }),
}))

vi.mock('@/lib/email/accounts', () => ({
  getEmailAccount: async (workspaceId: string, id: string) => ({
    id,
    workspaceId,
    provider: 'smtp',
    fromEmail: 'team@outlio.example',
    fromName: 'Outlio',
    replyToEmail: null,
    configuration: {},
    secretReference: null,
  }),
}))

vi.mock('@/lib/email/compliance', () => ({
  applyCompliance: (input: { bodyText: string }) => ({
    bodyText: input.bodyText,
    bodyHtml: null,
    headers: {},
  }),
}))

import { assignContact } from '@/lib/crm/activities'
import { recordUnsubscribe } from '@/lib/email/unsubscribe-action'
import { runSendWorker } from '@/lib/email/send'

const WS = '00000000-0000-4000-8000-000000000001'
const CONTACT = '00000000-0000-4000-8000-000000000010'
const OWNER_A = '00000000-0000-4000-8000-000000000020'
const OWNER_B = '00000000-0000-4000-8000-000000000021'
const ACCOUNT = '00000000-0000-4000-8000-000000000050'
const ACCEPTED = '00000000-0000-4000-8000-000000000030'
const REFUSED = '00000000-0000-4000-8000-000000000031'

/** A claimed message row, in the shape `claim_email_messages` returns. */
function claimedMessage(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    // `id` too: `complianceContext` re-reads the message rows by id, and the
    // claim's `message_id` is the same value the table stores as `id`.
    id: ACCEPTED,
    message_id: ACCEPTED,
    workspace_id: WS,
    account_id: ACCOUNT,
    to_email: 'person@example.com',
    subject: 'A fabricated subject',
    body_text: 'Fixture body.',
    body_html: null,
    thread_id: null,
    in_reply_to_message_id: null,
    idempotency_key: 'k1',
    attempts: 1,
    contact_id: CONTACT,
    campaign_id: null,
    ...patch,
  }
}

describe('crm.contact.assigned — the manual assignment path', () => {
  beforeEach(() => {
    mocks.emits.length = 0
    mocks.rows.clear()
    mocks.nextId = 100
    mocks.rows.set('crm_contacts', [
      { id: CONTACT, workspace_id: WS, owner_user_id: OWNER_A, deleted_at: null },
    ])
    mocks.rows.set('crm_activities', [])
  })

  it('fires when a contact moves to a new owner', async () => {
    await assignContact(WS, CONTACT, OWNER_B, OWNER_A)

    expect(mocks.emits).toHaveLength(1)
    const emit = mocks.emits[0]!
    expect(emit.triggerType).toBe('contact_assigned')
    expect(emit.workspaceId).toBe(WS)
    expect(emit.contactId).toBe(CONTACT)
    expect(emit.idempotencyKey).toMatch(/^contact_assigned:\d+$/)
    expect(emit.payload).toMatchObject({ contactId: CONTACT, from: OWNER_A, to: OWNER_B })
  })

  it('does not fire when the owner is unchanged', async () => {
    // The no-op path: same owner, nothing happened, nothing is announced.
    await assignContact(WS, CONTACT, OWNER_A, OWNER_A)
    expect(mocks.emits).toHaveLength(0)
  })

  it('uses a FRESH key per occurrence, so A→B→A fires twice', async () => {
    await assignContact(WS, CONTACT, OWNER_B, OWNER_A)
    // The write landed; the second move starts from owner B.
    mocks.rows.set('crm_contacts', [
      { id: CONTACT, workspace_id: WS, owner_user_id: OWNER_B, deleted_at: null },
    ])
    await assignContact(WS, CONTACT, OWNER_A, OWNER_A)

    expect(mocks.emits).toHaveLength(2)
    const keys = mocks.emits.map((e) => e.idempotencyKey)
    // Distinct activity rows — distinct occurrences, both announced.
    expect(new Set(keys).size).toBe(2)
  })
})

describe('email.contact.unsubscribed — the one-click path', () => {
  beforeEach(() => {
    mocks.emits.length = 0
    mocks.rows.clear()
  })

  it('fires with a key the flow engine can dedupe across repeated clicks', async () => {
    await recordUnsubscribe({
      workspaceId: WS,
      email: 'Person@Example.com',
      campaignId: null,
    })

    expect(mocks.emits).toHaveLength(1)
    const emit = mocks.emits[0]!
    expect(emit.triggerType).toBe('email_unsubscribed')
    expect(emit.workspaceId).toBe(WS)
    // The address is normalised exactly as suppression stores it.
    expect(emit.idempotencyKey).toBe(`email_unsubscribed:${WS}:person@example.com:all`)
    expect(emit.payload).toMatchObject({ email: 'person@example.com', campaignId: null })
  })

  it('distinguishes a campaign-scoped unsubscribe from a global one', async () => {
    const CAMPAIGN = '00000000-0000-4000-8000-000000000040'
    await recordUnsubscribe({ workspaceId: WS, email: 'person@example.com', campaignId: CAMPAIGN })

    const emit = mocks.emits[0]!
    expect(emit.idempotencyKey).toBe(`email_unsubscribed:${WS}:person@example.com:${CAMPAIGN}`)
    expect(emit.payload).toMatchObject({ campaignId: CAMPAIGN })
  })
})

describe('email.message.sent — the send worker, after the provider accepts', () => {
  beforeEach(() => {
    mocks.emits.length = 0
    mocks.rows.clear()
    /*
     * Two claimed messages: one the provider accepts, one it refuses
     * outright. The refusal must produce NO event — a failed send is not a
     * sent email, and a subscriber told "sent" for mail that never left
     * would be built on a false premise.
     */
    mocks.rows.set('email_messages', [
      claimedMessage({ message_id: ACCEPTED, subject: 'A fabricated subject', contact_id: CONTACT }),
      claimedMessage({
        id: REFUSED,
        message_id: REFUSED,
        subject: 'Another fixture',
        contact_id: null,
        // attempts 3 = the refusal is final, not re-queued
        attempts: 3,
      }),
    ])
  })

  it('fires for an accepted message and not for a refused one', async () => {
    const result = await runSendWorker('test-worker')

    expect(result.sent).toBe(1)
    expect(result.failed).toBe(1)

    expect(mocks.emits).toHaveLength(1)
    const emit = mocks.emits[0]!
    expect(emit.triggerType).toBe('email_sent')
    expect(emit.workspaceId).toBe(WS)
    expect(emit.contactId).toBe(CONTACT)
    expect(emit.idempotencyKey).toBe(`email_sent:${ACCEPTED}`)
    expect(emit.payload).toMatchObject({
      messageId: ACCEPTED,
      toEmail: 'person@example.com',
      contactId: CONTACT,
      campaignId: null,
    })
  })
})
