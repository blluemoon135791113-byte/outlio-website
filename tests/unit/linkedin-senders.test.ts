/**
 * The only way into `linkedin_senders`, and the two rules that make it safe.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE TABLE HAS NO RLS SELECT POLICY, SO THIS MODULE IS THE BOUNDARY.      ║
 * ║                                                                           ║
 * ║  Everything protective lives here or in the security-definer function it   ║
 * ║  calls: the membership check before a count, the refusal to let one user   ║
 * ║  claim another's profile, and the decision never to hand a client the      ║
 * ║  global identity key. A component that queries the table directly gets     ║
 * ║  none of it — which is why `schema-without-code` held this table's place   ║
 * ║  until this file existed.                                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const SENDERS = strip(readFileSync(join(ROOT, 'lib/linkedin/senders.ts'), 'utf8'))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

const { budgetKindForTask } = await import('@/lib/linkedin/senders')

describe('a failed count means a FULL budget, never an empty one', () => {
  it('does not coalesce a database error to zero', () => {
    /*
     * ⚠️ `?? 0` WOULD READ AN OUTAGE AS "NOTHING SENT YET" and release a full
     * day's work against an account we know nothing about. Same fail-closed
     * asymmetry as `contactIsStopped`: the cost of being wrong is a restriction
     * on somebody's real LinkedIn account, which nobody can undo.
     */
    expect(SENDERS).toMatch(/day\.error \? Number\.MAX_SAFE_INTEGER/)
    expect(SENDERS).toMatch(/week\.error \? Number\.MAX_SAFE_INTEGER/)
    expect(SENDERS, 'a failed count falls back to zero').not.toMatch(
      /usedToday = day\.data \?\? 0/,
    )
  })

  it('asks the database for both windows rather than deriving one', () => {
    // A daily count is not a weekly count over seven, and the ladder sets the
    // weekly cap deliberately below seven daily ones.
    expect(SENDERS).toMatch(/p_window: '1 day'/)
    expect(SENDERS).toMatch(/p_window: '7 days'/)
  })
})

describe('one user cannot claim another user’s profile', () => {
  it('refuses when the identity belongs to somebody else', () => {
    /*
     * §4.10 names it: account sharing. Only the real owner may perform actions
     * from their account, so linking one they do not own is the first step of
     * exactly the thing the brief prohibits.
     */
    expect(SENDERS).toMatch(/existing\.owner_user_id !== input\.ownerUserId/)
    expect(SENDERS).toMatch(/reason: 'unavailable'/)
  })

  it('gives the same generic reason for a conflict and a failure', () => {
    /*
     * ⚠️ DISTINGUISHING THEM WOULD CONFIRM THAT A GIVEN PROFILE IS ON OUTLIO,
     * which is a disclosure about somebody who never signed up. The same
     * reasoning as the product 404 refusing to say whether a record exists.
     */
    const conflictReasons = SENDERS.match(/reason: '([a-z_]+)'/g) ?? []
    const distinct = new Set(conflictReasons)
    // Only two failure reasons exist at all, and neither names the cause.
    expect(distinct).toEqual(new Set(["reason: 'unavailable'", "reason: 'invalid_profile_url'"]))
    expect(SENDERS).not.toMatch(/already_claimed|belongs_to|taken/)
  })

  it('treats a second workspace for the SAME user as a link, not a conflict', () => {
    // §4.10's shared-budget case: one human, two customers, one sender row.
    expect(SENDERS).toMatch(/from\('linkedin_sender_links'\)\s*\n\s*\.upsert\(/)
    expect(SENDERS).toMatch(/ignoreDuplicates: true/)
  })
})

describe('the global identity key never reaches a client', () => {
  it('is absent from the workspace listing', () => {
    /*
     * ⚠️ `identity_key` IS THE GLOBAL JOIN KEY. Handing it out would let two
     * workspaces correlate a sender between them — the browseable list §4.10
     * forbids, assembled one response at a time.
     */
    const listing = SENDERS.slice(SENDERS.indexOf('export async function listWorkspaceSenders'))
    expect(listing).toMatch(/select\('id, display_label, status, stage'\)/)
    expect(listing, 'the listing selects identity_key').not.toContain('identity_key')
  })

  it('scopes the link lookup by workspace', () => {
    // The service role bypasses RLS; this filter is the only wall on which
    // senders a workspace can even see the existence of.
    const listing = SENDERS.slice(SENDERS.indexOf('export async function listWorkspaceSenders'))
    expect(listing).toMatch(/\.eq\('workspace_id', workspaceId\)/)
  })
})

describe('a new sender starts at stage zero', () => {
  it('releases nothing until an owner reviews it', () => {
    // §4.10: "release zero proactive actions until the owner reviews account
    // status". A freshly linked account is unreviewed, not presumed fine.
    expect(SENDERS).toMatch(/stage: 0/)
    expect(SENDERS).toMatch(/status: 'unknown'/)
  })
})

describe('task kinds map to the budget they spend', () => {
  it('routes each manual task to its own ladder', () => {
    expect(budgetKindForTask('CONNECTION_REQUEST')).toBe('invitation')
    expect(budgetKindForTask('DIRECT_MESSAGE')).toBe('direct_message')
    expect(budgetKindForTask('INMAIL')).toBe('inmail')
    expect(budgetKindForTask('REVIEW_PROFILE')).toBe('profile_review')
  })
})
