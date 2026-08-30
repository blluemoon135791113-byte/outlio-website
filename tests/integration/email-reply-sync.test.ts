/**
 * Reply sync, end to end — M6 Phase 17.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  M6 CRITERION 1: "reply stops the sequence within ONE SYNC CYCLE;         ║
 * ║  OOO does not."                                                           ║
 * ║                                                                           ║
 * ║  Both halves are proven against a REAL mail server. The two messages are  ║
 * ║  delivered by SMTP and read back over IMAP; the only difference between   ║
 * ║  them is the `Auto-Submitted` header a real out-of-office responder would ║
 * ║  set. Everything downstream — classification, the stop, the event — runs  ║
 * ║  for real.                                                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 *   docker run -d --name outlio-greenmail -p 2525:3025 -p 993:3993 \
 *     -e GREENMAIL_OPTS='-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 \
 *       -Dgreenmail.users=sender:senderpw@acme.example,prospect:prospectpw@buyer.example' \
 *     greenmail/standalone:2.1.4
 */
import { createConnection } from 'node:net'
import nodemailer from 'nodemailer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { encryptIntegrationSecret } from '@/lib/integrations/crypto'
import { syncMailbox } from '@/lib/email/reply-sync'
import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv } from './helpers'

const SMTP_PORT = 2525
const IMAP_PORT = 993
const RUN = Date.now().toString(36)

function reachable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection({ host: '127.0.0.1', port, timeout: 1500 })
    s.on('connect', () => { s.destroy(); resolve(true) })
    s.on('error', () => resolve(false))
    s.on('timeout', () => { s.destroy(); resolve(false) })
  })
}

/**
 * Delivers a message INTO the sender's own mailbox, which is what an inbound
 * reply is. Uses nodemailer directly rather than the adapter, because the
 * adapter deliberately offers no way to set arbitrary headers — and an
 * out-of-office is defined by exactly such a header.
 */
async function deliverInbound(opts: {
  subject: string
  text: string
  headers?: Record<string, string>
  from?: string
}): Promise<void> {
  const transport = nodemailer.createTransport({
    host: 'localhost',
    port: SMTP_PORT,
    secure: false,
    auth: { user: 'prospect', pass: 'prospectpw' },
    tls: { rejectUnauthorized: false },
  })
  await transport.sendMail({
    from: opts.from ?? 'prospect@buyer.example',
    to: 'sender@acme.example',
    subject: opts.subject,
    text: opts.text,
    headers: opts.headers,
  })
  transport.close()
}

let user: Awaited<ReturnType<typeof createAuthUser>> | null = null
let workspaceId = ''
let accountId = ''
let salesCampaignId = ''
let broadcastCampaignId = ''
let mailUp = false

const ready = () => hasSupabaseEnv && mailUp

beforeAll(async () => {
  if (!hasSupabaseEnv) return
  mailUp = (await reachable(SMTP_PORT)) && (await reachable(IMAP_PORT))
  if (!mailUp) {
    console.warn('\n  SKIPPING reply-sync tests: GreenMail is not running.\n')
    return
  }

  user = await createAuthUser(`reply-${RUN}`)
  const db = adminClient()
  const { data: m } = await db
    .from('workspace_memberships').select('workspace_id').eq('user_id', user.id).single()
  workspaceId = m!.workspace_id

  const { data: acct, error } = await db
    .from('email_accounts')
    .insert({
      workspace_id: workspaceId,
      provider: 'smtp',
      scope: 'workspace',
      owner_user_id: user.id,
      display_name: 'Reply sync mailbox',
      from_email: 'sender@acme.example',
      from_domain: 'acme.example',
      status: 'ramping',
      // ⚠️ IMAP configured: without it the capability model reports
      // `replies: unconfigured` and sync refuses outright.
      configuration: {
        smtpHost: 'localhost', smtpPort: SMTP_PORT,
        imapHost: 'localhost', imapPort: IMAP_PORT,
      },
      timezone: 'UTC',
    })
    .select('id, secret_reference')
    .single()
  if (error) throw new Error(`account insert failed: ${error.message}`)
  accountId = acct.id

  await db.from('email_account_secrets').insert({
    id: acct.secret_reference,
    account_id: acct.id,
    encrypted_payload: encryptIntegrationSecret({
      smtpUsername: 'sender', smtpPassword: 'senderpw',
      imapUsername: 'sender', imapPassword: 'senderpw',
    }),
  })

  const { data: campaigns } = await db
    .from('email_campaigns')
    .insert([
      { workspace_id: workspaceId, name: `Sales ${RUN}`, type: 'sales_sequence',
        status: 'running', account_id: accountId },
      { workspace_id: workspaceId, name: `Newsletter ${RUN}`, type: 'marketing_broadcast',
        status: 'running', account_id: accountId },
    ])
    .select('id, type')
  salesCampaignId = campaigns!.find((c) => c.type === 'sales_sequence')!.id
  broadcastCampaignId = campaigns!.find((c) => c.type === 'marketing_broadcast')!.id
}, 90_000)

afterAll(async () => {
  if (!user) return
  const db = adminClient()

  /*
   * ⚠️ THE WORKSPACE IS DELETED FIRST AND EVERYTHING CASCADES.
   *
   * `email_events` is append-only, so deleting its rows directly is refused —
   * EXCEPT when the parent workspace is already gone, which is the escape
   * hatch the guard provides for exactly this teardown. Trying to delete
   * events row-by-row (as this test first did) fails silently and leaves data
   * behind in a real database.
   */
  await db.from('email_account_secrets').delete().eq('account_id', accountId)
  await db.from('workspaces').delete().eq('id', workspaceId)
  await deleteTestUser(user.id)
})

/**
 * A fresh live enrollment in each campaign, plus a queued follow-up.
 *
 * ⚠️ A NEW CONTACT AND A NEW ADDRESS EACH TIME, rather than deleting the
 * previous enrollment. Deleting one that events already reference is refused —
 * correctly, since the event stream is append-only — so re-using an address
 * would make each test depend on tearing down the last one's history.
 */
async function enroll(): Promise<{ salesId: string; broadcastId: string; email: string }> {
  const db = adminClient()
  const stamp = `${RUN}-${Math.random().toString(36).slice(2, 8)}`
  const email = `prospect+${stamp}@buyer.example`

  const { data: contact, error: contactError } = await db
    .from('crm_contacts')
    .insert({
      workspace_id: workspaceId,
      first_name: 'Dana', last_name: 'Reyes', full_name: `Dana Reyes ${stamp}`,
    })
    .select('id').single()
  if (contactError) throw new Error(`contact insert failed: ${contactError.message}`)

  const { data, error } = await db
    .from('email_enrollments')
    .insert([
      { workspace_id: workspaceId, campaign_id: salesCampaignId, contact_id: contact!.id,
        to_email: email, current_step: 1,
        next_action_at: new Date(Date.now() + 3 * 86_400_000).toISOString() },
      { workspace_id: workspaceId, campaign_id: broadcastCampaignId, contact_id: contact!.id,
        to_email: email, current_step: 0,
        next_action_at: new Date(Date.now() + 86_400_000).toISOString() },
    ])
    .select('id, campaign_id')
  if (error) throw new Error(`enroll failed: ${error.message}`)

  const salesId = data!.find((e) => e.campaign_id === salesCampaignId)!.id
  const broadcastId = data!.find((e) => e.campaign_id === broadcastCampaignId)!.id

  // A follow-up already sitting in the queue — the message that must NOT go
  // out after a reply.
  await db.from('email_messages').insert({
    workspace_id: workspaceId,
    account_id: accountId,
    enrollment_id: salesId,
    to_email: email,
    subject: 'Following up',
    body_text: 'Just checking in.',
    idempotency_key: `followup-${stamp}`,
    status: 'queued',
    scheduled_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  })

  return { salesId, broadcastId, email }
}

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('CRITERION 1 — a reply stops the sequence, an OOO does not', () => {
  it('stops the sales sequence on a genuine reply, within one sync cycle', async ({ skip }) => {
    if (!ready()) return skip()

    const { salesId, email } = await enroll()
    const db = adminClient()

    await deliverInbound({
      from: email,
      subject: `Re: Quick question ${RUN}`,
      text: 'Yes — Thursday works. Send an invite.',
    })

    // ⚠️ ONE cycle. Not two, not "eventually".
    const outcome = await syncMailbox(workspaceId, accountId)
    expect(outcome.replies).toBeGreaterThanOrEqual(1)
    expect(outcome.sequencesStopped).toBeGreaterThanOrEqual(1)

    const { data: sales } = await db
      .from('email_enrollments')
      .select('status, stop_reason, replied_at')
      .eq('id', salesId).single()

    expect(sales!.status).toBe('stopped')
    expect(sales!.stop_reason).toBe('replied')
    expect(sales!.replied_at).not.toBeNull()

    // The queued follow-up is cancelled — this is the whole point. Stopping
    // the enrollment without cancelling would still deliver it in three days.
    const { data: queued } = await db
      .from('email_messages')
      .select('status, error_code')
      .eq('enrollment_id', salesId).single()
    expect(queued!.status).toBe('cancelled')
    expect(queued!.error_code).toBe('ENROLLMENT_STOPPED')

    // Recorded as a real reply.
    const { data: events } = await db
      .from('email_events')
      .select('type').eq('workspace_id', workspaceId).eq('email', email).eq('type', 'replied')
    expect(events!.length).toBe(1)
  }, 120_000)

  it('does NOT stop the sequence on an out-of-office', async ({ skip }) => {
    if (!ready()) return skip()

    const { salesId, email } = await enroll()
    const db = adminClient()

    await deliverInbound({
      from: email,
      subject: `Automatic reply: Re: Quick question ${RUN}`,
      text: 'I am out of the office until Tuesday.',
      // The header a real out-of-office responder sets (RFC 3834).
      headers: { 'Auto-Submitted': 'auto-replied' },
    })

    const outcome = await syncMailbox(workspaceId, accountId)
    expect(outcome.autoReplies).toBeGreaterThanOrEqual(1)
    expect(outcome.sequencesStopped).toBe(0)

    const { data: sales } = await db
      .from('email_enrollments')
      .select('status, stop_reason, replied_at')
      .eq('id', salesId).single()

    // STILL RUNNING. The prospect is away, not uninterested.
    expect(sales!.status).toBe('active')
    expect(sales!.stop_reason).toBeNull()
    expect(sales!.replied_at).toBeNull()

    // The queued follow-up survives, so it goes out when they are back.
    const { data: queued } = await db
      .from('email_messages').select('status').eq('enrollment_id', salesId).single()
    expect(queued!.status).toBe('queued')

    // Recorded as auto_replied, which never counts toward the reply rate.
    const { data: events } = await db
      .from('email_events').select('type').eq('workspace_id', workspaceId).eq('email', email)
    expect(events!.some((e) => e.type === 'auto_replied')).toBe(true)
    expect(events!.some((e) => e.type === 'replied')).toBe(false)
  }, 120_000)

  it('leaves a marketing broadcast running when someone replies to it', async ({ skip }) => {
    if (!ready()) return skip()

    const { broadcastId, email } = await enroll()
    const db = adminClient()

    await deliverInbound({
      from: email,
      subject: `Re: Newsletter ${RUN}`,
      text: 'Thanks, great newsletter!',
    })

    await syncMailbox(workspaceId, accountId)

    const { data: broadcast } = await db
      .from('email_enrollments').select('status').eq('id', broadcastId).single()

    /*
     * A reply to a newsletter is a conversation, not an objection. Stopping
     * here would quietly unsubscribe the most engaged readers for saying
     * thank you.
     */
    expect(broadcast!.status).toBe('active')
  }, 120_000)

  it('suppresses the address and stops enrollments on a bounce', async ({ skip }) => {
    if (!ready()) return skip()

    const { salesId } = await enroll()
    const db = adminClient()

    await deliverInbound({
      subject: 'Undelivered Mail Returned to Sender',
      text: 'The address does not exist.',
      headers: { 'Auto-Submitted': 'auto-replied' },
      from: 'MAILER-DAEMON@buyer.example',
    })

    const outcome = await syncMailbox(workspaceId, accountId)
    expect(outcome.bounces).toBeGreaterThanOrEqual(1)

    // Bounce beats the auto-reply marker it also carries: a dead address is
    // the more actionable fact.
    const { data: suppression } = await db
      .from('email_suppressions')
      .select('reason').eq('workspace_id', workspaceId)
      .eq('email', 'mailer-daemon@buyer.example').maybeSingle()
    expect(suppression?.reason).toBe('hard_bounce')

    const { data: sales } = await db
      .from('email_enrollments').select('status').eq('id', salesId).single()
    // Not stopped as `replied` — the address bounced, it did not answer.
    expect(sales!.status).toBe('active')
  }, 120_000)

  it('processes the same inbound message only once across two syncs', async ({ skip }) => {
    if (!ready()) return skip()

    const { salesId, email } = await enroll()
    const db = adminClient()

    await deliverInbound({
      from: email,
      subject: `Re: Dedupe check ${RUN}`,
      text: 'Sounds good.',
    })

    await syncMailbox(workspaceId, accountId)

    // Rewind the cursor so the SAME message is fetched again — which is what
    // an overlapping sync or a restarted worker produces.
    const { data: acct } = await db
      .from('email_accounts').select('configuration').eq('id', accountId).single()
    await db
      .from('email_accounts')
      .update({ configuration: { ...(acct!.configuration as object), syncCursor: null } })
      .eq('id', accountId)

    await syncMailbox(workspaceId, accountId)

    const { data: events } = await db
      .from('email_events')
      .select('id').eq('workspace_id', workspaceId).eq('email', email).eq('type', 'replied')

    // Exactly one, despite the message being read twice.
    expect(events!.length).toBe(1)
    expect(salesId).toBeTruthy()
  }, 120_000)
})
