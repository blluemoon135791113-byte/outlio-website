/**
 * Readiness and ramp enforcement, end to end — M5 Phase 13.
 *
 * M5 ACCEPTANCE CRITERION 5: "readiness state transitions + domain rollup
 * covered by tests; **ramp limits enforced by scheduler**."
 *
 * The state-transition half is unit-tested in `tests/unit/email-readiness.test.ts`
 * and the rollup SQL in `supabase/smoke/0087_email_readiness.sql`. What can
 * only be proven here is that the limits are actually WIRED IN — that a
 * mailbox over its allowance is refused by the real enqueue path, and that an
 * unhealthy mailbox is refused by the real safety gate.
 *
 * Needs Supabase env. GreenMail is optional: the mailbox is only used to reach
 * a connection state, so the ramp assertions run either way.
 */
import { createConnection } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { encryptIntegrationSecret } from '@/lib/integrations/crypto'
import { assessAccount, getDomainHealth, isAccountSendable } from '@/lib/email/readiness-runner'
import { enqueueEmail } from '@/lib/email/send'
import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv } from './helpers'

const RUN = Date.now().toString(36)
const SMTP_PORT = 2525

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

let user: Awaited<ReturnType<typeof createAuthUser>> | null = null
let workspaceId = ''
let accountId = ''
let secondAccountId = ''
let mailUp = false

async function makeAccount(
  label: string,
  fromEmail: string,
  domain: string,
  over: Record<string, unknown> = {},
): Promise<string> {
  const db = adminClient()
  const { data, error } = await db
    .from('email_accounts')
    .insert({
      workspace_id: workspaceId,
      provider: 'smtp',
      scope: 'workspace',
      owner_user_id: user!.id,
      display_name: label,
      from_email: fromEmail,
      from_domain: domain,
      status: 'ramping',
      configuration: { smtpHost: 'localhost', smtpPort: SMTP_PORT },
      send_days: [1, 2, 3, 4, 5, 6, 7],
      send_window_start: '00:00',
      send_window_end: '23:59',
      min_delay_seconds: 0,
      timezone: 'UTC',
      ...over,
    })
    .select('id, secret_reference')
    .single()

  if (error) throw new Error(`account insert failed: ${error.message}`)

  await db.from('email_account_secrets').insert({
    id: data.secret_reference,
    account_id: data.id,
    encrypted_payload: encryptIntegrationSecret({
      smtpUsername: 'sender',
      smtpPassword: 'senderpw',
    }),
  })

  return data.id
}

beforeAll(async () => {
  if (!hasSupabaseEnv) return
  mailUp = await reachable(SMTP_PORT)

  user = await createAuthUser(`ready-${RUN}`)
  const db = adminClient()
  const { data: m } = await db
    .from('workspace_memberships')
    .select('workspace_id')
    .eq('user_id', user.id)
    .single()
  workspaceId = m!.workspace_id

  // A tiny ramp so the limit is reachable in a test rather than after 20 sends.
  accountId = await makeAccount('Ramped', 'sender@acme.example', 'acme.example', {
    ramp_enabled: true,
    ramp_started_on: new Date().toISOString().slice(0, 10),
    ramp_initial_daily: 2,
    ramp_daily_increment: 1,
    ramp_target_daily: 50,
  })

  secondAccountId = await makeAccount('Other domain', 'rep@other.example', 'other.example')
}, 60_000)

afterAll(async () => {
  if (!user) return
  const db = adminClient()
  await db.from('email_readiness_checks').delete().eq('workspace_id', workspaceId)
  await db.from('email_domain_checks').delete().eq('workspace_id', workspaceId)
  await db.from('email_messages').delete().eq('workspace_id', workspaceId)
  await db.from('email_suppressions').delete().eq('workspace_id', workspaceId)
  for (const id of [accountId, secondAccountId]) {
    await db.from('email_account_secrets').delete().eq('account_id', id)
  }
  await db.from('email_accounts').delete().eq('workspace_id', workspaceId)
  await deleteTestUser(user.id)
})

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('CRITERION 5 — ramp limits are enforced by the scheduler', () => {
  it('refuses to queue once the day’s allowance is used', async () => {
    const db = adminClient()

    // Two messages already sent today: exactly the opening allowance.
    for (let i = 0; i < 2; i += 1) {
      await db.from('email_messages').insert({
        workspace_id: workspaceId,
        account_id: accountId,
        to_email: `already-${i}@buyer.example`,
        subject: 'Earlier today',
        body_text: 'b',
        idempotency_key: `ramp-used-${i}-${RUN}`,
        status: 'sent',
        sent_at: new Date().toISOString(),
      })
    }

    const result = await enqueueEmail({
      workspaceId,
      accountId,
      toEmail: 'prospect@buyer.example',
      subject: 'Over the limit',
      bodyText: 'b',
      idempotencyKey: `ramp-blocked-${RUN}`,
    })

    expect(result.queued).toBe(false)
    if (!result.queued && result.reason === 'daily_limit') {
      expect(result.allowance).toBe(2)
      expect(result.sentToday).toBe(2)
      // The message explains the ramp rather than reading as a hard failure.
      expect(result.message).toContain('rises by 1 a day')
    } else {
      throw new Error(`expected daily_limit, got ${JSON.stringify(result)}`)
    }

    // ...and nothing was written. A refused enqueue must not leave a row that
    // quietly sends later.
    const { count } = await db
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('idempotency_key', `ramp-blocked-${RUN}`)
    expect(count ?? 0).toBe(0)
  }, 60_000)

  it('allows a mailbox that is under its allowance', async () => {
    const result = await enqueueEmail({
      workspaceId,
      accountId: secondAccountId,
      toEmail: 'prospect@buyer.example',
      subject: 'Within limits',
      bodyText: 'b',
      idempotencyKey: `ramp-ok-${RUN}`,
    })
    expect(result.queued).toBe(true)
  }, 60_000)

  it('counts only TODAY’s sends against the allowance', async () => {
    const db = adminClient()

    // A send from last week must not consume today's budget.
    await db.from('email_messages').insert({
      workspace_id: workspaceId,
      account_id: secondAccountId,
      to_email: 'old@buyer.example',
      subject: 'Last week',
      body_text: 'b',
      idempotency_key: `ramp-old-${RUN}`,
      status: 'sent',
      sent_at: new Date(Date.now() - 7 * 86_400_000).toISOString(),
    })

    const result = await enqueueEmail({
      workspaceId,
      accountId: secondAccountId,
      toEmail: 'prospect@buyer.example',
      subject: 'Still fine',
      bodyText: 'b',
      idempotencyKey: `ramp-today-${RUN}`,
    })
    expect(result.queued).toBe(true)
  }, 60_000)
})

describeIf('the campaign safety gate', () => {
  it('does not block a mailbox that has never been assessed', async () => {
    /*
     * Refusing here would make the first campaign after connecting a mailbox
     * fail for a reason the customer cannot act on. The sweep catches up.
     */
    const gate = await isAccountSendable(workspaceId, secondAccountId)
    expect(gate.sendable).toBe(true)
  }, 30_000)

  it('blocks sending once an assessment records a blocking state', async () => {
    const db = adminClient()
    await db.from('email_readiness_checks').insert({
      workspace_id: workspaceId,
      account_id: secondAccountId,
      state: 'authentication_required',
      score: 10,
      checks: [],
    })

    const gate = await isAccountSendable(workspaceId, secondAccountId)
    expect(gate.sendable).toBe(false)
    expect(gate.reason).toContain('Reconnect')

    // And the real enqueue path honours it.
    const result = await enqueueEmail({
      workspaceId,
      accountId: secondAccountId,
      toEmail: 'prospect@buyer.example',
      subject: 'Should be refused',
      bodyText: 'b',
      idempotencyKey: `gate-blocked-${RUN}`,
    })
    expect(result.queued).toBe(false)
    if (!result.queued) expect(result.reason).toBe('unhealthy')

    await db.from('email_readiness_checks').delete().eq('account_id', secondAccountId)
  }, 60_000)

  it('blocks on a failed complaint rate but not on a mere warning', async () => {
    const db = adminClient()

    // `warning` covers both "above the line" and "past the gate". The recorded
    // checks decide which, so the gate re-derives it.
    await db.from('email_readiness_checks').insert({
      workspace_id: workspaceId,
      account_id: secondAccountId,
      state: 'warning',
      score: 60,
      checks: [{ id: 'complaint_rate', label: 'Complaint rate', status: 'warn', weight: 5, detail: 'x' }],
    })
    expect((await isAccountSendable(workspaceId, secondAccountId)).sendable).toBe(true)

    await db.from('email_readiness_checks').delete().eq('account_id', secondAccountId)
    await db.from('email_readiness_checks').insert({
      workspace_id: workspaceId,
      account_id: secondAccountId,
      state: 'warning',
      score: 40,
      checks: [{ id: 'complaint_rate', label: 'Complaint rate', status: 'fail', weight: 5, detail: 'x' }],
    })

    const gate = await isAccountSendable(workspaceId, secondAccountId)
    expect(gate.sendable).toBe(false)
    expect(gate.reason).toContain('spam')

    await db.from('email_readiness_checks').delete().eq('account_id', secondAccountId)
  }, 60_000)
})

describeIf('assessment records history and rolls up per domain', () => {
  it('assesses a real mailbox and writes an explained result', async ({ skip }) => {
    if (!mailUp) return skip()

    const result = await assessAccount(workspaceId, accountId)
    expect(result).not.toBeNull()

    // The score never ships without its explanation.
    expect(result!.checks.length).toBeGreaterThan(0)
    expect(result!.checks.every((c) => c.detail.length > 0)).toBe(true)

    // The connection genuinely worked against GreenMail.
    expect(result!.checks.find((c) => c.id === 'connection')!.status).toBe('pass')

    const { data: rows } = await adminClient()
      .from('email_readiness_checks')
      .select('score, state, daily_limit')
      .eq('account_id', accountId)
    expect(rows!.length).toBeGreaterThan(0)
    expect(rows![0]!.daily_limit).toBe(2)
  }, 90_000)

  it('rolls health up per domain, worst first', async ({ skip }) => {
    if (!mailUp) return skip()

    const db = adminClient()
    await db.from('email_readiness_checks').delete().eq('workspace_id', workspaceId)

    await db.from('email_readiness_checks').insert([
      { workspace_id: workspaceId, account_id: accountId, state: 'ready', score: 95, checks: [] },
      { workspace_id: workspaceId, account_id: secondAccountId, state: 'warning', score: 35, checks: [] },
    ])

    const health = await getDomainHealth(workspaceId)
    expect(health).toHaveLength(2)
    // Worst domain first, so the thing needing attention is at the top.
    expect(health[0]!.domain).toBe('other.example')
    expect(health[0]!.worstScore).toBe(35)
    expect(health[1]!.domain).toBe('acme.example')
  }, 60_000)
})
