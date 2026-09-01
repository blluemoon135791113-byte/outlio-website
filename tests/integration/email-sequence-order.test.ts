/**
 * Sequence step ordering — R12.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE COLLISION ONLY HAPPENS AGAINST THE REAL INDEX.                      ║
 * ║                                                                           ║
 * ║  `email_sequence_steps_order_idx` is UNIQUE on (campaign_id, step_index). ║
 * ║  A reorder that writes the new positions directly collides with the rows  ║
 * ║  not yet moved — and a unit test with a fake client would never see it,   ║
 * ║  because the constraint is the thing being tested.                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { renumberSteps, swapped, writeStepOrder } from '@/lib/email/sequence'
import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv } from './helpers'

const RUN = Date.now().toString(36)

let user: Awaited<ReturnType<typeof createAuthUser>> | null = null
let workspaceId = ''
let campaignId = ''
let accountId = ''

const subjects = ['First', 'Second', 'Third', 'Fourth']

async function currentOrder(): Promise<string[]> {
  const { data } = await adminClient()
    .from('email_sequence_steps')
    .select('subject, step_index')
    .eq('campaign_id', campaignId)
    .order('step_index')
  return (data ?? []).map((s) => s.subject)
}

async function indexes(): Promise<number[]> {
  const { data } = await adminClient()
    .from('email_sequence_steps')
    .select('step_index')
    .eq('campaign_id', campaignId)
    .order('step_index')
  return (data ?? []).map((s) => s.step_index)
}

beforeAll(async () => {
  if (!hasSupabaseEnv) return
  const db = adminClient()

  user = await createAuthUser(`seq-${RUN}`)
  const { data: membership } = await db
    .from('workspace_memberships')
    .select('workspace_id')
    .eq('user_id', user.id)
    .single()
  workspaceId = membership!.workspace_id

  const { data: account } = await db
    .from('email_accounts')
    .insert({
      workspace_id: workspaceId,
      provider: 'smtp',
      scope: 'workspace',
      owner_user_id: user.id,
      display_name: 'Sequence mailbox',
      from_email: `seq-${RUN}@acme.example`,
      from_domain: 'acme.example',
      status: 'ready',
      configuration: { smtpHost: 'localhost', smtpPort: 2525 },
    })
    .select('id')
    .single()
  accountId = account!.id

  const { data: campaign } = await db
    .from('email_campaigns')
    .insert({
      workspace_id: workspaceId,
      name: `Sequence ${RUN}`,
      type: 'sales_sequence',
      status: 'draft',
      account_id: accountId,
      created_by: user.id,
    })
    .select('id')
    .single()
  campaignId = campaign!.id

  await db.from('email_sequence_steps').insert(
    subjects.map((subject, index) => ({
      workspace_id: workspaceId,
      campaign_id: campaignId,
      step_index: index,
      subject,
      body_text: `Body for ${subject}`,
      wait_hours: index === 0 ? 0 : 72,
    })),
  )
}, 120_000)

afterAll(async () => {
  if (!user) return
  await adminClient().from('workspaces').delete().eq('id', workspaceId)
  await deleteTestUser(user.id)
})

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('swapping neighbours', () => {
  it('refuses to move past either end rather than wrapping around', () => {
    const items = ['a', 'b', 'c']
    expect(swapped(items, 0, 'up')).toBeNull()
    expect(swapped(items, 2, 'down')).toBeNull()
    expect(swapped(items, 0, 'down')).toEqual(['b', 'a', 'c'])
  })
})

describeIf('rewriting the order against a real unique index', () => {
  it('starts contiguous from zero', async () => {
    expect(await indexes()).toEqual([0, 1, 2, 3])
    expect(await currentOrder()).toEqual(subjects)
  }, 60_000)

  it('REVERSES the whole sequence without colliding on the unique index', async () => {
    /*
     * ⚠️ THE HARDEST CASE ON PURPOSE. Every row's new position is occupied by
     * another row that has not moved yet, so a naive single-pass update fails
     * on the very first write. This is what the park-then-settle pass exists
     * for.
     */
    const { data } = await adminClient()
      .from('email_sequence_steps')
      .select('id')
      .eq('campaign_id', campaignId)
      .order('step_index')

    const reversed = [...(data ?? [])].reverse().map((s) => s.id)
    await writeStepOrder(workspaceId, reversed)

    expect(await currentOrder()).toEqual([...subjects].reverse())
    // Still 0-based and contiguous — the walker depends on it.
    expect(await indexes()).toEqual([0, 1, 2, 3])
  }, 60_000)

  it('swaps two neighbours and leaves the rest alone', async () => {
    const before = await currentOrder()
    const { data } = await adminClient()
      .from('email_sequence_steps')
      .select('id')
      .eq('campaign_id', campaignId)
      .order('step_index')

    const ids = (data ?? []).map((s) => s.id)
    await writeStepOrder(workspaceId, swapped(ids, 0, 'down')!)

    const after = await currentOrder()
    expect(after[0]).toBe(before[1])
    expect(after[1]).toBe(before[0])
    expect(after[2]).toBe(before[2])
    expect(await indexes()).toEqual([0, 1, 2, 3])
  }, 60_000)
})

describeIf('closing a gap after a deletion', () => {
  it('renumbers so no hole is left for the walker to fall into', async () => {
    const { data } = await adminClient()
      .from('email_sequence_steps')
      .select('id, step_index')
      .eq('campaign_id', campaignId)
      .order('step_index')

    // Delete the MIDDLE one, which is what leaves a hole.
    const victim = (data ?? [])[1]!
    await adminClient().from('email_sequence_steps').delete().eq('id', victim.id)

    // The hole is real before the renumber.
    expect(await indexes()).toEqual([0, 2, 3])

    await renumberSteps(workspaceId, campaignId)

    /*
     * ⚠️ THE POINT OF THE WHOLE EXERCISE. The sequence walker asks for "the
     * step after N", so a gap at 1 would strand every enrolment that reached
     * step 0 — they would wait for a step that no longer exists.
     */
    expect(await indexes()).toEqual([0, 1, 2])
  }, 60_000)
})
