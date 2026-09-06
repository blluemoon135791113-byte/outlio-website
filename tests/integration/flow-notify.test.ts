/**
 * Slack and Teams notifications from a flow — M8 Phase 25.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  M8 CRITERION 9: "Slack/Teams Flow notification action DELIVERS ON        ║
 * ║  DOMAIN EVENTS."                                                          ║
 * ║                                                                           ║
 * ║  Proven against a real HTTP server standing in for Slack and for Teams,   ║
 * ║  driven through the real flow engine. A mocked fetch would prove the mock ║
 * ║  was called; what matters is that a NOTIFY step in a published flow puts  ║
 * ║  a correctly shaped body on the wire — and, just as much, that it puts    ║
 * ║  the FACT there and not the contents of anyone's message.                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { registerAllActions } from '@/lib/flows/actions'
import { advanceRun, startRun } from '@/lib/flows/engine'
import { notifyChannels } from '@/lib/notifications/send'
import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv } from './helpers'

const RUN = Date.now().toString(36)

type Received = { path: string; body: string }

let server: Server | null = null
let port = 0
let received: Received[] = []
/** Flipped by tests to make the channel fail. */
let respondWith = 200

let user: Awaited<ReturnType<typeof createAuthUser>> | null = null
let workspaceId = ''
let slackChannelId = ''
let contactId = ''

beforeAll(async () => {
  if (!hasSupabaseEnv) return
  registerAllActions()

  // A real endpoint, playing Slack.
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      received.push({ path: req.url ?? '', body })
      res.writeHead(respondWith).end('ok')
    })
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  port = (server!.address() as { port: number }).port

  user = await createAuthUser(`notify-${RUN}`)
  const db = adminClient()
  const { data: m } = await db
    .from('workspace_memberships').select('workspace_id').eq('user_id', user.id).single()
  workspaceId = m!.workspace_id

  const { data: channel, error } = await db
    .from('notification_channels')
    .insert({
      workspace_id: workspaceId,
      name: `#sales ${RUN}`,
      provider: 'slack',
      // Loopback over http is allowed by the constraint (0099) and by the SSRF
      // guard outside production — the split 0098 settled.
      url: `http://127.0.0.1:${port}/slack`,
      events: [],
      created_by: user.id,
    })
    .select('id').single()
  if (error) throw new Error(`channel insert failed: ${error.message}`)
  slackChannelId = channel.id

  const { data: contact, error: contactError } = await db
    .from('crm_contacts')
    .insert({
      workspace_id: workspaceId,
      first_name: 'Dana', last_name: 'Reyes',
      full_name: `Dana Reyes ${RUN}`,
    })
    .select('id').single()
  if (contactError) throw new Error(`contact insert failed: ${contactError.message}`)
  contactId = contact.id
}, 60_000)

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  if (!user) return
  const db = adminClient()
  await db.from('workspaces').delete().eq('id', workspaceId)
  await deleteTestUser(user.id)
})

/** Publishes a one-step NOTIFY flow and runs it against a contact. */
async function runNotifyFlow(config: Record<string, unknown>) {
  const db = adminClient()
  const { data: flow } = await db
    .from('flows')
    .insert({ workspace_id: workspaceId, name: `N ${RUN}-${Math.random().toString(36).slice(2, 6)}` })
    .select('id').single()

  await db.rpc('flow_publish', {
    p_workspace_id: workspaceId,
    p_flow_id: flow!.id,
    p_definition: {
      trigger: { type: 'manual', config: {} },
      entryStepId: 'notify',
      steps: [{ id: 'notify', type: 'ACTION', action: 'NOTIFY', next: null, config }],
    } as never,
  })

  const started = await startRun({
    workspaceId, flowId: flow!.id, triggerType: 'manual', contactId,
  })
  if (!started.started) throw new Error(`run did not start: ${started.detail}`)

  return { runId: started.runId, result: await advanceRun(workspaceId, started.runId) }
}

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('CRITERION 9 — a NOTIFY step delivers to a channel', () => {
  it('puts a Slack-shaped body on the wire when a flow reaches the step', async () => {
    received = []
    respondWith = 200

    const { runId, result } = await runNotifyFlow({ event: 'email.message.replied' })
    expect(result.status).toBe('completed')

    expect(received).toHaveLength(1)
    const body = JSON.parse(received[0]!.body)

    /*
     * ⚠️ THE FACT, NOT THE CONTENTS — the whole reason this module exists. A
     * Slack channel may include people with no CRM access at all.
     */
    expect(body.text).toContain('Dana Reyes')
    expect(body.text).toContain('replied')
    // ...and a deep link back to Outlio, where permissions still apply.
    expect(body.text).toContain(contactId)

    // The step's own record shows what happened, not just that it ran.
    const { data: step } = await adminClient()
      .from('flow_step_runs')
      .select('status, output')
      .eq('run_id', runId)
      .single()

    expect(step!.status).toBe('succeeded')
    expect((step!.output as { sent: number }).sent).toBe(1)
  }, 60_000)

  it('sends a Teams Adaptive Card to a Teams channel, not a Slack body', async () => {
    const db = adminClient()
    const { data: teams } = await db
      .from('notification_channels')
      .insert({
        workspace_id: workspaceId, name: `Teams ${RUN}`, provider: 'teams',
        url: `http://127.0.0.1:${port}/teams`, events: [], created_by: user!.id,
      })
      .select('id').single()

    received = []
    await runNotifyFlow({ event: 'crm.opportunity.won' })

    const toTeams = received.find((r) => r.path === '/teams')
    expect(toTeams).toBeDefined()

    const body = JSON.parse(toTeams!.body)
    expect(body.type).toBe('message')
    expect(body.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive')
    expect(body.attachments[0].content.body[0].text).toContain('Deal won')
    // Slack's field must not be present — it would render as nothing in Teams.
    expect(body.text).toBeUndefined()

    await db.from('notification_channels').delete().eq('id', teams!.id)
  }, 60_000)

  it('honours a channel that subscribed to only some events', async () => {
    const db = adminClient()
    const { data: narrow } = await db
      .from('notification_channels')
      .insert({
        workspace_id: workspaceId, name: `Narrow ${RUN}`, provider: 'slack',
        url: `http://127.0.0.1:${port}/narrow`,
        events: ['crm.opportunity.won'], created_by: user!.id,
      })
      .select('id').single()

    received = []
    await runNotifyFlow({ event: 'email.message.replied' })

    // The broad channel hears it; the narrow one asked only about deals.
    expect(received.some((r) => r.path === '/slack')).toBe(true)
    expect(received.some((r) => r.path === '/narrow')).toBe(false)

    await db.from('notification_channels').delete().eq('id', narrow!.id)
  }, 60_000)

  it('sends nothing to a paused channel, and does not count it as failed', async () => {
    const db = adminClient()
    await db.from('notification_channels').update({ is_active: false }).eq('id', slackChannelId)

    received = []
    const { runId } = await runNotifyFlow({ event: 'meeting.booked' })
    expect(received).toHaveLength(0)

    const { data: step } = await adminClient()
      .from('flow_step_runs').select('output').eq('run_id', runId).single()
    const output = step!.output as { sent: number; skipped: number; failed: number }
    expect(output.sent).toBe(0)
    expect(output.failed).toBe(0)
    // Paused is a choice, not a fault.
    expect(output.skipped).toBe(1)

    await db.from('notification_channels').update({ is_active: true }).eq('id', slackChannelId)
  }, 60_000)
})

describeIf('a broken channel does not break the business', () => {
  it('COMPLETES THE RUN when the channel is down, and records why', async () => {
    /*
     * ⚠️ THE MOST IMPORTANT TEST HERE. Nobody should be unable to win a deal
     * because Slack is having an afternoon. A notification is a side effect of
     * the work, never a precondition for it.
     */
    respondWith = 500
    received = []

    const { runId, result } = await runNotifyFlow({ event: 'crm.opportunity.won' })

    expect(received).toHaveLength(1) // it really did try
    expect(result.status).toBe('completed')

    const { data: step } = await adminClient()
      .from('flow_step_runs').select('status, output').eq('run_id', runId).single()
    expect(step!.status).toBe('succeeded')
    expect((step!.output as { failed: number }).failed).toBe(1)

    /*
     * ⚠️ AND THE FAILURE IS VISIBLE. A notification channel that has quietly
     * stopped working is indistinguishable from nothing happening — the worst
     * possible failure for a feature whose whole job is telling you something
     * happened.
     */
    const { data: channel } = await adminClient()
      .from('notification_channels')
      .select('failure_count, last_error').eq('id', slackChannelId).single()

    expect(channel!.failure_count).toBeGreaterThan(0)
    expect(channel!.last_error).toContain('500')

    respondWith = 200
  }, 60_000)

  it('clears the error once the channel recovers', async () => {
    respondWith = 200
    received = []

    await runNotifyFlow({ event: 'crm.opportunity.won' })

    const { data: channel } = await adminClient()
      .from('notification_channels')
      .select('failure_count, last_error, last_sent_at').eq('id', slackChannelId).single()

    expect(channel!.failure_count).toBe(0)
    // A stale error next to a working channel sends people debugging nothing.
    expect(channel!.last_error).toBeNull()
    expect(channel!.last_sent_at).not.toBeNull()
  }, 60_000)

  it('does not throw when a workspace has no channels at all', async () => {
    const db = adminClient()
    await db.from('notification_channels').delete().eq('workspace_id', workspaceId)

    received = []
    const { result } = await runNotifyFlow({ event: 'meeting.booked' })

    /*
     * A workspace that has not connected Slack must not have every flow
     * containing a notify step fail. The step did what it could.
     */
    expect(result.status).toBe('completed')
    expect(received).toHaveLength(0)

    // Put it back for anything that follows.
    const { data: restored } = await db
      .from('notification_channels')
      .insert({
        workspace_id: workspaceId, name: `#sales ${RUN}`, provider: 'slack',
        url: `http://127.0.0.1:${port}/slack`, events: [], created_by: user!.id,
      })
      .select('id').single()
    slackChannelId = restored!.id
  }, 60_000)
})

describeIf('a channel belongs to exactly one workspace', () => {
  it('NEVER delivers another workspace’s event, even given the channel id', async () => {
    /*
     * ⚠️ THE SERVICE ROLE BYPASSES RLS, so an id alone is not authorisation.
     * Every query in `notifyChannels` is scoped by `workspace_id` in code, and
     * this is what proves it: a real channel id, the wrong workspace, and the
     * targeted-send path that skips the event filter.
     */
    const other = await createAuthUser(`notify-other-${RUN}`)
    const db = adminClient()
    const { data: m } = await db
      .from('workspace_memberships').select('workspace_id').eq('user_id', other.id).single()

    received = []
    const result = await notifyChannels(
      m!.workspace_id,
      'crm.opportunity.won',
      { title: 'Should never arrive' },
      { onlyChannelId: slackChannelId },
    )

    expect(result.sent).toBe(0)
    expect(received).toHaveLength(0)

    await db.from('workspaces').delete().eq('id', m!.workspace_id)
    await deleteTestUser(other.id)
  }, 60_000)
})
