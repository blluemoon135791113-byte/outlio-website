/**
 * CRM operations — M2 Phase 5.
 *
 * M2 ACCEPTANCE CRITERION 5: "Activity rows are immutable (no update path
 * exposed)."
 * M2 ACCEPTANCE CRITERION 6: "GDPR erasure removes contact + PII cascade,
 * verified by test."
 *
 * The claim underneath both is that attribution is FROZEN: reassigning a book
 * must not move last quarter's numbers. That can only be shown by reassigning
 * one and looking.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  addNote,
  assignContact,
  completeTask,
  createTask,
  eraseContact,
  listContactTimeline,
  listOpenTasks,
  markNotificationsRead,
  notify,
  recordActivity,
  recordAudit,
} from '@/lib/crm/activities'
import { upsertContact } from '@/lib/crm/repository'
import {
  adminClient,
  createAuthUser,
  deleteTestUser,
  hasSupabaseEnv,
  type TestAuthUser,
} from './helpers'

const describeIf = hasSupabaseEnv ? describe : describe.skip

const RUN = Date.now().toString(36)

async function workspaceOf(userId: string): Promise<string> {
  const { data, error } = await adminClient()
    .from('workspace_memberships')
    .select('workspace_id')
    .eq('user_id', userId)
    .single()
  if (error) throw new Error(`workspaceOf failed: ${error.message}`)
  return data.workspace_id
}

describeIf('CRM operations', () => {
  let owner: TestAuthUser
  let setter: TestAuthUser
  let ws: string
  let contactId: string

  beforeAll(async () => {
    owner = await createAuthUser('ops-owner')
    setter = await createAuthUser('ops-setter')
    ws = await workspaceOf(owner.id)

    contactId = (
      await upsertContact(ws, {
        fullName: 'Ops Subject',
        emails: [`ops-${RUN}@example.com`],
        ownerUserId: setter.id,
      })
    ).id
  })

  afterAll(async () => {
    if (owner) await deleteTestUser(owner.id)
    if (setter) await deleteTestUser(setter.id)
  })

  // -------------------------------------------------------------------------
  // Attribution
  // -------------------------------------------------------------------------

  describe('attribution is frozen at event time', () => {
    let activityId: string

    it('captures the owner at write time', async () => {
      activityId = await recordActivity(ws, {
        contactId,
        activityType: 'OPENER_SENT',
        channel: 'linkedin',
        actorUserId: setter.id,
      })

      const { data } = await adminClient()
        .from('crm_activities')
        .select('actor_user_id, owner_user_id_at_event, team_id_at_event')
        .eq('id', activityId)
        .single()

      expect(data?.actor_user_id).toBe(setter.id)
      expect(data?.owner_user_id_at_event).toBe(setter.id)
      // Reserved for Teams (DR1) and unused until M4.
      expect(data?.team_id_at_event).toBeNull()
    })

    it('SURVIVES REASSIGNMENT', async () => {
      // The whole reason the column exists. Reassigning a book must not
      // rewrite who did last quarter's work.
      await assignContact(ws, contactId, owner.id, owner.id)

      const { data: contact } = await adminClient()
        .from('crm_contacts')
        .select('owner_user_id')
        .eq('id', contactId)
        .single()
      expect(contact?.owner_user_id).toBe(owner.id)

      const { data: activity } = await adminClient()
        .from('crm_activities')
        .select('owner_user_id_at_event')
        .eq('id', activityId)
        .single()
      expect(activity?.owner_user_id_at_event).toBe(setter.id)
    })

    it('credits the handover to the owner it left, not the one receiving', async () => {
      const { data } = await adminClient()
        .from('crm_activities')
        .select('owner_user_id_at_event, actor_user_id, metadata')
        .eq('workspace_id', ws)
        .eq('contact_id', contactId)
        .eq('activity_type', 'OWNER_ASSIGNED')
        .single()

      expect(data?.owner_user_id_at_event).toBe(setter.id)
      expect(data?.actor_user_id).toBe(owner.id)
      expect(data?.metadata).toMatchObject({ from: setter.id, to: owner.id })
    })

    it('does not record an event when the owner is unchanged', async () => {
      await assignContact(ws, contactId, owner.id, owner.id)

      const { count } = await adminClient()
        .from('crm_activities')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws)
        .eq('contact_id', contactId)
        .eq('activity_type', 'OWNER_ASSIGNED')

      expect(count).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // Acceptance criterion 5
  // -------------------------------------------------------------------------

  describe('activities are immutable', () => {
    it('refuses an UPDATE even from the service role', async () => {
      const { error } = await adminClient()
        .from('crm_activities')
        .update({ channel: 'email' })
        .eq('workspace_id', ws)
        .eq('contact_id', contactId)

      // The service role bypasses RLS, so the trigger is what stops this —
      // which is exactly why the rule lives in the database.
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/append-only/i)
    })

    it('refuses a DELETE even from the service role', async () => {
      const { error } = await adminClient()
        .from('crm_activities')
        .delete()
        .eq('workspace_id', ws)
        .eq('contact_id', contactId)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/append-only/i)
    })

    it('leaves the rows untouched after both attempts', async () => {
      const timeline = await listContactTimeline(ws, contactId)
      expect(timeline.length).toBeGreaterThan(0)
      expect(timeline.every((e) => e.channel !== 'email')).toBe(true)
    })

    it('refuses to rewrite merge history too', async () => {
      // ⚠️ A row must EXIST first. An UPDATE matching nothing fires no
      // row-level trigger and returns no error, so without this the test would
      // pass whether or not the guard were there at all.
      const { error: insertError } = await adminClient().from('crm_merge_events').insert({
        workspace_id: ws,
        entity: 'contact',
        surviving_id: contactId,
        merged_id: '00000000-0000-4000-8000-0000000000ff',
        snapshot: { probe: true },
      })
      expect(insertError).toBeNull()

      // 0074 declared crm_merge_events append-only on grants alone; 0075 made
      // it true.
      const { error } = await adminClient()
        .from('crm_merge_events')
        .update({ snapshot: {} })
        .eq('workspace_id', ws)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/append-only/i)
    })

    it('returns the timeline newest first', async () => {
      const timeline = await listContactTimeline(ws, contactId)
      const times = timeline.map((e) => new Date(e.occurredAt).getTime())
      expect([...times].sort((a, b) => b - a)).toEqual(times)
    })
  })

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  describe('tasks', () => {
    let taskId: string

    it('creates and lists an open task', async () => {
      taskId = await createTask(
        ws,
        {
          contactId,
          title: 'Follow up',
          dueAt: new Date(Date.now() + 86_400_000),
          assignedToUserId: setter.id,
        },
        owner.id,
      )

      const open = await listOpenTasks(ws, setter.id)
      expect(open.map((t) => t.id)).toContain(taskId)
    })

    it('records exactly one activity when completed', async () => {
      expect(await completeTask(ws, taskId, setter.id)).toBe(true)

      // Completing twice must not write a second event: task completions are a
      // dashboard metric and a double-click cannot be allowed to inflate it.
      expect(await completeTask(ws, taskId, setter.id)).toBe(false)

      const { count } = await adminClient()
        .from('crm_activities')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws)
        .eq('activity_type', 'TASK_COMPLETED')
        .eq('refs->>task_id', taskId)

      expect(count).toBe(1)
    })

    it('drops the completed task off the open list', async () => {
      const open = await listOpenTasks(ws, setter.id)
      expect(open.map((t) => t.id)).not.toContain(taskId)
    })
  })

  // -------------------------------------------------------------------------
  // Notes, mentions, notifications
  // -------------------------------------------------------------------------

  describe('notes and notifications', () => {
    it('notifies the person mentioned, and records the note', async () => {
      await addNote(
        ws,
        { contactId, body: 'Spoke to them today', mentionedUserIds: [setter.id] },
        owner.id,
      )

      const { data } = await adminClient()
        .from('crm_notifications')
        .select('kind, title, user_id, read_at')
        .eq('workspace_id', ws)
        .eq('user_id', setter.id)
        .eq('kind', 'crm.note.mention')

      expect(data).toHaveLength(1)
      expect(data?.[0]?.read_at).toBeNull()

      const timeline = await listContactTimeline(ws, contactId)
      expect(timeline.some((e) => e.activityType === 'NOTE_ADDED')).toBe(true)
    })

    it('does not notify you about your own mention', async () => {
      await addNote(ws, { contactId, body: 'Note to self', mentionedUserIds: [owner.id] }, owner.id)

      const { count } = await adminClient()
        .from('crm_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws)
        .eq('user_id', owner.id)
        .eq('kind', 'crm.note.mention')

      expect(count).toBe(0)
    })

    it('respects a switched-off preference', async () => {
      await adminClient().from('crm_notification_preferences').insert({
        workspace_id: ws,
        user_id: setter.id,
        kind: 'crm.muted.kind',
        in_app: false,
      })

      expect(
        await notify(ws, [setter.id], { kind: 'crm.muted.kind', title: 'Should not arrive' }),
      ).toBe(0)
    })

    it('delivers a kind with no preference row, so a new kind needs no backfill', async () => {
      expect(
        await notify(ws, [setter.id], { kind: 'crm.brand.new', title: 'Arrives by default' }),
      ).toBe(1)
    })

    it('marks notifications read for one person only', async () => {
      await markNotificationsRead(ws, setter.id)

      const { count } = await adminClient()
        .from('crm_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws)
        .eq('user_id', setter.id)
        .is('read_at', null)

      expect(count).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Acceptance criterion 6
  // -------------------------------------------------------------------------

  describe('GDPR erasure', () => {
    let victimId: string

    beforeAll(async () => {
      victimId = (
        await upsertContact(ws, {
          fullName: 'Erasure Subject',
          emails: [`erase-${RUN}@example.com`],
          phones: ['+1 415 555 0133'],
          ownerUserId: setter.id,
        })
      ).id

      await recordActivity(ws, {
        contactId: victimId,
        activityType: 'ENGAGEMENT',
        channel: 'linkedin',
        actorUserId: setter.id,
      })
      await createTask(ws, { contactId: victimId, title: 'Call them' }, owner.id)
      await addNote(ws, { contactId: victimId, body: 'Private detail' }, owner.id)
      await notify(ws, [owner.id], {
        kind: 'crm.reply',
        title: 'They replied',
        refs: { contact_id: victimId },
      })
    })

    it('removes the contact and every trace of the person', async () => {
      const removed = await eraseContact(ws, victimId, owner.id, 'test erasure')

      expect(removed.activities).toBeGreaterThan(0)
      expect(removed.notes).toBeGreaterThan(0)
      expect(removed.tasks).toBeGreaterThan(0)
      expect(removed.notifications).toBeGreaterThan(0)

      const counts = await Promise.all([
        count('crm_contacts', 'id', victimId),
        count('crm_contact_emails', 'contact_id', victimId),
        count('crm_contact_phones', 'contact_id', victimId),
        count('crm_activities', 'contact_id', victimId),
        count('crm_notes', 'contact_id', victimId),
        count('crm_tasks', 'contact_id', victimId),
      ])

      expect(counts).toEqual([0, 0, 0, 0, 0, 0])
    })

    it('erases activities despite the append-only guard', async () => {
      // The right to erasure outranks our audit convenience. The guard stands
      // down only inside this function's transaction.
      expect(await count('crm_activities', 'contact_id', victimId)).toBe(0)
    })

    it('leaves proof that the erasure happened, carrying no personal data', async () => {
      const { data } = await adminClient()
        .from('crm_audit_logs')
        .select('action, target_id, after_state, reason')
        .eq('workspace_id', ws)
        .eq('action', 'crm.contact.erased')
        .single()

      expect(data?.target_id).toBe(victimId)
      expect(data?.reason).toBe('test erasure')
      // Counts only — nothing about the person.
      expect(JSON.stringify(data?.after_state)).not.toContain('Erasure Subject')
      expect(JSON.stringify(data)).not.toContain(`erase-${RUN}@example.com`)
    })

    it('puts the guard back up afterwards', async () => {
      const { error } = await adminClient()
        .from('crm_activities')
        .delete()
        .eq('workspace_id', ws)
        .eq('contact_id', contactId)

      expect(error?.message).toMatch(/append-only/i)
    })

    it('refuses to erase a contact from another workspace', async () => {
      await expect(
        eraseContact('00000000-0000-4000-8000-000000000000', contactId, owner.id),
      ).rejects.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  describe('workspace audit log', () => {
    it('records an entry and refuses to let it be rewritten', async () => {
      await recordAudit(ws, {
        action: 'crm.contact.exported',
        targetType: 'crm_contact',
        targetId: contactId,
        actorUserId: owner.id,
      })

      const { error } = await adminClient()
        .from('crm_audit_logs')
        .update({ reason: 'rewritten' })
        .eq('workspace_id', ws)
        .eq('action', 'crm.contact.exported')

      expect(error?.message).toMatch(/append-only/i)
    })
  })

  async function count(
    table: 'crm_contacts' | 'crm_contact_emails' | 'crm_contact_phones' | 'crm_activities' | 'crm_notes' | 'crm_tasks',
    column: string,
    value: string,
  ): Promise<number> {
    const { count: n, error } = await adminClient()
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(column, value)

    if (error) throw new Error(`count(${table}) failed: ${error.message}`)
    return n ?? 0
  }
})
