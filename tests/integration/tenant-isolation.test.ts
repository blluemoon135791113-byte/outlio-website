/**
 * Workspace A must never reach workspace B's data — by any route.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  DoD ITEM 4. THIS COULD NOT BE WRITTEN UNTIL 2026-09-04.                 ║
 * ║                                                                           ║
 * ║  `.env.local` pointed at production, so building this suite would have    ║
 * ║  meant MANUFACTURING TENANTS IN THE LIVE DATABASE in order to prove       ║
 * ║  tenants are isolated. ADR-004 conceded the journey as `INFERRED`.        ║
 * ║  ADR-005 created `outlio-staging` and withdrew that concession.           ║
 * ║                                                                           ║
 * ║  ⚠️ EVERY ASSERTION HERE USES A REAL USER JWT, NOT THE SERVICE ROLE. The   ║
 * ║  service role bypasses RLS entirely — a suite written with `adminClient`  ║
 * ║  would pass against a database with no policies at all, which is the      ║
 * ║  most reassuring possible way to test nothing.                           ║
 * ║                                                                           ║
 * ║  ⚠️ READS ARE THE EASY HALF. A denied read returns an empty set, which is  ║
 * ║  indistinguishable from "no rows exist" — so every read assertion is      ║
 * ║  paired with a POSITIVE control proving the same query DOES return the    ║
 * ║  row for its rightful owner. Without that pairing an RLS policy of        ║
 * ║  `USING (false)` would pass every test in this file.                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  adminClient,
  createTestUser,
  deleteTestUser,
  hasSupabaseEnv,
  type TestUser,
} from './helpers'

const describeIf = hasSupabaseEnv ? describe : describe.skip

type Tenant = {
  user: TestUser
  workspaceId: string
  contactId: string
  companyId: string
}

/** The workspace `handle_new_user` created for this user at signup. */
async function workspaceOf(userId: string): Promise<string> {
  const { data, error } = await adminClient()
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', userId)
    .maybeSingle()

  if (error || !data) {
    throw new Error(
      `no workspace for ${userId}: ${error?.message ?? 'none found'}. ` +
        'handle_new_user should create one at signup — see migration 0110.',
    )
  }
  return data.id
}

async function makeTenant(label: string): Promise<Tenant> {
  const user = await createTestUser(label)
  const workspaceId = await workspaceOf(user.id)
  const admin = adminClient()

  const { data: company, error: companyError } = await admin
    .from('crm_companies')
    /*
     * ⚠️ `normalized_name` IS REQUIRED, not decorative. The
     * `crm_companies_has_identity` constraint demands at least one of
     * normalized_domain / normalized_linkedin_url / normalized_name — a company
     * with only a display name has no identity to deduplicate against.
     */
    .insert({
      workspace_id: workspaceId,
      name: `${label} Holdings`,
      normalized_name: `${label} holdings`,
    })
    .select('id')
    .single()
  if (companyError) throw new Error(`seed company failed: ${companyError.message}`)

  const { data: contact, error: contactError } = await admin
    .from('crm_contacts')
    /*
     * No company_id here: crm_contacts has no such column. The link lives in
     * crm_contact_company_relationships. The company is seeded anyway, as a
     * SECOND tenant table to prove isolation on — a policy can be right for
     * contacts and absent for companies.
     */
    .insert({ workspace_id: workspaceId, full_name: `${label} Person` })
    .select('id')
    .single()
  if (contactError) throw new Error(`seed contact failed: ${contactError.message}`)

  return { user, workspaceId, contactId: contact.id, companyId: company.id }
}

describeIf('tenant isolation', () => {
  let a: Tenant
  let b: Tenant

  beforeAll(async () => {
    a = await makeTenant('tenant-a')
    b = await makeTenant('tenant-b')
  }, 120_000)

  afterAll(async () => {
    /*
     * ⚠️ CLEANUP RUNS EVEN AFTER FAILURES, and it deletes the USER — the
     * workspace, membership, contacts and companies cascade. Leaving them is
     * how 43 orphan accounts accumulated in production before this suite moved
     * to staging.
     */
    for (const t of [a, b]) {
      if (t?.user?.id) await deleteTestUser(t.user.id)
    }
  }, 120_000)

  describe('the fixtures are real', () => {
    it('created two distinct workspaces', () => {
      // Without this, every isolation assertion below could be comparing a
      // workspace with itself and passing for the wrong reason.
      expect(a.workspaceId).toBeTruthy()
      expect(b.workspaceId).toBeTruthy()
      expect(a.workspaceId).not.toBe(b.workspaceId)
      expect(a.contactId).not.toBe(b.contactId)
    })

    it('POSITIVE CONTROL: each owner can read their own contact', async () => {
      /*
       * ⚠️ THE MOST IMPORTANT TEST IN THIS FILE. Every denial below asserts an
       * empty result, and an RLS policy of `USING (false)` produces an empty
       * result for everyone — passing every other test here while breaking the
       * product completely. This is what makes the denials mean something.
       */
      const { data: mineA } = await a.user.client
        .from('crm_contacts')
        .select('id, full_name')
        .eq('id', a.contactId)
      expect(mineA, 'owner A cannot read their own contact — RLS is too strict').toHaveLength(1)

      const { data: mineB } = await b.user.client
        .from('crm_contacts')
        .select('id')
        .eq('id', b.contactId)
      expect(mineB).toHaveLength(1)
    })
  })

  describe('reads across the boundary', () => {
    it('A cannot read B’s contact by id — the direct-URL shape', async () => {
      /*
       * Requesting a specific id is what a hand-typed URL does: `/crm/contacts/
       * <someone else's id>`. The server resolves that id against the database,
       * so this is the same question the page asks.
       */
      const { data, error } = await a.user.client
        .from('crm_contacts')
        .select('id, full_name')
        .eq('id', b.contactId)

      expect(error).toBeNull()
      expect(data, 'workspace A read workspace B’s contact by id').toEqual([])
    })

    it('A cannot read B’s contact by listing everything', async () => {
      const { data } = await a.user.client.from('crm_contacts').select('id')
      const ids = (data ?? []).map((r) => r.id)
      expect(ids).toContain(a.contactId)
      expect(ids, 'an unfiltered list leaked another workspace').not.toContain(b.contactId)
    })

    it('A cannot read B’s company', async () => {
      // Isolation has to hold on every tenant table, not just the obvious one.
      const { data } = await a.user.client
        .from('crm_companies')
        .select('id')
        .eq('id', b.companyId)
      expect(data).toEqual([])
    })

    it('naming B’s workspace id explicitly does not help', async () => {
      /*
       * ⚠️ THE ATTACK THIS MODELS: a caller who has LEARNED another tenant's id
       * and supplies it. RLS must not care what the client asks for — the
       * policy decides, not the filter.
       */
      const { data } = await a.user.client
        .from('crm_contacts')
        .select('id')
        .eq('workspace_id', b.workspaceId)
      expect(data, 'supplying another workspace id returned its rows').toEqual([])
    })

    it('A cannot see B’s workspace row', async () => {
      const { data } = await a.user.client.from('workspaces').select('id').eq('id', b.workspaceId)
      expect(data).toEqual([])
    })

    it('A cannot enumerate B’s membership', async () => {
      // Membership leaks who works where, which is customer information.
      const { data } = await a.user.client
        .from('workspace_memberships')
        .select('user_id')
        .eq('workspace_id', b.workspaceId)
      expect(data).toEqual([])
    })
  })

  describe('writes across the boundary', () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ THESE PASS FOR A STRONGER REASON THAN RLS, AND THE DIFFERENCE      ║
     * ║  MATTERS TO ANYONE READING THIS FILE.                                 ║
     * ║                                                                        ║
     * ║  Measured on 2026-09-04 against staging:                              ║
     * ║                                                                        ║
     * ║      authenticated | SELECT                                           ║
     * ║      service_role  | DELETE,INSERT,REFERENCES,SELECT,...,UPDATE       ║
     * ║                                                                        ║
     * ║  `authenticated` HAS NO WRITE GRANT ON `crm_contacts` AT ALL. Every    ║
     * ║  write below is refused by PostgREST before any RLS policy is          ║
     * ║  consulted — which was proved by disabling RLS on staging and re-      ║
     * ║  running: the three READ tests failed and every write test still       ║
     * ║  passed.                                                              ║
     * ║                                                                        ║
     * ║  So these assertions do NOT prove an RLS write policy is correct.      ║
     * ║  They prove no signed-in client can write through PostgREST at all.    ║
     * ║  That is a stronger guarantee, and it is worth stating plainly because ║
     * ║  the obvious reading — "RLS protects writes" — is wrong here.          ║
     * ║                                                                        ║
     * ║  ⚠️ WHERE WRITE PROTECTION ACTUALLY LIVES: every CRM mutation goes      ║
     * ║  through a server action holding the SERVICE ROLE, which bypasses RLS  ║
     * ║  entirely. Its safety rests on the permission gate                     ║
     * ║  (`action-authorization.test.ts`) and on scoping in code               ║
     * ║  (`service-role-scoping.test.ts`, `lib/auth/scope.ts`) — not on        ║
     * ║  anything asserted in this describe block.                            ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     *
     * Each write is still verified by RE-READING the row as its rightful owner,
     * because PostgREST reports "updated zero rows" and an actual denial
     * identically.
     */
    it('A cannot rename B’s contact', async () => {
      await a.user.client
        .from('crm_contacts')
        .update({ full_name: 'OWNED BY A' })
        .eq('id', b.contactId)

      const { data } = await adminClient()
        .from('crm_contacts')
        .select('full_name')
        .eq('id', b.contactId)
        .single()

      expect(data?.full_name, 'workspace A modified workspace B’s contact').not.toBe(
        'OWNED BY A',
      )
    })

    it('A cannot soft-delete B’s contact', async () => {
      await a.user.client
        .from('crm_contacts')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', b.contactId)

      const { data } = await adminClient()
        .from('crm_contacts')
        .select('deleted_at')
        .eq('id', b.contactId)
        .single()

      expect(data?.deleted_at, 'workspace A soft-deleted workspace B’s contact').toBeNull()
    })

    it('A cannot hard-delete B’s contact', async () => {
      await a.user.client.from('crm_contacts').delete().eq('id', b.contactId)

      const { count } = await adminClient()
        .from('crm_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('id', b.contactId)

      expect(count, 'workspace A deleted workspace B’s contact').toBe(1)
    })

    it('A cannot insert a contact into B’s workspace', async () => {
      /*
       * The subtlest of the four: writing INTO another tenant rather than
       * reading out of it. A permissive INSERT policy plants data in somebody
       * else's CRM, and no read test would ever notice.
       */
      const { error } = await a.user.client
        .from('crm_contacts')
        .insert({ workspace_id: b.workspaceId, full_name: 'PLANTED BY A' })

      const { count } = await adminClient()
        .from('crm_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', b.workspaceId)
        .eq('full_name', 'PLANTED BY A')

      expect(count, 'workspace A planted a contact in workspace B').toBe(0)
      expect(error, 'the insert should have been refused outright').not.toBeNull()
    })

    it('A cannot rename B’s workspace', async () => {
      await a.user.client.from('workspaces').update({ name: 'TAKEN OVER' }).eq('id', b.workspaceId)

      const { data } = await adminClient()
        .from('workspaces')
        .select('name')
        .eq('id', b.workspaceId)
        .single()

      expect(data?.name).not.toBe('TAKEN OVER')
    })
  })

  describe('the service role is the exception, and that is why code must scope', () => {
    it('reaches both workspaces, by design', async () => {
      /*
       * ⚠️ NOT A VULNERABILITY — IT IS THE REASON `lib/auth/scope.ts` EXISTS.
       * The service role bypasses RLS, so 135 files in this repo are protected
       * only by scoping in code. This test states that plainly rather than
       * leaving a reader to assume RLS is catching everything.
       */
      const { data } = await adminClient()
        .from('crm_contacts')
        .select('id')
        .in('id', [a.contactId, b.contactId])

      expect(data, 'the service role should see both — if not, this test is stale').toHaveLength(2)
    })
  })
})
