/**
 * Email actions inside flows — M7 Phase 21.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  These run against the real database and need NO mail server, because     ║
 * ║  `SEND_EMAIL` QUEUES rather than sends. That is itself the design point:  ║
 * ║  a flow gets no private path to SMTP, so it inherits suppression          ║
 * ║  re-checking at claim time, the ramp, the sending window and at-most-once ║
 * ║  delivery from the same engine everything else uses.                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { normalizeEmail } from '@/lib/crm/normalize'
import { encryptIntegrationSecret } from '@/lib/integrations/crypto'
import { registerAllActions } from '@/lib/flows/actions'
import { advanceRun, startRun } from '@/lib/flows/engine'
import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv } from './helpers'

const RUN = Date.now().toString(36)

let user: Awaited<ReturnType<typeof createAuthUser>> | null = null
let workspaceId = ''
let accountId = ''

beforeAll(async () => {
  if (!hasSupabaseEnv) return
  registerAllActions()

  user = await createAuthUser(`flowmail-${RUN}`)
  const db = adminClient()
  const { data: m } = await db
    .from('workspace_memberships').select('workspace_id').eq('user_id', user.id).single()
  workspaceId = m!.workspace_id

  const { data: acct, error } = await db
    .from('email_accounts')
    .insert({
      workspace_id: workspaceId, provider: 'smtp', scope: 'workspace',
      owner_user_id: user.id, display_name: 'Flow mailbox',
      from_email: 'sender@acme.example', from_domain: 'acme.example',
      status: 'ramping',
      configuration: { smtpHost: 'localhost', smtpPort: 2525 },
      send_days: [1, 2, 3, 4, 5, 6, 7],
      send_window_start: '00:00', send_window_end: '23:59',
      min_delay_seconds: 0, timezone: 'UTC',
      ramp_started_on: new Date().toISOString().slice(0, 10),
      ramp_initial_daily: 50,
    })
    .select('id, secret_reference').single()
  if (error) throw new Error(`account insert failed: ${error.message}`)
  accountId = acct.id

  await db.from('email_account_secrets').insert({
    id: acct.secret_reference, account_id: acct.id,
    encrypted_payload: encryptIntegrationSecret({ smtpUsername: 's', smtpPassword: 'p' }),
  })
}, 60_000)

afterAll(async () => {
  if (!user) return
  const db = adminClient()
  await db.from('email_account_secrets').delete().eq('account_id', accountId)
  await db.from('workspaces').delete().eq('id', workspaceId)
  await deleteTestUser(user.id)
})

/** A contact with an address, optionally suppressed. */
async function makeContact(opts: { suppressed?: boolean; withEmail?: boolean } = {}) {
  const db = adminClient()
  const stamp = `${RUN}-${Math.random().toString(36).slice(2, 8)}`
  const email = `p+${stamp}@buyer.example`

  const { data: contact } = await db
    .from('crm_contacts')
    .insert({
      workspace_id: workspaceId, first_name: 'Dana', last_name: 'Reyes',
      full_name: `Dana Reyes ${stamp}`,
    })
    .select('id').single()

  if (opts.withEmail !== false) {
    /*
     * ⚠️ `identity_key` IS REQUIRED and comes from the real normalizer. An
     * earlier version of this fixture omitted it, the insert failed silently
     * because the error was not checked, and every send test then failed with
     * NO_RECIPIENT — looking like a gate bug rather than a fixture one.
     */
    const identity = normalizeEmail(email)
    const { error } = await db.from('crm_contact_emails').insert({
      workspace_id: workspaceId, contact_id: contact!.id,
      address: identity!.address, identity_key: identity!.identityKey, is_primary: true,
    })
    if (error) throw new Error(`contact email insert failed: ${error.message}`)
  }

  if (opts.suppressed) {
    await db.from('email_suppressions').insert({
      workspace_id: workspaceId, email, reason: 'unsubscribed',
    })
  }

  return { contactId: contact!.id as string, email }
}

async function runFlow(definition: unknown, contactId: string) {
  const db = adminClient()
  const { data: flow } = await db
    .from('flows')
    .insert({ workspace_id: workspaceId, name: `F ${RUN}-${Math.random().toString(36).slice(2, 6)}` })
    .select('id').single()

  await db.rpc('flow_publish', {
    p_workspace_id: workspaceId, p_flow_id: flow!.id, p_definition: definition as never,
  })

  const started = await startRun({
    workspaceId, flowId: flow!.id, triggerType: 'manual', contactId,
  })
  if (!started.started) throw new Error(`run did not start: ${started.detail}`)

  const result = await advanceRun(workspaceId, started.runId)
  return { runId: started.runId, result }
}

function sendStep(over: Record<string, unknown> = {}) {
  return {
    trigger: { type: 'manual', config: {} },
    entryStepId: 'send',
    steps: [{
      id: 'send', type: 'ACTION', action: 'SEND_EMAIL', next: null,
      config: {
        accountId,
        subject: 'Quick question, {{first_name|there}}',
        body: 'Hi {{first_name|there}} — worth a chat?',
        actorAuthorized: true,
        __stepId: 'send',
        ...over,
      },
    }],
  }
}

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('SEND_EMAIL passes the six-condition gate', () => {
  it('queues a message when every condition is met', async () => {
    const { contactId, email } = await makeContact()
    const { result } = await runFlow(sendStep(), contactId)

    expect(result.status).toBe('completed')

    const { data: message } = await adminClient()
      .from('email_messages')
      .select('to_email, subject, body_text, status')
      .eq('workspace_id', workspaceId).eq('to_email', email).maybeSingle()

    expect(message).not.toBeNull()
    expect(message!.status).toBe('queued')
    // The template rendered against the real contact.
    expect(message!.subject).toBe('Quick question, Dana')
    expect(message!.body_text).toContain('Hi Dana')
  }, 90_000)

  it('REFUSES a suppressed recipient, and queues nothing', async () => {
    const { contactId, email } = await makeContact({ suppressed: true })
    const { result } = await runFlow(sendStep(), contactId)

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('SUPPRESSED')

    const { count } = await adminClient()
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).eq('to_email', email)
    expect(count ?? 0).toBe(0)
  }, 90_000)

  it('refuses a contact with no email address', async () => {
    const { contactId } = await makeContact({ withEmail: false })
    const { result } = await runFlow(sendStep(), contactId)

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('NO_RECIPIENT')
  }, 90_000)

  it('refuses when the flow is not authorized to send', async () => {
    /*
     * A flow runs unattended, so the permission belongs to whoever published
     * it. Absent means NOT authorized — this gate fails closed.
     */
    const { contactId } = await makeContact()
    const { result } = await runFlow(sendStep({ actorAuthorized: false }), contactId)

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('NOT_AUTHORIZED')
  }, 90_000)

  it('refuses when no mailbox is configured on the step', async () => {
    const { contactId } = await makeContact()
    const { result } = await runFlow(sendStep({ accountId: null }), contactId)

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('PROVIDER_NOT_CONNECTED')
  }, 90_000)

  it('refuses to send rather than mailing "Hi ," when a variable is missing', async () => {
    const { contactId } = await makeContact()
    const { result } = await runFlow(
      // No fallback on this one, and the contact has no job title.
      sendStep({ body: 'As a {{job_title}}, worth a chat?' }),
      contactId,
    )

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('MISSING_VARIABLES')
    // The message tells the author how to fix it.
    expect(result.error?.message).toContain('{{first_name|there}}')
  }, 90_000)
})

describeIf('SEND_EMAIL is idempotent per run and step', () => {
  it('queues one message even when the step runs twice', async () => {
    const { contactId, email } = await makeContact()
    const { runId, result } = await runFlow(sendStep(), contactId)
    expect(result.status).toBe('completed')

    /*
     * Re-drive the same run, as a restarted worker would. The step claim
     * already exists, so the action does not repeat — and even if it did, the
     * idempotency key is derived from run + step, so `enqueueEmail` would
     * return `duplicate` rather than queue a second message.
     */
    await advanceRun(workspaceId, runId)

    const { count } = await adminClient()
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).eq('to_email', email)

    expect(count).toBe(1)
  }, 90_000)
})

describeIf('sequence controls', () => {
  it('enrols a contact, and skips one who is suppressed', async () => {
    const db = adminClient()
    const { data: campaign } = await db
      .from('email_campaigns')
      .insert({
        workspace_id: workspaceId, name: `Seq ${RUN}`, type: 'sales_sequence',
        status: 'running', account_id: accountId,
      })
      .select('id').single()

    const definition = {
      trigger: { type: 'manual', config: {} },
      entryStepId: 'enrol',
      steps: [{
        id: 'enrol', type: 'ACTION', action: 'ENROLL_SEQUENCE', next: null,
        config: { campaignId: campaign!.id },
      }],
    }

    const healthy = await makeContact()
    const { runId } = await runFlow(definition, healthy.contactId)

    const { data: enrolled } = await db
      .from('email_enrollments')
      .select('id').eq('campaign_id', campaign!.id).eq('contact_id', healthy.contactId)
    expect(enrolled!.length).toBe(1)

    const { data: step } = await db
      .from('flow_step_runs').select('output').eq('run_id', runId).single()
    expect((step!.output as { enrolled?: boolean }).enrolled).toBe(true)

    // A suppressed contact is SKIPPED with a reason, not enrolled and not a
    // hard failure — the run continues past it.
    const blocked = await makeContact({ suppressed: true })
    const second = await runFlow(definition, blocked.contactId)
    expect(second.result.status).toBe('completed')

    const { data: notEnrolled } = await db
      .from('email_enrollments')
      .select('id').eq('campaign_id', campaign!.id).eq('contact_id', blocked.contactId)
    expect(notEnrolled!.length).toBe(0)

    const { data: skipStep } = await db
      .from('flow_step_runs').select('output').eq('run_id', second.runId).single()
    const output = skipStep!.output as { enrolled?: boolean; skipped?: string }
    expect(output.enrolled).toBe(false)
    expect(output.skipped).toContain('do-not-contact')
  }, 120_000)
})
