/**
 * Handing over a departing member's book — R3.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE BUG THIS FIXES WAS SILENT.                                          ║
 * ║                                                                           ║
 * ║  Removing a member deleted the membership and nothing else. Everything    ║
 * ║  they owned kept pointing at a user who was no longer in the workspace,   ║
 * ║  so it appeared in NOBODY's "assigned to me". Nothing errored; the work   ║
 * ║  just stopped being done by anyone.                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  countOwnedRecords,
  handoverTotal,
  reassignMemberRecords,
} from '@/lib/workspaces/handover'
import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv } from './helpers'

const RUN = Date.now().toString(36)

let leaver: Awaited<ReturnType<typeof createAuthUser>> | null = null
let successor: Awaited<ReturnType<typeof createAuthUser>> | null = null
let outsider: Awaited<ReturnType<typeof createAuthUser>> | null = null
let workspaceId = ''

beforeAll(async () => {
  if (!hasSupabaseEnv) return
  const db = adminClient()

  leaver = await createAuthUser(`leaver-${RUN}`)
  successor = await createAuthUser(`successor-${RUN}`)
  outsider = await createAuthUser(`outsider-${RUN}`)

  const { data } = await db
    .from('workspace_memberships')
    .select('workspace_id')
    .eq('user_id', leaver.id)
    .single()
  workspaceId = data!.workspace_id

  // The successor joins the leaver's workspace.
  await db.from('workspace_memberships').insert({
    workspace_id: workspaceId,
    user_id: successor.id,
    role: 'manager',
  })

  await db.from('crm_contacts').insert([
    { workspace_id: workspaceId, full_name: `Owned A ${RUN}`, owner_user_id: leaver.id },
    { workspace_id: workspaceId, full_name: `Owned B ${RUN}`, owner_user_id: leaver.id },
  ])
  await db.from('crm_tasks').insert([
    {
      workspace_id: workspaceId,
      title: `Open task ${RUN}`,
      assigned_to_user_id: leaver.id,
      status: 'open',
    },
    {
      workspace_id: workspaceId,
      title: `Done task ${RUN}`,
      assigned_to_user_id: leaver.id,
      status: 'completed',
      completed_at: new Date().toISOString(),
    },
  ])
}, 120_000)

afterAll(async () => {
  if (!leaver) return
  await adminClient().from('workspaces').delete().eq('id', workspaceId)
  for (const user of [leaver, successor, outsider]) {
    if (user) await deleteTestUser(user.id)
  }
})

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('counting what a member owns', () => {
  it('reports their book before anyone decides what to do with it', async () => {
    const owned = await countOwnedRecords(workspaceId, leaver!.id)

    expect(owned.contacts).toBe(2)
    // ⚠️ OPEN TASKS ONLY. A completed task records who completed it.
    expect(owned.tasks).toBe(1)
    expect(handoverTotal(owned)).toBeGreaterThanOrEqual(3)
  }, 60_000)
})

describeIf('reassigning to another member', () => {
  it('refuses a destination who is not in the workspace', async () => {
    /*
     * ⚠️ THE CHECK THAT MATTERS MOST. The id comes from a form and the service
     * role bypasses RLS, so without it a crafted request could hand a
     * workspace's entire book of business to an outsider — who would then own
     * it legitimately.
     */
    await expect(
      reassignMemberRecords(workspaceId, leaver!.id, outsider!.id),
    ).rejects.toThrow(/not in this workspace/)

    // And nothing moved on the way to being refused.
    const stillOwned = await countOwnedRecords(workspaceId, leaver!.id)
    expect(stillOwned.contacts).toBe(2)
  }, 60_000)

  it('moves contacts and OPEN tasks, and leaves completed ones alone', async () => {
    const result = await reassignMemberRecords(workspaceId, leaver!.id, successor!.id)

    expect(result.contacts).toBe(2)
    expect(result.tasks).toBe(1)

    const before = await countOwnedRecords(workspaceId, leaver!.id)
    expect(before.contacts).toBe(0)
    expect(before.tasks).toBe(0)

    const after = await countOwnedRecords(workspaceId, successor!.id)
    expect(after.contacts).toBe(2)

    /*
     * ⚠️ THE COMPLETED TASK STILL BELONGS TO WHOEVER DID IT. Moving it would
     * rewrite history and credit the successor for finished work they had no
     * part in.
     */
    const { data: doneTask } = await adminClient()
      .from('crm_tasks')
      .select('assigned_to_user_id')
      .eq('workspace_id', workspaceId)
      .eq('title', `Done task ${RUN}`)
      .single()

    expect(doneTask!.assigned_to_user_id).toBe(leaver!.id)
  }, 60_000)
})

describeIf('reassigning to nobody', () => {
  it('unassigns explicitly rather than refusing when there is no successor', async () => {
    // Put one back on the successor so there is something to unassign.
    await adminClient()
      .from('crm_contacts')
      .update({ owner_user_id: successor!.id })
      .eq('workspace_id', workspaceId)

    const result = await reassignMemberRecords(workspaceId, successor!.id, null)
    expect(result.contacts).toBeGreaterThan(0)

    /*
     * An explicitly unassigned record is findable and can be picked up. A
     * record owned by a non-member is not — which is the whole difference
     * this phase exists to make.
     */
    const { data: orphans } = await adminClient()
      .from('crm_contacts')
      .select('id, owner_user_id')
      .eq('workspace_id', workspaceId)

    for (const row of orphans ?? []) expect(row.owner_user_id).toBeNull()
  }, 60_000)
})
