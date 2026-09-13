/**
 * A removed member's authority must not outlive their membership — A5.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE DEFECT.                                                              ║
 * ║                                                                           ║
 * ║  `stampSendAuthority` writes `actorAuthorized: true` into a flow version  ║
 * ║  at publish time, and a published version is IMMUTABLE by design — that   ║
 * ║  immutability is criterion 3 of the flow engine and is not the bug.       ║
 * ║                                                                           ║
 * ║  The bug is that the send step trusted that boolean and nothing else. So  ║
 * ║  the sentence it actually asserted was "this person could send in March", ║
 * ║  and a member removed in April kept sending mail from every flow they had ║
 * ║  ever published — indefinitely, until somebody happened to re-publish it. ║
 * ║                                                                           ║
 * ║  ⚠️ THE INTERACTIVE PATH NEVER HAD THIS PROBLEM.                          ║
 * ║  `assertWorkspacePermission` calls `resolve()` directly — uncached — so   ║
 * ║  it re-reads `workspace_memberships` on every call and a removed member   ║
 * ║  is refused on their very next request. Only UNATTENDED work, which has   ║
 * ║  no request and no cookie, was reading a value frozen months earlier.     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ PROVEN NON-VACUOUS BY BREAKING IT (§2.1): making `memberMayNow` return
 * true when no membership row exists fails "refuses a member who has been
 * removed", and dropping the live half of the `&&` in `lib/flows/actions/email.ts`
 * fails "the send step checks authority NOW, not just at publish".
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  /** The membership row the query resolves to. `null` means removed. */
  membership: null as { role: string } | null,
  readError: null as { message: string } | null,
  modules: new Set<string>(['crm', 'email']),
  /** Every (workspace, user) pair the lookup was asked about. */
  lookups: [] as Array<{ workspaceId: string; userId: string }>,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (_table: string) => {
      const filters: Record<string, string> = {}
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          filters[column] = value
          return builder
        },
        maybeSingle: async () => {
          mocks.lookups.push({
            workspaceId: filters.workspace_id!,
            userId: filters.user_id!,
          })
          return { data: mocks.membership, error: mocks.readError }
        },
      }
      return builder
    },
  }),
}))

vi.mock('@/lib/workspaces/entitlements', () => ({
  getWorkspaceEntitlements: async () => ({ modules: mocks.modules, memberLimit: null }),
}))

const { memberMayNow } = await import('@/lib/workspaces/authority')

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  mocks.membership = { role: 'manager' }
  mocks.readError = null
  mocks.modules = new Set(['crm', 'email'])
  mocks.lookups = []
})

describe('memberMayNow', () => {
  it('allows a current member whose role carries the permission', async () => {
    expect(await memberMayNow(WORKSPACE, USER, 'email.campaign.launch')).toBe(true)
  })

  it('refuses a member who has been removed', async () => {
    /*
     * ⚠️ THE CASE THE WHOLE FIX EXISTS FOR. `removeMemberAction` hard-DELETEs
     * the row, so "removed" and "never a member" are the same observation —
     * and both must answer false rather than raising, because a flow asking
     * this question is not an error condition.
     */
    mocks.membership = null

    expect(await memberMayNow(WORKSPACE, USER, 'email.campaign.launch')).toBe(false)
  })

  it('refuses a member whose role is too low, not merely a non-member', async () => {
    // Demotion has to bite as well as removal, or a manager dropped to setter
    // keeps sending through flows they published while senior.
    mocks.membership = { role: 'setter' }

    expect(await memberMayNow(WORKSPACE, USER, 'email.campaign.launch')).toBe(false)
  })

  it('refuses when the workspace lost the module entitlement', async () => {
    mocks.modules = new Set(['crm'])

    expect(await memberMayNow(WORKSPACE, USER, 'email.campaign.launch')).toBe(false)
  })

  it('refuses a null user without going to the database', async () => {
    // `flow_versions.created_by` is nullable — the FK sets it null if the
    // publisher's auth row is deleted. A flow with nobody accountable acts for
    // nobody.
    expect(await memberMayNow(WORKSPACE, null, 'email.campaign.launch')).toBe(false)
    expect(mocks.lookups).toHaveLength(0)
  })

  it('scopes the lookup to the workspace as well as the user', async () => {
    // Scoped by user alone, a member of ANY workspace would pass — the service
    // role bypasses RLS, so the WHERE clause is the only tenancy wall here.
    await memberMayNow(WORKSPACE, USER, 'email.campaign.launch')

    expect(mocks.lookups).toEqual([{ workspaceId: WORKSPACE, userId: USER }])
  })

  it('throws on a failed read rather than reporting "not allowed"', async () => {
    /*
     * ⚠️ A DATABASE BLIP IS AN UNKNOWN, NOT A DENIAL. Returning false would be
     * recorded by the send gate as `not_authorized` — which `isTransient`
     * classifies as permanent, so the run would stop for good over a momentary
     * failure. Throwing lets it fail and come back.
     */
    mocks.readError = { message: 'connection reset' }

    await expect(memberMayNow(WORKSPACE, USER, 'email.campaign.launch')).rejects.toThrow(
      /memberMayNow failed/,
    )
  })
})

// ---------------------------------------------------------------------------
// The wiring. Asserted on source, because the alternative is standing up the
// whole send path to observe one boolean.
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** ⚠️ `\r?\n`: `.` does not match `\r`, so a CRLF checkout strips nothing. */
const code = (s: string) =>
  s.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*\r?\n/gm, '').replace(/^[ \t]*\/\/.*\r?\n/gm, '')

describe('the unattended paths consult it', () => {
  const email = code(read('lib/flows/actions/email.ts'))
  const hubble = code(read('lib/flows/actions/hubble.ts'))

  it('the send step checks authority NOW, not just at publish', () => {
    expect(email).toContain('memberMayNow')
    /*
     * ⚠️ BOTH HALVES. The stamp alone is the defect. The live check alone
     * would let a flow published by someone unauthorized start sending the
     * moment they were later granted the permission — authority they did not
     * hold when the flow was reviewed.
     */
    expect(email).toContain('config.actorAuthorized === true')
    expect(email).toMatch(/config\.actorAuthorized === true\s*&&[\s\S]{0,200}memberMayNow/)
  })

  it('the AI step will not spend a departed member’s credits', () => {
    expect(hubble).toContain('memberMayNow')
    expect(hubble).toContain('BILLING_USER_INACTIVE')
  })

  it('neither reads workspace_memberships itself', () => {
    /*
     * `lib/workspaces/context.ts` states the invariant: nothing else reads
     * that table to make a decision. `authority.ts` is part of that layer; a
     * handler querying it directly would be a second policy implementation,
     * which is how the two drift apart.
     */
    expect(email).not.toContain('workspace_memberships')
    expect(hubble).not.toContain('workspace_memberships')
  })
})
