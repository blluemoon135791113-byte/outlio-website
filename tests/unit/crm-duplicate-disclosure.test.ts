/**
 * A duplicate match never discloses a record the caller may not read — T04.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE BUG THIS PINS.                                                       ║
 * ║                                                                           ║
 * ║  Deduplication runs on the service role, so it matches across the WHOLE   ║
 * ║  workspace. `dataScope` narrows a setter to records they own, but the      ║
 * ║  create path applied no such filter to the match it found: it returned     ║
 * ║  the matched contact's id and "That person was already in your CRM —      ║
 * ║  opening them instead" whoever owned them.                                ║
 * ║                                                                           ║
 * ║  That is an enumeration oracle. A setter who guesses an address learns    ║
 * ║  whether that person is in the workspace, and receives the id to open.    ║
 * ║  Repeat with a list of addresses and the private half of the contact      ║
 * ║  database is readable one guess at a time.                                ║
 * ║                                                                           ║
 * ║  T04: "No owner/name/ID/count disclosure; admin review path still         ║
 * ║  prevents unsafe duplication." Both halves are asserted here — silence    ║
 * ║  alone would be a refusal, and a refusal that records nothing leaves the  ║
 * ║  duplicate to be created by the next person who tries.                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ PROVEN NON-VACUOUS BY BREAKING IT (§2.1): reverting `createContactAction`
 * to return `{ contactId, created }` unconditionally makes
 * "says nothing at all about a contact the caller may not read" fail on the
 * contactId assertion. Verified by mutation before this file shipped.
 *
 * Fixtures are fabricated: invented names, example.com addresses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callerId: '00000000-0000-4000-8000-000000000001',
  otherOwnerId: '00000000-0000-4000-8000-000000000002',
  workspaceId: '00000000-0000-4000-8000-000000000003',
  matchedContactId: '00000000-0000-4000-8000-000000000004',

  /** Set per test. */
  role: 'setter' as 'setter' | 'manager',
  ingestResult: {
    contactId: '00000000-0000-4000-8000-000000000004',
    created: false,
    ownerUserId: '00000000-0000-4000-8000-000000000002',
  },

  reassignmentRequests: [] as Array<{ contactId: string; requestedBy: string }>,
  /** Simulates the partial unique index on pending requests. */
  requestThrowsDuplicate: false,
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

vi.mock('@/lib/workspaces/context', () => ({
  assertWorkspacePermission: async () => ({
    userId: mocks.callerId,
    role: mocks.role,
    workspace: { id: mocks.workspaceId },
  }),
}))

vi.mock('@/lib/crm/ingest', () => ({
  createContactManually: async () => mocks.ingestResult,
}))

/*
 * `DuplicateRequestError` must stay a real class: the action distinguishes it
 * with `instanceof`, and a plain object would fall through to the rethrow.
 */
class DuplicateRequestError extends Error {}

vi.mock('@/lib/crm/collision', () => ({
  DuplicateRequestError,
  checkCollision: async () => ({ blocked: false }),
  recordCollisionOverride: async () => 'override-id',
  requestReassignment: async (_ws: string, contactId: string, requestedBy: string) => {
    if (mocks.requestThrowsDuplicate) throw new DuplicateRequestError('already asked')
    mocks.reassignmentRequests.push({ contactId, requestedBy })
    return 'request-id'
  },
}))

const { createContactAction } = await import('@/lib/crm/contact-actions')

/** The form the product actually submits. */
function form(): FormData {
  const fd = new FormData()
  fd.set('fullName', 'Fabricated Person')
  fd.set('email', 'fabricated.person@example.com')
  return fd
}

beforeEach(() => {
  mocks.role = 'setter'
  mocks.ingestResult = {
    contactId: mocks.matchedContactId,
    created: false,
    ownerUserId: mocks.otherOwnerId,
  }
  mocks.reassignmentRequests = []
  mocks.requestThrowsDuplicate = false
})

describe('a match the caller may not read', () => {
  it('says nothing at all about a contact the caller may not read', async () => {
    const state = await createContactAction(null, form())

    expect(state?.ok).toBe(true)

    /*
     * The whole point. Serialised and searched rather than reading one field,
     * because the leak is any path by which the id escapes — a new field added
     * later would slip past `expect(state.contactId).toBeUndefined()`.
     */
    const wire = JSON.stringify(state)
    expect(wire, 'the matched id reached the client').not.toContain(mocks.matchedContactId)
    expect(wire, 'the owner reached the client').not.toContain(mocks.otherOwnerId)
  })

  it('does not confirm the person exists', async () => {
    const state = await createContactAction(null, form())
    const message = state?.ok ? state.message : ''

    // The old copy asserted the person's presence outright.
    expect(message).not.toMatch(/already in your CRM/i)
    // Nor may it echo what was typed, which confirms the match just as well.
    expect(message).not.toMatch(/Fabricated Person|fabricated\.person@example\.com/i)
  })

  it('still opens the admin review path, so the duplicate is not merely refused', async () => {
    await createContactAction(null, form())

    expect(mocks.reassignmentRequests).toHaveLength(1)
    expect(mocks.reassignmentRequests[0]).toEqual({
      contactId: mocks.matchedContactId,
      requestedBy: mocks.callerId,
    })
  })

  it('answers a second attempt exactly like the first', async () => {
    const first = await createContactAction(null, form())

    // The request already exists; the unique index refuses the second insert.
    mocks.requestThrowsDuplicate = true
    const second = await createContactAction(null, form())

    /*
     * ⚠️ A DIFFERENT ANSWER THE SECOND TIME IS ITSELF THE DISCLOSURE. "You have
     * already asked for this contact" tells a prober their guess was right,
     * which is the fact T04 withholds.
     */
    expect(second).toEqual(first)
  })
})

describe('a match the caller may read', () => {
  it('links and opens when the caller owns the match', async () => {
    mocks.ingestResult = {
      contactId: mocks.matchedContactId,
      created: false,
      ownerUserId: mocks.callerId,
    }

    const state = await createContactAction(null, form())

    expect(state?.ok && 'contactId' in state && state.contactId).toBe(mocks.matchedContactId)
    expect(mocks.reassignmentRequests).toHaveLength(0)
  })

  it('links and opens when the caller sees the whole workspace', async () => {
    // A manager's dataScope is 'all', so nothing is hidden from them to leak.
    mocks.role = 'manager'

    const state = await createContactAction(null, form())

    expect(state?.ok && 'contactId' in state && state.contactId).toBe(mocks.matchedContactId)
    expect(mocks.reassignmentRequests).toHaveLength(0)
  })

  it('returns the new contact when nothing matched', async () => {
    mocks.ingestResult = {
      contactId: mocks.matchedContactId,
      created: true,
      ownerUserId: mocks.callerId,
    }

    const state = await createContactAction(null, form())

    expect(state?.ok && 'contactId' in state && state.contactId).toBe(mocks.matchedContactId)
    expect(state?.ok && 'created' in state && state.created).toBe(true)
    expect(mocks.reassignmentRequests).toHaveLength(0)
  })
})
