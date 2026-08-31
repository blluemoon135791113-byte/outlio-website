import 'server-only'

/**
 * The unified inbox — M8 Phase 26.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  M8 CRITERION 5: "inbox respects PERMISSIONS + PAGINATION; threads        ║
 * ║  RESOLVE CORRECTLY."                                                      ║
 * ║                                                                           ║
 * ║  All three live here rather than in the page, because a permission check  ║
 * ║  that lives in a component is one route away from being forgotten. The    ║
 * ║  page renders what this returns and decides nothing.                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { can, type PolicyInput } from '@/lib/workspaces/permissions'

export const INBOX_VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'mine', label: 'Mine' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'needs_reply', label: 'Needs reply' },
  { value: 'resolved', label: 'Resolved' },
] as const

export type InboxView = (typeof INBOX_VIEWS)[number]['value']

export function isInboxView(value: string): value is InboxView {
  return INBOX_VIEWS.some((v) => v.value === value)
}

export type InboxThread = {
  id: string
  subject: string | null
  contactId: string | null
  contactName: string | null
  assignedTo: string | null
  status: 'open' | 'resolved'
  lastMessageAt: string
  lastDirection: 'inbound' | 'outbound'
  messageCount: number
  isRead: boolean
  /** First line of the latest inbound message, for the list preview. */
  preview: string | null
}

export type InboxPage = {
  threads: InboxThread[]
  /**
   * Keyset cursor for the next page: `${lastMessageAt}|${id}`.
   *
   * ⚠️ KEYSET, NOT OFFSET. An inbox receives mail while someone is reading it,
   * and with OFFSET a new arrival shifts every later row down — so "next page"
   * silently re-shows a thread and hides another. Null when there are no more.
   */
  nextCursor: string | null
}

/**
 * ⚠️ THE PAGE SIZE IS ENFORCED HERE, not taken from the caller. The brief
 * forbids unbounded scans in a request path, and a `limit` parameter that a
 * route could pass through from a query string is not a limit.
 */
const PAGE_SIZE = 25

/**
 * Whether this member sees the whole workspace's mail or only their own.
 *
 * ⚠️ A SETTER SEES ONLY THREADS ASSIGNED TO THEM. That is the constitution's
 * "only assigned data" rule, and an inbox is where it matters most: the whole
 * point of a shared mailbox is that everyone's replies land in one place, so
 * without this a setter reads the entire company's conversations.
 */
export function seesAllThreads(policy: PolicyInput): boolean {
  return can(policy, 'email.inbox.view.all')
}

export async function listThreads(input: {
  workspaceId: string
  userId: string
  policy: PolicyInput
  view: InboxView
  cursor?: string | null
}): Promise<InboxPage> {
  const db = createAdminClient()

  // Scoped by workspace in code — the service role bypasses RLS.
  let query = db
    .from('email_threads')
    .select(
      'id, subject, contact_id, assigned_to, status, last_message_at, last_direction, message_count, read_at, crm_contacts(full_name)',
    )
    .eq('workspace_id', input.workspaceId)
    .order('last_message_at', { ascending: false })
    .order('id', { ascending: false })
    // One extra row tells us whether another page exists without a count query.
    .limit(PAGE_SIZE + 1)

  if (!seesAllThreads(input.policy)) {
    query = query.eq('assigned_to', input.userId)
  }

  switch (input.view) {
    case 'unread':
      query = query.is('read_at', null).eq('status', 'open')
      break
    case 'mine':
      query = query.eq('assigned_to', input.userId).eq('status', 'open')
      break
    case 'unassigned':
      query = query.is('assigned_to', null).eq('status', 'open')
      break
    case 'needs_reply':
      /*
       * The last message came IN and nobody has answered. Reading the
       * denormalised column rather than the message table is what keeps this
       * a single indexed scan.
       */
      query = query.eq('last_direction', 'inbound').eq('status', 'open')
      break
    case 'resolved':
      query = query.eq('status', 'resolved')
      break
    case 'all':
      // Everything still open. "All" is not "including resolved" — a resolved
      // thread is finished work, and its own view exists for looking back.
      query = query.eq('status', 'open')
      break
  }

  if (input.cursor) {
    const [at, id] = input.cursor.split('|')
    if (at && id) {
      // Strictly after the cursor row in (last_message_at desc, id desc).
      query = query.or(`last_message_at.lt.${at},and(last_message_at.eq.${at},id.lt.${id})`)
    }
  }

  const { data, error } = await query
  if (error || !data) return { threads: [], nextCursor: null }

  const hasMore = data.length > PAGE_SIZE
  const rows = hasMore ? data.slice(0, PAGE_SIZE) : data

  const previews = await latestPreviews(input.workspaceId, rows.map((r) => r.id))

  const threads: InboxThread[] = rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    contactId: row.contact_id,
    contactName:
      (row.crm_contacts as { full_name: string } | null)?.full_name ?? null,
    assignedTo: row.assigned_to,
    status: row.status as 'open' | 'resolved',
    lastMessageAt: row.last_message_at,
    lastDirection: row.last_direction as 'inbound' | 'outbound',
    messageCount: row.message_count,
    isRead: row.read_at !== null,
    preview: previews.get(row.id) ?? null,
  }))

  const last = rows[rows.length - 1]

  return {
    threads,
    nextCursor: hasMore && last ? `${last.last_message_at}|${last.id}` : null,
  }
}

/** One short preview line per thread, fetched in a single query. */
async function latestPreviews(
  workspaceId: string,
  threadIds: string[],
): Promise<Map<string, string>> {
  const previews = new Map<string, string>()
  if (threadIds.length === 0) return previews

  const { data } = await createAdminClient()
    .from('email_inbound_messages')
    .select('thread_id, body_text, received_at')
    .eq('workspace_id', workspaceId)
    .in('thread_id', threadIds)
    // A bounce notice is not a preview anyone wants to read in a list; it is
    // already surfaced as a suppression.
    .neq('classification', 'bounce')
    .order('received_at', { ascending: false })

  for (const row of data ?? []) {
    // Ordered newest first, so the first one seen per thread is the latest.
    if (previews.has(row.thread_id)) continue
    const line = (row.body_text ?? '').replace(/\s+/g, ' ').trim()
    if (line) previews.set(row.thread_id, line.slice(0, 140))
  }

  return previews
}

export type ThreadDetail = {
  thread: InboxThread
  messages: {
    id: string
    fromEmail: string
    subject: string | null
    bodyText: string | null
    receivedAt: string
    classification: 'reply' | 'auto_reply' | 'bounce'
  }[]
}

/**
 * One thread and its messages.
 *
 * ⚠️ RETURNS NULL RATHER THAN THROWING when the caller may not see it, and the
 * two reasons are deliberately indistinguishable from outside: a thread in
 * another workspace and a thread this setter is not assigned both look like
 * "no such thread". Distinguishing them would confirm the thread exists.
 */
export async function getThread(input: {
  workspaceId: string
  userId: string
  policy: PolicyInput
  threadId: string
}): Promise<ThreadDetail | null> {
  const db = createAdminClient()

  const { data: row } = await db
    .from('email_threads')
    .select(
      'id, subject, contact_id, assigned_to, status, last_message_at, last_direction, message_count, read_at, crm_contacts(full_name)',
    )
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.threadId)
    .maybeSingle()

  if (!row) return null
  if (!seesAllThreads(input.policy) && row.assigned_to !== input.userId) return null

  const { data: messages } = await db
    .from('email_inbound_messages')
    .select('id, from_email, subject, body_text, received_at, classification')
    .eq('workspace_id', input.workspaceId)
    .eq('thread_id', input.threadId)
    .order('received_at', { ascending: true })

  return {
    thread: {
      id: row.id,
      subject: row.subject,
      contactId: row.contact_id,
      contactName: (row.crm_contacts as { full_name: string } | null)?.full_name ?? null,
      assignedTo: row.assigned_to,
      status: row.status as 'open' | 'resolved',
      lastMessageAt: row.last_message_at,
      lastDirection: row.last_direction as 'inbound' | 'outbound',
      messageCount: row.message_count,
      isRead: row.read_at !== null,
      preview: null,
    },
    messages: (messages ?? []).map((m) => ({
      id: m.id,
      fromEmail: m.from_email,
      subject: m.subject,
      bodyText: m.body_text,
      receivedAt: m.received_at,
      classification: m.classification as 'reply' | 'auto_reply' | 'bounce',
    })),
  }
}

/** Counts for the view tabs, in one round trip per view. */
export async function viewCounts(input: {
  workspaceId: string
  userId: string
  policy: PolicyInput
}): Promise<Record<InboxView, number>> {
  const db = createAdminClient()
  const all = seesAllThreads(input.policy)

  const base = () => {
    let q = db
      .from('email_threads')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', input.workspaceId)
    if (!all) q = q.eq('assigned_to', input.userId)
    return q
  }

  const [allOpen, unread, mine, unassigned, needsReply, resolved] = await Promise.all([
    base().eq('status', 'open'),
    base().is('read_at', null).eq('status', 'open'),
    base().eq('assigned_to', input.userId).eq('status', 'open'),
    base().is('assigned_to', null).eq('status', 'open'),
    base().eq('last_direction', 'inbound').eq('status', 'open'),
    base().eq('status', 'resolved'),
  ])

  return {
    all: allOpen.count ?? 0,
    unread: unread.count ?? 0,
    mine: mine.count ?? 0,
    unassigned: unassigned.count ?? 0,
    needs_reply: needsReply.count ?? 0,
    resolved: resolved.count ?? 0,
  }
}
