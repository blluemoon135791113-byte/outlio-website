/**
 * The unified inbox — M8 Phase 26.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  M8 CRITERION 5: "inbox respects PERMISSIONS + PAGINATION; threads        ║
 * ║  RESOLVE CORRECTLY."                                                      ║
 * ║                                                                           ║
 * ║  Run against the real database. The permission half is the one that       ║
 * ║  matters: a shared mailbox is the single place in the product where       ║
 * ║  getting "only assigned data" wrong hands a setter every conversation in  ║
 * ║  the company.                                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getThread, listThreads, seesAllThreads, viewCounts } from '@/lib/email/inbox'
import type { WorkspacePolicy } from '@/lib/workspaces/permissions'
import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv } from './helpers'

const RUN = Date.now().toString(36)

let owner: Awaited<ReturnType<typeof createAuthUser>> | null = null
let workspaceId = ''
let accountId = ''
let setterId = ''

/** Every module on, so only the ROLE varies between these policies. */
const MODULES = ['crm', 'email', 'flows', 'reports', 'integrations', 'hubble']
const managerPolicy: WorkspacePolicy = { role: 'manager', modules: MODULES }
const setterPolicy: WorkspacePolicy = { role: 'setter', modules: MODULES }

beforeAll(async () => {
  if (!hasSupabaseEnv) return

  owner = await createAuthUser(`inbox-${RUN}`)
  const db = adminClient()
  const { data: m } = await db
    .from('workspace_memberships').select('workspace_id').eq('user_id', owner.id).single()
  workspaceId = m!.workspace_id

  const setter = await createAuthUser(`inbox-setter-${RUN}`)
  setterId = setter.id

  const { data: account, error } = await db
    .from('email_accounts')
    .insert({
      workspace_id: workspaceId, provider: 'smtp', scope: 'workspace',
      owner_user_id: owner.id, display_name: 'Inbox mailbox',
      from_email: 'sender@acme.example', from_domain: 'acme.example',
      status: 'ramping', configuration: { smtpHost: 'localhost', smtpPort: 2525 },
    })
    .select('id').single()
  if (error) throw new Error(`account insert failed: ${error.message}`)
  accountId = account.id
}, 60_000)

afterAll(async () => {
  if (!owner) return
  const db = adminClient()
  await db.from('workspaces').delete().eq('id', workspaceId)
  await deleteTestUser(owner.id)
  if (setterId) await deleteTestUser(setterId)
})

/** Files an inbound message through the real function. */
async function receive(opts: {
  threadKey: string
  messageId: string
  from?: string
  subject?: string
  body?: string
  receivedAt?: string
  classification?: string
  contactId?: string | null
}) {
  const { data, error } = await adminClient().rpc('email_record_inbound', {
    p_workspace_id: workspaceId,
    p_account_id: accountId,
    p_provider_thread_key: opts.threadKey,
    p_provider_message_id: opts.messageId,
    p_from_email: opts.from ?? 'dana@buyer.example',
    p_subject: opts.subject ?? 'Re: Quick question',
    p_body_text: opts.body ?? 'Yes, worth a chat.',
    p_received_at: opts.receivedAt ?? new Date().toISOString(),
    p_classification: opts.classification ?? 'reply',
    p_contact_id: opts.contactId ?? null,
  })
  if (error) throw new Error(`email_record_inbound failed: ${error.message}`)
  return data![0]!
}

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('CRITERION 5 — permissions', () => {
  it('shows a SETTER only the threads assigned to them', async () => {
    /*
     * ⚠️ THE TEST THAT MATTERS MOST IN THIS FILE. Without the owner filter a
     * setter reads every conversation in the workspace — including the ones
     * about their own compensation.
     */
    const mine = await receive({ threadKey: `perm-mine-${RUN}`, messageId: `pm-${RUN}` })
    const theirs = await receive({ threadKey: `perm-theirs-${RUN}`, messageId: `pt-${RUN}` })

    const db = adminClient()
    await db.from('email_threads').update({ assigned_to: setterId }).eq('id', mine.thread_id)
    await db.from('email_threads').update({ assigned_to: null }).eq('id', theirs.thread_id)

    const asSetter = await listThreads({
      workspaceId, userId: setterId, policy: setterPolicy, view: 'all',
    })
    const ids = asSetter.threads.map((t) => t.id)

    expect(ids).toContain(mine.thread_id)
    expect(ids).not.toContain(theirs.thread_id)

    // A manager sees both.
    const asManager = await listThreads({
      workspaceId, userId: owner!.id, policy: managerPolicy, view: 'all',
    })
    const managerIds = asManager.threads.map((t) => t.id)
    expect(managerIds).toContain(mine.thread_id)
    expect(managerIds).toContain(theirs.thread_id)
  }, 60_000)

  it('states the rule in one place', () => {
    expect(seesAllThreads(managerPolicy)).toBe(true)
    expect(seesAllThreads(setterPolicy)).toBe(false)
    // A viewer cannot see the whole inbox either.
    expect(seesAllThreads({ role: 'viewer', modules: MODULES })).toBe(false)
    // Nor can anyone whose plan excludes the email module, whatever their role.
    expect(seesAllThreads({ role: 'owner', modules: ['crm'] })).toBe(false)
  })

  it('refuses a thread the setter is not assigned, without confirming it exists', async () => {
    const theirs = await receive({ threadKey: `perm-hidden-${RUN}`, messageId: `ph-${RUN}` })

    const asSetter = await getThread({
      workspaceId, userId: setterId, policy: setterPolicy, threadId: theirs.thread_id,
    })
    // Same answer as a thread that does not exist at all.
    expect(asSetter).toBeNull()

    const asManager = await getThread({
      workspaceId, userId: owner!.id, policy: managerPolicy, threadId: theirs.thread_id,
    })
    expect(asManager).not.toBeNull()
  }, 60_000)

  it('never returns another workspace’s thread', async () => {
    /*
     * ⚠️ THE SERVICE ROLE BYPASSES RLS, so an id alone is not authorisation.
     * Every query in `lib/email/inbox.ts` is scoped by workspace in code.
     */
    const other = await createAuthUser(`inbox-other-${RUN}`)
    const db = adminClient()
    const { data: m } = await db
      .from('workspace_memberships').select('workspace_id').eq('user_id', other.id).single()

    const mine = await receive({ threadKey: `perm-cross-${RUN}`, messageId: `pc-${RUN}` })

    const leaked = await getThread({
      workspaceId: m!.workspace_id,
      userId: other.id,
      policy: managerPolicy,
      threadId: mine.thread_id,
    })
    expect(leaked).toBeNull()

    const list = await listThreads({
      workspaceId: m!.workspace_id, userId: other.id, policy: managerPolicy, view: 'all',
    })
    expect(list.threads).toHaveLength(0)

    await db.from('workspaces').delete().eq('id', m!.workspace_id)
    await deleteTestUser(other.id)
  }, 60_000)
})

describeIf('CRITERION 5 — pagination', () => {
  it('pages with a KEYSET cursor that neither repeats nor skips a thread', async () => {
    const db = adminClient()
    await db.from('email_threads').delete().eq('workspace_id', workspaceId)

    // 30 threads, one page of 25 plus a remainder.
    const base = Date.parse('2026-08-01T00:00:00.000Z')
    for (let i = 0; i < 30; i += 1) {
      await receive({
        threadKey: `page-${RUN}-${i}`,
        messageId: `pg-${RUN}-${i}`,
        receivedAt: new Date(base + i * 60_000).toISOString(),
      })
    }

    const first = await listThreads({
      workspaceId, userId: owner!.id, policy: managerPolicy, view: 'all',
    })

    // ⚠️ THE PAGE SIZE IS ENFORCED BY THE MODULE, not requestable by a caller.
    expect(first.threads).toHaveLength(25)
    expect(first.nextCursor).not.toBeNull()

    const second = await listThreads({
      workspaceId, userId: owner!.id, policy: managerPolicy, view: 'all',
      cursor: first.nextCursor,
    })
    expect(second.threads).toHaveLength(5)
    expect(second.nextCursor).toBeNull()

    const all = [...first.threads, ...second.threads].map((t) => t.id)
    // No thread appears twice...
    expect(new Set(all).size).toBe(30)
    // ...and none was skipped.
    expect(all).toHaveLength(30)

    // Newest first, throughout.
    const times = [...first.threads, ...second.threads].map((t) => Date.parse(t.lastMessageAt))
    expect(times).toEqual([...times].sort((a, b) => b - a))
  }, 180_000)

  it('does not re-show a thread when new mail arrives mid-read', async () => {
    /*
     * ⚠️ WHY KEYSET AND NOT OFFSET. With OFFSET 25 a thread arriving between
     * the two requests shifts every later row down, so page two silently
     * repeats one thread and hides another. The cursor is anchored to a row,
     * so it cannot.
     */
    const first = await listThreads({
      workspaceId, userId: owner!.id, policy: managerPolicy, view: 'all',
    })

    await receive({
      threadKey: `page-interloper-${RUN}`,
      messageId: `pi-${RUN}`,
      receivedAt: new Date().toISOString(),
    })

    const second = await listThreads({
      workspaceId, userId: owner!.id, policy: managerPolicy, view: 'all',
      cursor: first.nextCursor,
    })

    const overlap = second.threads.filter((t) => first.threads.some((f) => f.id === t.id))
    expect(overlap).toHaveLength(0)
  }, 60_000)
})

describeIf('CRITERION 5 — threads resolve correctly', () => {
  it('moves between views as it is worked, and REOPENS when they write back', async () => {
    const db = adminClient()
    await db.from('email_threads').delete().eq('workspace_id', workspaceId)

    const t = await receive({ threadKey: `res-${RUN}`, messageId: `r1-${RUN}` })

    const inView = async (view: Parameters<typeof listThreads>[0]['view']) => {
      const page = await listThreads({
        workspaceId, userId: owner!.id, policy: managerPolicy, view,
      })
      return page.threads.some((x) => x.id === t.thread_id)
    }

    // A new inbound message is unread, unassigned and awaiting an answer.
    expect(await inView('all')).toBe(true)
    expect(await inView('unread')).toBe(true)
    expect(await inView('unassigned')).toBe(true)
    expect(await inView('needs_reply')).toBe(true)
    expect(await inView('resolved')).toBe(false)

    // Answering it takes it out of "needs reply" and nothing else.
    await db.rpc('email_thread_mark_outbound', {
      p_workspace_id: workspaceId,
      p_thread_key: `res-${RUN}`,
      p_sent_at: new Date().toISOString(),
    })
    expect(await inView('needs_reply')).toBe(false)
    expect(await inView('all')).toBe(true)

    // Resolving takes it out of the open views entirely.
    await db.from('email_threads')
      .update({ status: 'resolved', read_at: new Date().toISOString() })
      .eq('id', t.thread_id)
    expect(await inView('all')).toBe(false)
    expect(await inView('resolved')).toBe(true)

    /*
     * ⚠️ AND THEN THEY WRITE BACK. Someone replying after a thread was marked
     * resolved is exactly the case that must not be swallowed — it reopens,
     * unread, and needs a reply again.
     */
    await receive({ threadKey: `res-${RUN}`, messageId: `r2-${RUN}`, body: 'One more thing.' })

    expect(await inView('resolved')).toBe(false)
    expect(await inView('all')).toBe(true)
    expect(await inView('unread')).toBe(true)
    expect(await inView('needs_reply')).toBe(true)
  }, 120_000)

  it('files a REPLAYED provider message once, and does not resurface the thread', async () => {
    const db = adminClient()
    await db.from('email_threads').delete().eq('workspace_id', workspaceId)

    const first = await receive({ threadKey: `dup-${RUN}`, messageId: `d1-${RUN}` })
    expect(first.is_new).toBe(true)

    await db.from('email_threads')
      .update({ read_at: new Date().toISOString() })
      .eq('id', first.thread_id)

    // The same message again — an overlapping sync, or a crash-and-resume.
    const replay = await receive({ threadKey: `dup-${RUN}`, messageId: `d1-${RUN}` })
    expect(replay.is_new).toBe(false)
    expect(replay.thread_id).toBe(first.thread_id)

    const { data: thread } = await db
      .from('email_threads')
      .select('message_count, read_at').eq('id', first.thread_id).single()

    expect(thread!.message_count).toBe(1)
    /*
     * A replay must not mark an answered thread unread again, or every sync
     * cycle would resurface work somebody already did.
     */
    expect(thread!.read_at).not.toBeNull()

    const { count } = await db
      .from('email_inbound_messages')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', first.thread_id)
    expect(count).toBe(1)
  }, 60_000)

  it('keeps a reply from an address the CRM has never seen', async () => {
    /*
     * Dropping it loses a real reply; inventing a contact fabricates a record.
     * It belongs in the inbox, unmatched.
     */
    const db = adminClient()
    await db.from('email_threads').delete().eq('workspace_id', workspaceId)

    const t = await receive({
      threadKey: `unmatched-${RUN}`,
      messageId: `u1-${RUN}`,
      from: 'someone-else@stranger.example',
      contactId: null,
    })

    const detail = await getThread({
      workspaceId, userId: owner!.id, policy: managerPolicy, threadId: t.thread_id,
    })

    expect(detail).not.toBeNull()
    expect(detail!.thread.contactId).toBeNull()
    expect(detail!.messages).toHaveLength(1)
    expect(detail!.messages[0]!.fromEmail).toBe('someone-else@stranger.example')
  }, 60_000)

  it('counts each view without a full scan disagreeing with the list', async () => {
    const counts = await viewCounts({
      workspaceId, userId: owner!.id, policy: managerPolicy,
    })
    const page = await listThreads({
      workspaceId, userId: owner!.id, policy: managerPolicy, view: 'all',
    })

    // The tab badge and the list must never tell different stories.
    expect(counts.all).toBe(page.threads.length)
  }, 60_000)
})
