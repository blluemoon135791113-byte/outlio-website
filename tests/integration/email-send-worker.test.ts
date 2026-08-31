/**
 * The send worker, end to end — M5 Phase 14.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  M5 CRITERION 3: "kill-and-retry test on send worker produces exactly     ║
 * ║  ONE delivered message."                                                  ║
 * ║  M5 CRITERION 4: "suppressed recipient is never sent to (tested for every ║
 * ║  suppression reason)."                                                    ║
 * ║                                                                           ║
 * ║  Both are counted at the MAIL SERVER, not in our own database. Asserting  ║
 * ║  that our row says `sent` proves only that we agree with ourselves — the  ║
 * ║  question is how many emails a human actually received.                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Needs BOTH a live Supabase and GreenMail:
 *
 *   docker run -d --name outlio-greenmail -p 2525:3025 -p 993:3993 \
 *     -e GREENMAIL_OPTS='-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 \
 *       -Dgreenmail.users=sender:senderpw@acme.example,prospect:prospectpw@buyer.example' \
 *     greenmail/standalone:2.1.4
 */
import { createConnection } from 'node:net'
import { ImapFlow } from 'imapflow'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { encryptIntegrationSecret } from '@/lib/integrations/crypto'
import { enqueueEmail, reapExpiredClaims, runSendWorker, suppressEmail } from '@/lib/email/send'
import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv } from './helpers'

const SMTP_PORT = 2525
const IMAP_PORT = 993
const RUN = Date.now().toString(36)

function reachable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port, timeout: 1500 })
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

/** How many messages the PROSPECT actually received, read over IMAP. */
async function inboxCount(subjectContains: string): Promise<number> {
  const client = new ImapFlow({
    host: 'localhost',
    port: IMAP_PORT,
    secure: true,
    auth: { user: 'prospect', pass: 'prospectpw' },
    logger: false,
    tls: { rejectUnauthorized: false },
  })

  await client.connect()
  let count = 0
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      for await (const msg of client.fetch('1:*', { envelope: true })) {
        if (msg.envelope?.subject?.includes(subjectContains)) count += 1
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }
  return count
}

let mailUp = false
let user: Awaited<ReturnType<typeof createAuthUser>> | null = null
let workspaceId = ''
let accountId = ''

const ready = () => hasSupabaseEnv && mailUp

beforeAll(async () => {
  mailUp = (await reachable(SMTP_PORT)) && (await reachable(IMAP_PORT))
  if (!hasSupabaseEnv || !mailUp) {
    console.warn('\n  SKIPPING send-worker tests: needs Supabase env AND GreenMail.\n')
    return
  }

  user = await createAuthUser(`send-${RUN}`)
  const db = adminClient()

  const { data: membership } = await db
    .from('workspace_memberships')
    .select('workspace_id')
    .eq('user_id', user.id)
    .single()
  workspaceId = membership!.workspace_id

  const { data: account, error } = await db
    .from('email_accounts')
    .insert({
      workspace_id: workspaceId,
      provider: 'smtp',
      scope: 'workspace',
      owner_user_id: user.id,
      display_name: 'Worker test mailbox',
      from_email: 'sender@acme.example',
      from_domain: 'acme.example',
      status: 'ramping',
      configuration: { smtpHost: 'localhost', smtpPort: SMTP_PORT },
      // Sends any day, all day, so the schedule never blocks the test.
      send_days: [1, 2, 3, 4, 5, 6, 7],
      send_window_start: '00:00',
      send_window_end: '23:59',
      min_delay_seconds: 0,
      timezone: 'UTC',
    })
    .select('id, secret_reference')
    .single()

  if (error) throw new Error(`account insert failed: ${error.message}`)
  accountId = account.id

  await db.from('email_account_secrets').insert({
    id: account.secret_reference,
    account_id: account.id,
    encrypted_payload: encryptIntegrationSecret({
      smtpUsername: 'sender',
      smtpPassword: 'senderpw',
    }),
  })
}, 60_000)

afterAll(async () => {
  if (user) {
    const db = adminClient()
    await db.from('email_messages').delete().eq('workspace_id', workspaceId)
    await db.from('email_suppressions').delete().eq('workspace_id', workspaceId)
    await db.from('email_account_secrets').delete().eq('account_id', accountId)
    await db.from('email_accounts').delete().eq('workspace_id', workspaceId)
    await deleteTestUser(user.id)
  }
})

describe('the send worker delivers', () => {
  it('sends a queued message exactly once', async ({ skip }) => {
    if (!ready()) return skip()

    const subject = `Ordinary send ${RUN}`
    const queued = await enqueueEmail({
      workspaceId,
      accountId,
      toEmail: 'prospect@buyer.example',
      subject,
      bodyText: 'Hello there.',
      idempotencyKey: `plain-${RUN}`,
    })
    expect(queued.queued).toBe(true)

    const result = await runSendWorker(`worker-${RUN}`)
    expect(result.sent).toBe(1)

    expect(await inboxCount(subject)).toBe(1)
  }, 60_000)

  it('treats a re-enqueue with the same key as a no-op', async ({ skip }) => {
    if (!ready()) return skip()

    const subject = `Duplicate key ${RUN}`
    const first = await enqueueEmail({
      workspaceId,
      accountId,
      toEmail: 'prospect@buyer.example',
      subject,
      bodyText: 'Body.',
      idempotencyKey: `dupe-${RUN}`,
    })
    const second = await enqueueEmail({
      workspaceId,
      accountId,
      toEmail: 'prospect@buyer.example',
      subject,
      bodyText: 'Body.',
      idempotencyKey: `dupe-${RUN}`,
    })

    expect(first.queued).toBe(true)
    expect(second.queued).toBe(false)
    if (!second.queued && second.reason === 'duplicate') {
      expect(second.messageId).toBe(first.queued ? first.messageId : '')
    }

    await runSendWorker(`worker-${RUN}`)
    expect(await inboxCount(subject)).toBe(1)
  }, 60_000)
})

describe('CRITERION 3 — kill and retry produces exactly one delivered message', () => {
  it('does not re-send a message whose worker died after handing it over', async ({ skip }) => {
    if (!ready()) return skip()

    const db = adminClient()
    const subject = `Killed worker ${RUN}`

    await enqueueEmail({
      workspaceId,
      accountId,
      toEmail: 'prospect@buyer.example',
      subject,
      bodyText: 'Sent once, recorded never.',
      idempotencyKey: `killed-${RUN}`,
    })

    /*
     * Simulate the worst case precisely: the message is CLAIMED, the provider
     * ACCEPTS it, and the process dies before the result is recorded. The row
     * is left in `sending` — exactly the state a `kill -9` would leave.
     */
    const { data: claimed } = await db.rpc('claim_email_messages', {
      p_claimed_by: 'about-to-die',
      p_limit: 10,
      p_claim_seconds: 120,
    })
    const target = (claimed ?? []).find((m) => m.subject === subject)
    expect(target).toBeDefined()

    const { smtpProvider } = await import('@/lib/email/providers/smtp')
    const { data: acct } = await db
      .from('email_accounts')
      .select('id, workspace_id, from_email, from_name, configuration, secret_reference')
      .eq('id', accountId)
      .single()

    const delivered = await smtpProvider.send(
      {
        id: acct!.id,
        workspaceId: acct!.workspace_id,
        provider: 'smtp',
        fromEmail: acct!.from_email,
        fromName: acct!.from_name,
        configuration: acct!.configuration as { smtpHost: string; smtpPort: number },
        secretReference: acct!.secret_reference,
      },
      {
        to: 'prospect@buyer.example',
        subject,
        text: 'Sent once, recorded never.',
        html: null,
        idempotencyKey: target!.idempotency_key,
      },
    )
    expect(delivered.ok).toBe(true)
    // ...and now the worker "dies": nothing is recorded.

    expect(await inboxCount(subject)).toBe(1)

    // Expire the claim, as the reaper would find it after a crash.
    await db
      .from('email_messages')
      .update({ claim_expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', target!.message_id)

    const reaped = await reapExpiredClaims()
    expect(reaped).toBeGreaterThanOrEqual(1)

    const { data: after } = await db
      .from('email_messages')
      .select('status, error_code')
      .eq('id', target!.message_id)
      .single()

    // NOT queued. This is the at-most-once guarantee made visible.
    expect(after!.status).toBe('needs_verification')
    expect(after!.error_code).toBe('CLAIM_EXPIRED')

    // The retry: run the worker again, as a restarted process would.
    await runSendWorker(`worker-restarted-${RUN}`)

    /*
     * ⚠️ THE ASSERTION THAT MATTERS. Counted at the mail server: the prospect
     * received the message ONCE, despite a kill mid-flight and a full worker
     * restart afterwards.
     */
    expect(await inboxCount(subject)).toBe(1)
  }, 90_000)
})

describe('CRITERION 4 — a suppressed recipient is never sent to', () => {
  const reasons = [
    'unsubscribed',
    'hard_bounce',
    'complaint',
    'manual',
    'invalid_address',
  ] as const

  /*
   * ⚠️ A PLAIN LOOP, NOT `it.each`. Every other test here skips by
   * destructuring `{ skip }` from the test context, which Vitest passes as the
   * first argument. `it.each` spreads the CASE VALUES into that position and
   * appends no context — so the context was `undefined`, and these five tests
   * threw `Cannot read properties of undefined` instead of skipping whenever
   * GreenMail was not running. A suppression test that crashes rather than
   * skipping is the last one you want to be noisy for the wrong reason: the
   * failure it reports has nothing to do with suppression.
   */
  for (const reason of reasons) {
    it(`never delivers to an address suppressed as ${reason}`, async ({ skip }) => {
      if (!ready()) return skip()

      const subject = `Suppressed ${reason} ${RUN}`
      const address = `prospect@buyer.example`

      await suppressEmail({ workspaceId, email: address, reason })

      // Enqueue refuses outright...
      const attempt = await enqueueEmail({
        workspaceId,
        accountId,
        toEmail: address,
        subject,
        bodyText: 'Should never arrive.',
        idempotencyKey: `supp-${reason}-${RUN}`,
      })
      expect(attempt.queued).toBe(false)
      if (!attempt.queued) expect(attempt.reason).toBe('suppressed')

      /*
       * ...and so does the CLAIM, which is the check that matters. A message
       * queued BEFORE the suppression existed must still not go out — that is
       * the race the in-claim check closes.
       */
      const db = adminClient()
      await db.from('email_suppressions').delete().eq('workspace_id', workspaceId)

      await enqueueEmail({
        workspaceId,
        accountId,
        toEmail: address,
        subject,
        bodyText: 'Queued before the unsubscribe.',
        idempotencyKey: `supp-race-${reason}-${RUN}`,
      })

      // The unsubscribe lands after the message is already in the queue.
      await suppressEmail({ workspaceId, email: address, reason })

      await runSendWorker(`worker-supp-${RUN}`)

      expect(await inboxCount(subject)).toBe(0)

      const { data: row } = await db
        .from('email_messages')
        .select('status, suppression_reason')
        .eq('workspace_id', workspaceId)
        .eq('idempotency_key', `supp-race-${reason}-${RUN}`)
        .single()

      expect(row!.status).toBe('suppressed')
      expect(row!.suppression_reason).toBe(reason)

      await db.from('email_suppressions').delete().eq('workspace_id', workspaceId)
    }, 60_000)
  }

  it('keeps the FIRST suppression reason when a second arrives', async ({ skip }) => {
    if (!ready()) return skip()

    const db = adminClient()
    const address = 'consent@buyer.example'

    await suppressEmail({ workspaceId, email: address, reason: 'unsubscribed' })
    await suppressEmail({ workspaceId, email: address, reason: 'hard_bounce' })

    const { data } = await db
      .from('email_suppressions')
      .select('reason')
      .eq('workspace_id', workspaceId)
      .eq('email', address)
      .single()

    /*
     * A stated wish outranks a delivery accident. Overwriting "unsubscribed"
     * with "hard_bounce" would lose the consent provenance that matters if the
     * customer is ever asked to prove why they stopped contacting someone.
     */
    expect(data!.reason).toBe('unsubscribed')

    await db.from('email_suppressions').delete().eq('workspace_id', workspaceId)
  }, 60_000)
})
