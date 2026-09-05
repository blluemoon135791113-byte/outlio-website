import 'server-only'

/**
 * The CRM event stream, tasks, notes and notifications (M2 Phase 5).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ATTRIBUTION IS CAPTURED AT WRITE TIME, NOT AT READ TIME.                ║
 * ║                                                                          ║
 * ║  `recordActivity` looks up who owns the contact NOW and stores that as   ║
 * ║  `owner_user_id_at_event`. Every report then reads the stored value.     ║
 * ║                                                                          ║
 * ║  ⚠️ NEVER join an activity to `crm_contacts.owner_user_id` in a report.   ║
 * ║  That is the CURRENT owner, so reassigning a setter's book on Monday     ║
 * ║  would silently rewrite last quarter's numbers.                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THERE IS NO UPDATE OR DELETE HERE, AND THERE CANNOT BE. `crm_activities`
 * refuses both at the database (migration 0075). If a recorded event is wrong,
 * the answer is a corrective event, not an edit.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database, Json } from '@/types/database'

export type ActivityType = Database['public']['Enums']['crm_activity_type']
export type ActivityChannel = Database['public']['Enums']['crm_activity_channel']
export type TaskStatus = Database['public']['Enums']['crm_task_status']

export type RecordActivityInput = {
  contactId?: string | null
  companyId?: string | null
  activityType: ActivityType
  channel: ActivityChannel
  /** Who did it. `null` for something the platform did on its own. */
  actorUserId?: string | null
  /**
   * Override the owner frozen onto the event.
   *
   * Only for INGESTED HISTORY, where the owner at the time is known and is not
   * whoever owns the record now. Leave it unset for anything happening live.
   */
  ownerUserIdAtEvent?: string | null
  /** When it HAPPENED. Defaults to now; backdated for imported history. */
  occurredAt?: Date | string | null
  refs?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

/**
 * Appends one event.
 *
 * The owner is resolved here, once, rather than left to the reader. That single
 * lookup is the whole mechanism by which attribution survives reassignment.
 */
export async function recordActivity(
  workspaceId: string,
  input: RecordActivityInput,
): Promise<string> {
  const db = createAdminClient()

  let ownerAtEvent = input.ownerUserIdAtEvent ?? null
  if (ownerAtEvent === null && input.contactId) {
    const { data, error } = await db
      .from('crm_contacts')
      .select('owner_user_id')
      .eq('workspace_id', workspaceId)
      .eq('id', input.contactId)
      .maybeSingle()

    if (error) throw new Error(`recordActivity failed: ${error.message}`)
    ownerAtEvent = data?.owner_user_id ?? null
  }

  const { data, error } = await db
    .from('crm_activities')
    .insert({
      workspace_id: workspaceId,
      contact_id: input.contactId ?? null,
      company_id: input.companyId ?? null,
      activity_type: input.activityType,
      channel: input.channel,
      actor_user_id: input.actorUserId ?? null,
      owner_user_id_at_event: ownerAtEvent,
      occurred_at: toIso(input.occurredAt) ?? new Date().toISOString(),
      refs: (input.refs ?? {}) as Json,
      metadata: (input.metadata ?? {}) as Json,
    })
    .select('id')
    .single()

  if (error) throw new Error(`recordActivity failed: ${error.message}`)
  return data.id
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

export type TimelineEntry = {
  id: string
  activityType: ActivityType
  channel: ActivityChannel
  actorUserId: string | null
  ownerUserIdAtEvent: string | null
  occurredAt: string
  metadata: Record<string, unknown>
}

/** One contact's timeline, newest first. Always paginated. */
export async function listContactTimeline(
  workspaceId: string,
  contactId: string,
  options: { limit?: number; before?: string } = {},
): Promise<TimelineEntry[]> {
  const limit = Math.min(options.limit ?? 50, 200)

  let query = createAdminClient()
    .from('crm_activities')
    .select('id, activity_type, channel, actor_user_id, owner_user_id_at_event, occurred_at, metadata')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)

  // Keyset, not OFFSET: a timeline grows at the head, so an offset page shifts
  // under the reader as new events land.
  if (options.before) query = query.lt('occurred_at', options.before)

  const { data, error } = await query.order('occurred_at', { ascending: false }).limit(limit)

  if (error) throw new Error(`listContactTimeline failed: ${error.message}`)

  return (data ?? []).map((row) => ({
    id: row.id,
    activityType: row.activity_type,
    channel: row.channel,
    actorUserId: row.actor_user_id,
    ownerUserIdAtEvent: row.owner_user_id_at_event,
    occurredAt: row.occurred_at,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  }))
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/**
 * Assigns a contact, recording the change as an event.
 *
 * ⚠️ THE ACTIVITY IS WRITTEN BEFORE THE OWNER CHANGES, deliberately. The event
 * belongs to the owner it is leaving; recording it afterwards would credit the
 * handover to the person receiving the book.
 *
 * There is no separate `assignment_events` table — see Ledger D23. All metrics
 * derive from this one stream.
 */
export async function assignContact(
  workspaceId: string,
  contactId: string,
  newOwnerUserId: string | null,
  actorUserId: string | null = null,
): Promise<void> {
  const db = createAdminClient()

  const { data: current, error: readError } = await db
    .from('crm_contacts')
    .select('owner_user_id')
    .eq('workspace_id', workspaceId)
    .eq('id', contactId)
    .maybeSingle()

  if (readError) throw new Error(`assignContact failed: ${readError.message}`)
  if (!current) throw new Error('assignContact: no such contact in this workspace')
  if (current.owner_user_id === newOwnerUserId) return

  await recordActivity(workspaceId, {
    contactId,
    activityType: 'OWNER_ASSIGNED',
    channel: 'system',
    actorUserId,
    ownerUserIdAtEvent: current.owner_user_id,
    metadata: { from: current.owner_user_id, to: newOwnerUserId },
  })

  const { error } = await db
    .from('crm_contacts')
    .update({ owner_user_id: newOwnerUserId })
    .eq('workspace_id', workspaceId)
    .eq('id', contactId)

  if (error) throw new Error(`assignContact failed: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type CreateTaskInput = {
  contactId?: string | null
  companyId?: string | null
  title: string
  body?: string | null
  dueAt?: Date | string | null
  assignedToUserId?: string | null
}

export async function createTask(
  workspaceId: string,
  input: CreateTaskInput,
  actorUserId: string | null = null,
): Promise<string> {
  const { data, error } = await createAdminClient()
    .from('crm_tasks')
    .insert({
      workspace_id: workspaceId,
      contact_id: input.contactId ?? null,
      company_id: input.companyId ?? null,
      title: input.title.trim(),
      body: input.body?.trim() || null,
      due_at: toIso(input.dueAt),
      assigned_to_user_id: input.assignedToUserId ?? null,
      created_by: actorUserId,
    })
    .select('id')
    .single()

  if (error) throw new Error(`createTask failed: ${error.message}`)
  return data.id
}

/**
 * Completes a task and records it.
 *
 * Guarded by `status = 'open'` so completing twice writes ONE event. Task
 * completions are a setter dashboard metric, and a double-click must not
 * inflate it.
 */
export async function completeTask(
  workspaceId: string,
  taskId: string,
  actorUserId: string | null = null,
): Promise<boolean> {
  const db = createAdminClient()

  const { data, error } = await db
    .from('crm_tasks')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_by: actorUserId,
    })
    .eq('workspace_id', workspaceId)
    .eq('id', taskId)
    .eq('status', 'open')
    .select('id, contact_id')
    .maybeSingle()

  if (error) throw new Error(`completeTask failed: ${error.message}`)
  if (!data) return false

  await recordActivity(workspaceId, {
    contactId: data.contact_id,
    activityType: 'TASK_COMPLETED',
    channel: 'system',
    actorUserId,
    refs: { task_id: taskId },
  })

  return true
}

/** A person's open tasks, soonest due first. Undated ones sort last. */
export async function listOpenTasks(
  workspaceId: string,
  assignedToUserId: string,
  limit = 50,
): Promise<{ id: string; title: string; dueAt: string | null; contactId: string | null }[]> {
  const { data, error } = await createAdminClient()
    .from('crm_tasks')
    .select('id, title, due_at, contact_id')
    .eq('workspace_id', workspaceId)
    .eq('assigned_to_user_id', assignedToUserId)
    .eq('status', 'open')
    .is('deleted_at', null)
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(Math.min(limit, 200))

  if (error) throw new Error(`listOpenTasks failed: ${error.message}`)

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    dueAt: row.due_at,
    contactId: row.contact_id,
  }))
}

// ---------------------------------------------------------------------------
// Notes, mentions and notifications
// ---------------------------------------------------------------------------

/**
 * Adds a note, records it, and notifies anyone mentioned.
 *
 * A mention is the point of a note in a shared workspace, so notification is
 * part of writing one rather than a separate call a caller can forget.
 * Mentioning yourself notifies nobody.
 */
export async function addNote(
  workspaceId: string,
  input: {
    contactId?: string | null
    companyId?: string | null
    body: string
    mentionedUserIds?: string[]
  },
  actorUserId: string | null = null,
): Promise<string> {
  const db = createAdminClient()

  const { data, error } = await db
    .from('crm_notes')
    .insert({
      workspace_id: workspaceId,
      contact_id: input.contactId ?? null,
      company_id: input.companyId ?? null,
      body: input.body.trim(),
      created_by: actorUserId,
    })
    .select('id')
    .single()

  if (error) throw new Error(`addNote failed: ${error.message}`)

  await recordActivity(workspaceId, {
    contactId: input.contactId,
    companyId: input.companyId,
    activityType: 'NOTE_ADDED',
    channel: 'manual',
    actorUserId,
    refs: { note_id: data.id },
  })

  const mentioned = [...new Set(input.mentionedUserIds ?? [])].filter(
    (id) => id !== actorUserId,
  )
  if (mentioned.length === 0) return data.id

  const { error: mentionError } = await db.from('crm_note_mentions').insert(
    mentioned.map((userId) => ({
      workspace_id: workspaceId,
      note_id: data.id,
      mentioned_user_id: userId,
    })),
  )
  if (mentionError) throw new Error(`addNote failed: ${mentionError.message}`)

  await notify(workspaceId, mentioned, {
    kind: 'crm.note.mention',
    title: 'You were mentioned in a note',
    refs: { note_id: data.id, contact_id: input.contactId ?? null },
  })

  return data.id
}

/**
 * Sends an in-app notification, respecting each recipient's preferences.
 *
 * A preference row means "switched off". Its ABSENCE means the default, so a
 * new notification kind reaches everyone without backfilling a row per user
 * per kind.
 */
export async function notify(
  workspaceId: string,
  userIds: string[],
  notification: {
    kind: string
    title: string
    body?: string | null
    refs?: Record<string, unknown>
  },
): Promise<number> {
  const recipients = [...new Set(userIds)]
  if (recipients.length === 0) return 0

  const db = createAdminClient()

  const { data: muted, error: prefError } = await db
    .from('crm_notification_preferences')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('kind', notification.kind)
    .eq('in_app', false)
    .in('user_id', recipients)

  if (prefError) throw new Error(`notify failed: ${prefError.message}`)

  const silenced = new Set((muted ?? []).map((row) => row.user_id))
  const wanted = recipients.filter((id) => !silenced.has(id))
  if (wanted.length === 0) return 0

  const { error } = await db.from('crm_notifications').insert(
    wanted.map((userId) => ({
      workspace_id: workspaceId,
      user_id: userId,
      kind: notification.kind,
      title: notification.title,
      body: notification.body ?? null,
      refs: (notification.refs ?? {}) as Json,
    })),
  )

  if (error) throw new Error(`notify failed: ${error.message}`)
  return wanted.length
}

export async function markNotificationsRead(
  workspaceId: string,
  userId: string,
  notificationIds?: string[],
): Promise<void> {
  const db = createAdminClient()
  let query = db
    .from('crm_notifications')
    .update({ read_at: new Date().toISOString() })
    // Scoped by user_id as well as workspace: a notification is addressed to
    // one person, and marking someone else's as read is not ours to do.
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .is('read_at', null)

  if (notificationIds?.length) query = query.in('id', notificationIds)

  const { error } = await query
  if (error) throw new Error(`markNotificationsRead failed: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Audit and erasure
// ---------------------------------------------------------------------------

export async function recordAudit(
  workspaceId: string,
  entry: {
    action: string
    targetType: string
    targetId?: string | null
    actorUserId?: string | null
    before?: unknown
    after?: unknown
    reason?: string | null
  },
): Promise<void> {
  const { error } = await createAdminClient().from('crm_audit_logs').insert({
    workspace_id: workspaceId,
    actor_user_id: entry.actorUserId ?? null,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId ?? null,
    before_state: (entry.before ?? null) as Json,
    after_state: (entry.after ?? null) as Json,
    reason: entry.reason ?? null,
  })

  if (error) throw new Error(`recordAudit failed: ${error.message}`)
}

export type ErasureResult = Record<string, number>

/**
 * Erases a contact under the right to erasure.
 *
 * ⚠️ IRREVERSIBLE, and the only hard delete in the CRM. Everything else soft
 * deletes. The caller must have confirmed this with a human — see
 * `crm_erase_contact` in 0075 for exactly what is destroyed and what survives.
 */
export async function eraseContact(
  workspaceId: string,
  contactId: string,
  actorUserId: string | null = null,
  reason?: string,
): Promise<ErasureResult> {
  const { data, error } = await createAdminClient().rpc('crm_erase_contact', {
    p_workspace_id: workspaceId,
    p_contact_id: contactId,
    ...(actorUserId === null ? {} : { p_actor_id: actorUserId }),
    ...(reason === undefined ? {} : { p_reason: reason }),
  })

  if (error) throw new Error(`eraseContact failed: ${error.message}`)
  return (data as unknown as ErasureResult) ?? {}
}
