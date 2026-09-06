/**
 * Workspace tenancy and invitation redemption — M1 acceptance criterion 2:
 * "Tenancy isolation test proves no cross-workspace reads/writes."
 *
 * Everything here needs migration 0070 applied to a real project, because it
 * tests the parts that only exist in Postgres and that a unit test cannot
 * reach: the RLS policies, the atomic redeem function, the last-owner trigger,
 * the column-protection trigger and the signup trigger.
 *
 * The policy MATRIX is unit-tested in tests/unit/workspace-permissions.test.ts.
 * This file asks a different question — not "what does the policy say?" but
 * "does the database actually stop it?".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createInvitationToken } from '@/lib/workspaces/tokens'
import {
  adminClient,
  createTestUser,
  deleteTestUser,
  hasSupabaseEnv,
  type TestUser,
} from './helpers'

const describeIf = hasSupabaseEnv ? describe : describe.skip

/** The workspace `handle_new_user()` created for a user at signup. */
async function ownedWorkspace(userId: string) {
  const { data, error } = await adminClient()
    .from('workspace_memberships')
    .select('id, workspace_id, role')
    .eq('user_id', userId)
    .single()

  if (error) throw new Error(`ownedWorkspace failed: ${error.message}`)
  return data
}

describeIf('workspace tenancy', () => {
  let alice: TestUser
  let bob: TestUser
  let aliceWorkspaceId: string
  let bobWorkspaceId: string

  beforeAll(async () => {
    alice = await createTestUser('ws-alice')
    bob = await createTestUser('ws-bob')
    aliceWorkspaceId = (await ownedWorkspace(alice.id)).workspace_id
    bobWorkspaceId = (await ownedWorkspace(bob.id)).workspace_id
  })

  afterAll(async () => {
    // Workspaces cascade from auth.users, which also exercises the cascade
    // escape hatch in guard_last_workspace_owner().
    if (alice) await deleteTestUser(alice.id)
    if (bob) await deleteTestUser(bob.id)
  })

  // -------------------------------------------------------------------------
  // handle_new_user
  // -------------------------------------------------------------------------

  describe('every new signup gets a workspace', () => {
    it('creates exactly one workspace, owned by the new user', async () => {
      const membership = await ownedWorkspace(alice.id)
      expect(membership.role).toBe('owner')

      const { data: workspace } = await adminClient()
        .from('workspaces')
        .select('owner_user_id, name, member_limit_override, deleted_at')
        .eq('id', membership.workspace_id)
        .single()

      expect(workspace?.owner_user_id).toBe(alice.id)
      expect(workspace?.name).toContain("'s workspace")
      expect(workspace?.deleted_at).toBeNull()
      // Seats are platform-managed and start unset — the plan decides.
      expect(workspace?.member_limit_override).toBeNull()
    })

    it('gives two users two different workspaces', () => {
      expect(aliceWorkspaceId).not.toBe(bobWorkspaceId)
    })
  })

  // -------------------------------------------------------------------------
  // Cross-workspace isolation — THE acceptance criterion
  // -------------------------------------------------------------------------

  describe('cross-workspace reads', () => {
    it('lets Alice read her own workspace', async () => {
      const { data } = await alice.client
        .from('workspaces')
        .select('id')
        .eq('id', aliceWorkspaceId)

      expect(data?.map((r) => r.id)).toEqual([aliceWorkspaceId])
    })

    it("does NOT let Alice read Bob's workspace", async () => {
      const { data, error } = await alice.client
        .from('workspaces')
        .select('id')
        .eq('id', bobWorkspaceId)

      // RLS filters rather than errors — an empty result IS the denial.
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('does not let Alice enumerate every workspace', async () => {
      const { data } = await alice.client.from('workspaces').select('id')
      expect(data?.map((r) => r.id)).toEqual([aliceWorkspaceId])
    })

    it("does NOT let Alice read Bob's memberships", async () => {
      const { data } = await alice.client
        .from('workspace_memberships')
        .select('id')
        .eq('workspace_id', bobWorkspaceId)

      expect(data).toEqual([])
    })

    it("does NOT let Alice read Bob's feature flags", async () => {
      await adminClient()
        .from('workspace_feature_flags')
        .insert({ workspace_id: bobWorkspaceId, flag: 'module.crm', enabled: false })

      const { data } = await alice.client
        .from('workspace_feature_flags')
        .select('flag')
        .eq('workspace_id', bobWorkspaceId)

      expect(data).toEqual([])

      await adminClient()
        .from('workspace_feature_flags')
        .delete()
        .eq('workspace_id', bobWorkspaceId)
    })

    it("does NOT let Alice read Bob's invitations, which carry an email", async () => {
      const { tokenHash } = createInvitationToken()
      await adminClient().from('workspace_invitations').insert({
        workspace_id: bobWorkspaceId,
        email: 'someone@example.com',
        role: 'setter',
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      })

      const { data } = await alice.client
        .from('workspace_invitations')
        .select('email')
        .eq('workspace_id', bobWorkspaceId)

      expect(data).toEqual([])

      await adminClient()
        .from('workspace_invitations')
        .delete()
        .eq('token_hash', tokenHash)
    })
  })

  describe('cross-workspace writes', () => {
    it("does NOT let Alice rename Bob's workspace", async () => {
      const { data } = await alice.client
        .from('workspaces')
        .update({ name: 'Taken over' })
        .eq('id', bobWorkspaceId)
        .select('id')

      expect(data ?? []).toEqual([])

      const { data: after } = await adminClient()
        .from('workspaces')
        .select('name')
        .eq('id', bobWorkspaceId)
        .single()

      expect(after?.name).not.toBe('Taken over')
    })

    it('does NOT let Alice insert herself into another workspace', async () => {
      const { error } = await alice.client
        .from('workspace_memberships')
        // ⚠️ THIS TYPECHECKS. Generated types describe the table's shape, not
        // who may write it, so nothing in TypeScript stops this call — only
        // the missing INSERT grant does, at runtime. That is precisely why
        // this test exists.
        .insert({ workspace_id: bobWorkspaceId, user_id: alice.id, role: 'owner' })

      expect(error).not.toBeNull()

      const { count } = await adminClient()
        .from('workspace_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', bobWorkspaceId)

      expect(count).toBe(1)
    })

    it('does NOT let Alice promote herself inside her own workspace', async () => {
      // She is already owner, so this is about the missing UPDATE grant on the
      // membership table, not about the role value.
      const { error } = await alice.client
        .from('workspace_memberships')
        .update({ role: 'owner' })
        .eq('workspace_id', aliceWorkspaceId)
        .select('id')

      expect(error).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // protect_workspace_columns
  // -------------------------------------------------------------------------

  describe('seat ceilings are platform-managed', () => {
    it('lets an owner rename their workspace', async () => {
      const name = `Renamed ${Date.now()}`
      const { error } = await alice.client
        .from('workspaces')
        .update({ name })
        .eq('id', aliceWorkspaceId)

      expect(error).toBeNull()

      const { data } = await adminClient()
        .from('workspaces')
        .select('name')
        .eq('id', aliceWorkspaceId)
        .single()

      expect(data?.name).toBe(name)
    })

    it('does NOT let an owner raise their own seat limit', async () => {
      // Seats are what the customer pays for. The column carries no UPDATE
      // grant, so PostgREST refuses before the trigger is even consulted — and
      // protect_workspace_columns() still reverts the value for any path that
      // gets past that. Note this typechecks: the type describes the column,
      // not the privilege.
      const { error } = await alice.client
        .from('workspaces')
        .update({ member_limit_override: 999 })
        .eq('id', aliceWorkspaceId)

      expect(error).not.toBeNull()

      const { data } = await adminClient()
        .from('workspaces')
        .select('member_limit_override')
        .eq('id', aliceWorkspaceId)
        .single()

      expect(data?.member_limit_override).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // guard_last_workspace_owner
  // -------------------------------------------------------------------------

  describe('a workspace can never be left without an owner', () => {
    it('refuses to delete the only owner', async () => {
      const membership = await ownedWorkspace(alice.id)
      const { error } = await adminClient()
        .from('workspace_memberships')
        .delete()
        .eq('id', membership.id)

      // The service role bypasses RLS; the TRIGGER is what stops this, which
      // is exactly why the rule lives in the database and not in a guard clause.
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/at least one owner/i)
    })

    it('refuses to demote the only owner', async () => {
      const membership = await ownedWorkspace(alice.id)
      const { error } = await adminClient()
        .from('workspace_memberships')
        .update({ role: 'admin' })
        .eq('id', membership.id)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/at least one owner/i)
    })

    it('allows it once a second owner exists', async () => {
      const admin = adminClient()
      const { data: extra, error: insertError } = await admin
        .from('workspace_memberships')
        .insert({ workspace_id: aliceWorkspaceId, user_id: bob.id, role: 'owner' })
        .select('id')
        .single()

      expect(insertError).toBeNull()

      const membership = await ownedWorkspace(alice.id)
      const { error } = await admin
        .from('workspace_memberships')
        .update({ role: 'admin' })
        .eq('id', membership.id)

      expect(error).toBeNull()

      // Restore: Alice is an owner again, Bob is out.
      await admin
        .from('workspace_memberships')
        .update({ role: 'owner' })
        .eq('id', membership.id)
      await admin.from('workspace_memberships').delete().eq('id', extra!.id)
    })
  })

  // -------------------------------------------------------------------------
  // redeem_workspace_invitation
  // -------------------------------------------------------------------------

  describe('invitation redemption', () => {
    async function invite(
      email: string,
      overrides: { expiresAt?: string; workspaceId?: string } = {},
    ) {
      const { token, tokenHash } = createInvitationToken()
      const { error } = await adminClient().from('workspace_invitations').insert({
        workspace_id: overrides.workspaceId ?? aliceWorkspaceId,
        email: email.toLowerCase(),
        role: 'setter',
        token_hash: tokenHash,
        expires_at: overrides.expiresAt ?? new Date(Date.now() + 86_400_000).toISOString(),
      })
      if (error) throw new Error(`invite failed: ${error.message}`)
      return { token, tokenHash }
    }

    async function redeem(tokenHash: string, userId: string, memberLimit?: number) {
      const { data, error } = await adminClient().rpc('redeem_workspace_invitation', {
        p_token_hash: tokenHash,
        p_user_id: userId,
        ...(memberLimit === undefined ? {} : { p_member_limit: memberLimit }),
      })
      if (error) throw new Error(`redeem failed: ${error.message}`)
      return data
    }

    afterAll(async () => {
      const admin = adminClient()
      await admin.from('workspace_invitations').delete().eq('workspace_id', aliceWorkspaceId)
      await admin
        .from('workspace_memberships')
        .delete()
        .eq('workspace_id', aliceWorkspaceId)
        .eq('user_id', bob.id)
    })

    it('reports an unknown token as invalid', async () => {
      const { tokenHash } = createInvitationToken()
      expect(await redeem(tokenHash, bob.id)).toBe('invalid')
    })

    it('refuses a recipient whose email does not match', async () => {
      // Without this, a forwarded link would let anyone holding it join —
      // exactly the failure hashing the token was meant to prevent.
      const { tokenHash } = await invite('someone-else@example.com')
      expect(await redeem(tokenHash, bob.id)).toBe('wrong_email')

      const { count } = await adminClient()
        .from('workspace_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', aliceWorkspaceId)
        .eq('user_id', bob.id)
      expect(count).toBe(0)
    })

    it('refuses an expired invitation', async () => {
      const { tokenHash } = await invite(bob.email, {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      })
      expect(await redeem(tokenHash, bob.id)).toBe('unavailable')
      await adminClient().from('workspace_invitations').delete().eq('token_hash', tokenHash)
    })

    it('refuses a revoked invitation', async () => {
      const { tokenHash } = await invite(bob.email)
      await adminClient()
        .from('workspace_invitations')
        .update({ revoked_at: new Date().toISOString() })
        .eq('token_hash', tokenHash)

      expect(await redeem(tokenHash, bob.id)).toBe('unavailable')
      await adminClient().from('workspace_invitations').delete().eq('token_hash', tokenHash)
    })

    it('refuses when the workspace has no seat left', async () => {
      const { tokenHash } = await invite(bob.email)
      // Alice alone already fills a one-seat plan.
      expect(await redeem(tokenHash, bob.id, 1)).toBe('seat_limit')
      await adminClient().from('workspace_invitations').delete().eq('token_hash', tokenHash)
    })

    it('adds the member with the invited role when everything checks out', async () => {
      const { tokenHash } = await invite(bob.email)
      expect(await redeem(tokenHash, bob.id, 5)).toBe('ok')

      const { data } = await adminClient()
        .from('workspace_memberships')
        .select('role')
        .eq('workspace_id', aliceWorkspaceId)
        .eq('user_id', bob.id)
        .single()

      expect(data?.role).toBe('setter')
    })

    it('is idempotent — a second click does not error or change the role', async () => {
      const { tokenHash } = await invite(bob.email)
      expect(await redeem(tokenHash, bob.id, 5)).toBe('already_member')

      const { data } = await adminClient()
        .from('workspace_memberships')
        .select('role')
        .eq('workspace_id', aliceWorkspaceId)
        .eq('user_id', bob.id)
        .single()

      // Still a setter: re-clicking must never silently re-grant a role.
      expect(data?.role).toBe('setter')
    })

    it('burns the invitation, so the same link cannot seat a second person', async () => {
      const { tokenHash } = await invite(bob.email)
      expect(await redeem(tokenHash, bob.id, 5)).toBe('already_member')
      // Now accepted; a fresh caller must find nothing usable.
      expect(await redeem(tokenHash, alice.id)).toBe('unavailable')
    })

    it('cannot be created granting ownership', async () => {
      const { tokenHash } = createInvitationToken()
      const { error } = await adminClient().from('workspace_invitations').insert({
        workspace_id: aliceWorkspaceId,
        email: bob.email.toLowerCase(),
        role: 'owner',
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/role_not_owner/i)
    })

    it('rejects an email that was not lowercased before storage', async () => {
      const { tokenHash } = createInvitationToken()
      const { error } = await adminClient().from('workspace_invitations').insert({
        workspace_id: aliceWorkspaceId,
        email: 'Mixed@Example.com',
        role: 'setter',
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      })

      // The CHECK constraint makes a caller that forgets to normalise fail
      // loudly, rather than quietly creating a second live invite.
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/email_lowercase/i)
    })
  })
})
