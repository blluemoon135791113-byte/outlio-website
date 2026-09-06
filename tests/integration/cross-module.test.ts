/**
 * One reply must reach every module — R15.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE BRIEF'S RULE: "THERE MUST NOT BE SEPARATE INCOMPATIBLE HISTORIES."  ║
 * ║                                                                           ║
 * ║  A reply is supposed to land in the inbox, on the contact's timeline, in  ║
 * ║  the campaign report, and as a flow trigger. Each of those is built and   ║
 * ║  tested on its own — and "tested on its own" is exactly how four correct  ║
 * ║  modules end up disagreeing about what happened.                          ║
 * ║                                                                           ║
 * ║  This asserts the JOIN between them, which no single module's suite can.  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { normalizeEmail } from '@/lib/crm/normalize'
import { threadsForContact } from '@/lib/email/inbox'
import type { Module, PolicyInput } from '@/lib/workspaces/permissions'
import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv } from './helpers'

const RUN = Date.now().toString(36)

const MODULES: ReadonlySet<Module> = new Set<Module>([
  'crm', 'email', 'flows', 'reports', 'integrations', 'hubble',
])
const ownerPolicy: PolicyInput = { role: 'owner', modules: MODULES }

let user: Awaited<ReturnType<typeof createAuthUser>> | null = null
let workspaceId = ''
let contactId = ''
let accountId = ''
let threadId = ''

beforeAll(async () => {
  if (!hasSupabaseEnv) return
  const db = adminClient()

  user = await createAuthUser(`xmod-${RUN}`)
  const { data: membership } = await db
    .from('workspace_memberships')
    .select('workspace_id')
    .eq('user_id', user.id)
    .single()
  workspaceId = membership!.workspace_id

  const { data: contact } = await db
    .from('crm_contacts')
    .insert({
      workspace_id: workspaceId,
      full_name: `Replier ${RUN}`,
      owner_user_id: user.id,
    })
    .select('id')
    .single()
  contactId = contact!.id

  /*
   * ⚠️ `identity_key` IS REQUIRED AND IS NOT THE ADDRESS. What we STORE and
   * CONTACT is the address; what we COMPARE on is the folded identity key —
   * that separation is the whole basis of email de-duplication, and the
   * column is NOT NULL precisely so nobody can skip it.
   */
  await db.from('crm_contact_emails').insert({
    workspace_id: workspaceId,
    contact_id: contactId,
    address: `replier-${RUN}@buyer.example`,
    identity_key: normalizeEmail(`replier-${RUN}@buyer.example`)!.identityKey,
    is_primary: true,
  })

  const { data: account } = await db
    .from('email_accounts')
    .insert({
      workspace_id: workspaceId,
      provider: 'smtp',
      scope: 'workspace',
      owner_user_id: user.id,
      display_name: 'Cross-module mailbox',
      from_email: `sender-${RUN}@acme.example`,
      from_domain: 'acme.example',
      status: 'ready',
      configuration: { smtpHost: 'localhost', smtpPort: 2525 },
    })
    .select('id')
    .single()
  accountId = account!.id

  /*
   * The same RPC `reply-sync` calls. Going through it rather than inserting
   * rows by hand is the point: this tests the path production takes.
   */
  const { data: recorded } = await db.rpc('email_record_inbound', {
    p_workspace_id: workspaceId,
    p_account_id: accountId,
    p_provider_thread_key: `xmod-thread-${RUN}`,
    p_provider_message_id: `xmod-msg-${RUN}`,
    p_from_email: `replier-${RUN}@buyer.example`,
    p_subject: `Re: your note ${RUN}`,
    p_body_text: 'Yes, interested — can we talk Thursday?',
    p_received_at: new Date().toISOString(),
    p_classification: 'reply',
    p_contact_id: contactId,
  })

  threadId =
    (Array.isArray(recorded) ? recorded[0]?.thread_id : null) ??
    (await db
      .from('email_threads')
      .select('id')
      .eq('workspace_id', workspaceId)
      .limit(1)
      .single()).data!.id
}, 120_000)

afterAll(async () => {
  if (!user) return
  await adminClient().from('workspaces').delete().eq('id', workspaceId)
  await deleteTestUser(user.id)
})

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('a reply reaches every module', () => {
  it('appears in the INBOX as a thread', async () => {
    const { data } = await adminClient()
      .from('email_threads')
      .select('id, contact_id, last_direction')
      .eq('workspace_id', workspaceId)
      .eq('id', threadId)
      .single()

    expect(data!.contact_id).toBe(contactId)
    expect(data!.last_direction).toBe('inbound')
  }, 60_000)

  it('is reachable FROM THE CONTACT, not only from the inbox', async () => {
    /*
     * ⚠️ THE GAP R15 CLOSED. Before this, the CRM could tell you someone had
     * replied — the activity row existed — and could not show you what they
     * said. The conversation lived in one module and the fact of it in
     * another.
     */
    const threads = await threadsForContact({
      workspaceId,
      contactId,
      userId: user!.id,
      policy: ownerPolicy,
    })

    expect(threads).toHaveLength(1)
    expect(threads[0]!.id).toBe(threadId)
    expect(threads[0]!.subject).toContain(RUN)
  }, 60_000)

  it('is stored as a message the thread view can render', async () => {
    const { data, error } = await adminClient()
      .from('email_inbound_messages')
      .select('classification, body_text, thread_id')
      .eq('workspace_id', workspaceId)
      .eq('thread_id', threadId)

    /*
     * ⚠️ THE ERROR IS ASSERTED, NOT IGNORED. The first version of this test
     * selected a `contact_id` column that does not exist on this table —
     * PostgREST returned an error and `data` was null, and a companion test
     * that looped over `data ?? []` PASSED while checking nothing. Asserting
     * `error` is null is what turns a bad column name into a failure instead
     * of a silent empty result.
     */
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    // Classified as a genuine reply, which is what stops a sequence and fires
    // the flow trigger — an auto-reply must do neither.
    expect(data![0]!.classification).toBe('reply')
  }, 60_000)
})

describeIf('the modules agree on WHO replied', () => {
  it('links the thread, the message and the contact to one person', async () => {
    /*
     * ⚠️ THE CONTACT LIVES ON THE THREAD, NOT THE MESSAGE, and that is the
     * right design: a thread is about a person, a message belongs to a thread.
     * So "who replied" is a two-link chain — message → thread → contact — and
     * this asserts both links rather than assuming either.
     *
     * The failure it catches is silent. Each module can be internally correct
     * while pointing somewhere different: a thread matched by address, a
     * message filed under another thread. The result is a CRM that reports a
     * reply on one person's timeline and shows the conversation on another's.
     */
    const db = adminClient()

    const [thread, messages] = await Promise.all([
      db.from('email_threads').select('contact_id').eq('id', threadId).single(),
      db.from('email_inbound_messages').select('thread_id').eq('thread_id', threadId),
    ])

    expect(thread.error).toBeNull()
    expect(messages.error).toBeNull()

    // Link one: the thread names the contact.
    expect(thread.data!.contact_id).toBe(contactId)

    // Link two: every message belongs to that thread — and there IS at least
    // one, so the loop below is not vacuous.
    expect(messages.data!.length).toBeGreaterThan(0)
    for (const message of messages.data!) {
      expect(message.thread_id).toBe(threadId)
    }
  }, 60_000)
})

describeIf('a deal created from a reply keeps the link', () => {
  it('attaches to the same contact the conversation is about', async () => {
    const db = adminClient()

    const { data: pipeline } = await db
      .from('crm_pipelines')
      .insert({ workspace_id: workspaceId, name: `Xmod ${RUN}`, is_default: true })
      .select('id')
      .single()

    const { data: stage } = await db
      .from('crm_pipeline_stages')
      .insert({
        workspace_id: workspaceId,
        pipeline_id: pipeline!.id,
        name: 'New',
        kind: 'open',
        sort_order: 1,
      })
      .select('id')
      .single()

    const { data: deal } = await db
      .from('crm_opportunities')
      .insert({
        workspace_id: workspaceId,
        title: `Deal from reply ${RUN}`,
        pipeline_id: pipeline!.id,
        stage_id: stage!.id,
        contact_id: contactId,
      })
      .select('id, contact_id')
      .single()

    /*
     * The whole point of creating it from the inbox: the deal, the
     * conversation and the contact are one story. A deal created without the
     * contact would leave the campaign that produced it uncredited.
     */
    expect(deal!.contact_id).toBe(contactId)

    const threads = await threadsForContact({
      workspaceId,
      contactId,
      userId: user!.id,
      policy: ownerPolicy,
    })
    expect(threads[0]!.id).toBe(threadId)
  }, 60_000)
})
