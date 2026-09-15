/**
 * Outbound webhook delivery — M8 Phase 25.5.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  M8 CRITERION 8: "outbound webhooks are SIGNED, RETRIED WITH BACKOFF,     ║
 * ║  IDEMPOTENT FOR CONSUMERS, with VISIBLE DELIVERY LOGS."                   ║
 * ║                                                                           ║
 * ║  All four are tested against a real HTTP server acting as the customer's  ║
 * ║  endpoint — one that fails, then recovers. A mocked fetch would prove the ║
 * ║  mock was called; what matters is that a consumer receives a verifiable   ║
 * ║  signature and the SAME event id on every retry.                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { verifyWebhookSignature } from '@/lib/api/signing'
import { deliverPendingWebhooks, publishEvent } from '@/lib/api/webhooks'
import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv } from './helpers'

const RUN = Date.now().toString(36)
const SECRET = `whsec_${RUN}`

type Received = {
  body: string
  eventId: string | undefined
  signature: string | undefined
  attempt: string | undefined
}

let server: Server | null = null
let port = 0
let received: Received[] = []
/** Flipped by tests to make the consumer fail. */
let respondWith = 200

let user: Awaited<ReturnType<typeof createAuthUser>> | null = null
let workspaceId = ''
let subscriptionId = ''

beforeAll(async () => {
  if (!hasSupabaseEnv) return

  // A real endpoint, playing the customer's consumer.
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      received.push({
        body,
        eventId: req.headers['outlio-event-id'] as string | undefined,
        signature: req.headers['outlio-signature'] as string | undefined,
        attempt: req.headers['outlio-delivery-attempt'] as string | undefined,
      })
      res.writeHead(respondWith).end('ok')
    })
  })

  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  port = (server!.address() as { port: number }).port

  user = await createAuthUser(`hook-${RUN}`)
  const db = adminClient()
  const { data: m } = await db
    .from('workspace_memberships').select('workspace_id').eq('user_id', user.id).single()
  workspaceId = m!.workspace_id

  const { data: sub, error } = await db
    .from('webhook_subscriptions')
    .insert({
      workspace_id: workspaceId,
      name: `Test endpoint ${RUN}`,
      // The check constraint requires https; localhost is fine for the test
      // because `deliverPendingWebhooks` does not inspect the scheme.
      url: `http://127.0.0.1:${port}/hook`,
      signing_secret: SECRET,
      events: [],
      created_by: user.id,
    })
    .select('id').single()

  if (error) throw new Error(`subscription insert failed: ${error.message}`)
  subscriptionId = sub.id
}, 60_000)

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  if (!user) return
  const db = adminClient()
  await db.from('workspaces').delete().eq('id', workspaceId)
  await deleteTestUser(user.id)
})

/**
 * Pulls a delivery's next attempt into the past.
 *
 * ⚠️ SIMULATES TIME PASSING RATHER THAN WAITING. The real backoff is 30s, 2m,
 * 8m — a test that waited would take twenty minutes. The BACKOFF ITSELF is
 * asserted separately by reading `next_attempt_at`, so nothing about the delay
 * goes unverified.
 */
async function makeDue(id: string) {
  await adminClient()
    .from('webhook_deliveries')
    .update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() })
    .eq('id', id)
}

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('CRITERION 8 — signed, retried, idempotent, logged', () => {
  it('delivers a signed payload the documented verifier accepts', async () => {
    received = []
    respondWith = 200

    const queued = await publishEvent(workspaceId, 'crm.contact.created', {
      id: 'contact-1',
      full_name: 'Dana Reyes',
    })
    expect(queued).toBe(1)

    const outcome = await deliverPendingWebhooks()
    expect(outcome.delivered).toBe(1)

    expect(received).toHaveLength(1)
    const delivery = received[0]!

    /*
     * ⚠️ VERIFIED WITH THE FUNCTION WE HAND CUSTOMERS. If our signer and the
     * documented verifier ever disagree, every integration fails in a way
     * people will blame on themselves.
     */
    expect(verifyWebhookSignature(delivery.body, delivery.signature!, SECRET)).toBe(true)

    // ...and a wrong secret must not verify.
    expect(verifyWebhookSignature(delivery.body, delivery.signature!, 'wrong')).toBe(false)

    const payload = JSON.parse(delivery.body)
    expect(payload.type).toBe('crm.contact.created')
    expect(payload.data.full_name).toBe('Dana Reyes')
    expect(payload.id).toBe(delivery.eventId)
  }, 60_000)

  it('retries with GROWING backoff, and sends the SAME event id every time', async () => {
    received = []
    respondWith = 500 // the consumer is down

    await publishEvent(workspaceId, 'crm.opportunity.won', { id: 'opp-1' })

    const db = adminClient()
    const { data: pending } = await db
      .from('webhook_deliveries')
      .select('id, event_id')
      .eq('subscription_id', subscriptionId)
      .eq('event_type', 'crm.opportunity.won')
      .single()

    const delays: number[] = []

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await makeDue(pending!.id)
      const before = Date.now()
      await deliverPendingWebhooks()

      const { data: row } = await db
        .from('webhook_deliveries')
        .select('attempts, status, next_attempt_at, last_status_code, last_error')
        .eq('id', pending!.id).single()

      expect(row!.attempts).toBe(attempt)
      expect(row!.status).toBe('pending')
      // The endpoint's own answer is recorded for the customer's debugging.
      expect(row!.last_status_code).toBe(500)
      expect(row!.last_error).toContain('500')

      delays.push(new Date(row!.next_attempt_at).getTime() - before)
    }

    // ⚠️ BACKOFF, not a fixed interval: each wait is longer than the last.
    expect(delays[1]).toBeGreaterThan(delays[0]!)
    expect(delays[2]).toBeGreaterThan(delays[1]!)

    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ THE JITTER RANGE, NOT THE BASE SCHEDULE. THIS TEST USED TO FAIL   ║
     * ║  ROUGHLY NINE RUNS IN TEN, AND THE CODE WAS ALWAYS RIGHT.             ║
     * ║                                                                       ║
     * ║  It asserted `delays[0] > 25s` and `delays[2] > 7m` against a comment  ║
     * ║  reading "roughly 30s, 2m, 8m" — the BASE schedule. But                ║
     * ║  `backoffSecondsWithJitter` deliberately returns `[base/2, base)`, so  ║
     * ║  the real windows are 15-30s and 4-8m. The first assertion passed      ║
     * ║  about a third of the time, the third about a quarter; together        ║
     * ║  roughly 8%.                                                          ║
     * ║                                                                       ║
     * ║  The run that surfaced it measured 23,544ms — squarely inside the      ║
     * ║  documented window and reported as a defect.                          ║
     * ║                                                                       ║
     * ║  ⚠️ AND THE JITTER IS THE POINT, NOT AN IMPRECISION. §5.13 asks for    ║
     * ║  "exponential backoff + jitter" because `publishEvent` fans one event  ║
     * ║  to every subscriber in the same instant; without spread they all      ║
     * ║  retry in lockstep. A test that demands the undithered number is       ║
     * ║  asking for the bug back.                                             ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     *
     * ⚠️ BOUNDS ONLY, AND THEY CANNOT SEE A JITTER THAT STOPPED DITHERING.
     * Proven by mutation: making `backoffSecondsWithJitter` return the base
     * exactly still passes here, because the base is inside the window. That is
     * correct for a bounds check and worth stating, because the obvious comment
     * to write — "this catches a jitter that stopped" — would be false.
     *
     * The dithering itself belongs to `api-signing.test.ts`, which injects
     * `random` and can therefore pin it: `backoffSecondsWithJitter(1, () => 0)`
     * is exactly 15, and a separate case asserts two deliveries failing in the
     * same instant come out spread. Deterministic, free, and in the fast loop.
     *
     * What THIS test owns is the part a unit test cannot reach: that the
     * computed delay actually arrives in `next_attempt_at` in the database,
     * within the documented window. An overshoot fails here — mutation
     * confirmed.
     */
    const windows = [
      { label: '30s', base: 30_000 },
      { label: '2m', base: 120_000 },
      { label: '8m', base: 480_000 },
    ]
    windows.forEach(({ label, base }, index) => {
      const delay = delays[index]!
      // A little slack for the round trip between `before` and the DB write.
      expect(delay, `attempt ${index + 1} (${label}) below the jitter floor`).toBeGreaterThan(
        base / 2 - 2_000,
      )
      expect(delay, `attempt ${index + 1} (${label}) above the documented ceiling`).toBeLessThan(
        base + 2_000,
      )
    })

    /*
     * ⚠️ THE CRITERION'S HARDEST PART. Three attempts, ONE event id — which is
     * the whole of what we can offer toward "idempotent for consumers". A new
     * id per attempt would make each retry look like a fresh event, and a
     * consumer doing the right thing would still double-process.
     */
    expect(received).toHaveLength(3)
    const ids = new Set(received.map((r) => r.eventId))
    expect(ids.size).toBe(1)
    expect([...ids][0]).toBe(pending!.event_id)

    // The attempt number IS incremented, so a consumer can tell a retry from
    // a first delivery even though the event is the same.
    expect(received.map((r) => r.attempt)).toEqual(['1', '2', '3'])
  }, 120_000)

  it('succeeds once the consumer recovers, and clears the failure count', async () => {
    received = []
    respondWith = 500

    /*
     * ⚠️ ANY WIRED EVENT WILL DO — what is under test is retry mechanics, not
     * this event. It used to be `meeting.booked`, which was WITHDRAWN from the
     * catalogue on 2026-09-13 (DECISION-18) because nothing publishes it.
     * `crm.task.completed` is unused elsewhere in this file, so the
     * `.single()` lookup below still matches exactly one row.
     */
    await publishEvent(workspaceId, 'crm.task.completed', { id: 'task-1' })
    const db = adminClient()
    const { data: pending } = await db
      .from('webhook_deliveries')
      .select('id').eq('event_type', 'crm.task.completed').single()

    await makeDue(pending!.id)
    await deliverPendingWebhooks()

    // The endpoint comes back.
    respondWith = 200
    await makeDue(pending!.id)
    await deliverPendingWebhooks()

    const { data: row } = await db
      .from('webhook_deliveries')
      .select('status, delivered_at, attempts, last_error')
      .eq('id', pending!.id).single()

    expect(row!.status).toBe('delivered')
    expect(row!.delivered_at).not.toBeNull()
    expect(row!.attempts).toBe(2)
    // The old error is cleared, so the log does not show a delivered event
    // alongside a stale failure.
    expect(row!.last_error).toBeNull()

    const { data: sub } = await db
      .from('webhook_subscriptions')
      .select('failure_count').eq('id', subscriptionId).single()
    expect(sub!.failure_count).toBe(0)
  }, 120_000)

  it('gives up after max attempts rather than retrying forever', async () => {
    received = []
    respondWith = 500

    await publishEvent(workspaceId, 'email.message.bounced', { id: 'msg-1' })
    const db = adminClient()
    const { data: pending } = await db
      .from('webhook_deliveries')
      .select('id, max_attempts').eq('event_type', 'email.message.bounced').single()

    for (let i = 0; i < pending!.max_attempts; i += 1) {
      await makeDue(pending!.id)
      await deliverPendingWebhooks()
    }

    const { data: row } = await db
      .from('webhook_deliveries')
      .select('status, attempts').eq('id', pending!.id).single()

    expect(row!.status).toBe('exhausted')
    expect(row!.attempts).toBe(pending!.max_attempts)

    // And it is not picked up again.
    await makeDue(pending!.id)
    const outcome = await deliverPendingWebhooks()
    expect(outcome.delivered).toBe(0)
  }, 180_000)

  it('leaves a delivery log the customer can read', async () => {
    /*
     * "Visible delivery logs" is the half people skip. Without it a customer
     * whose endpoint is quietly rejecting everything has no way to find out.
     */
    const { data: log } = await adminClient()
      .from('webhook_deliveries')
      .select('event_type, status, attempts, last_status_code, last_error, delivered_at')
      .eq('subscription_id', subscriptionId)
      .order('created_at', { ascending: false })

    expect(log!.length).toBeGreaterThanOrEqual(4)
    expect(log!.some((d) => d.status === 'delivered' && d.delivered_at)).toBe(true)
    expect(log!.some((d) => d.status === 'exhausted')).toBe(true)
    // Every failed row explains itself.
    for (const row of log!.filter((d) => d.status !== 'delivered')) {
      expect(row.last_error).toBeTruthy()
    }
  }, 60_000)
})

describeIf('subscription filtering', () => {
  it('only sends events a subscription asked for', async () => {
    const db = adminClient()
    const { data: narrow } = await db
      .from('webhook_subscriptions')
      .insert({
        workspace_id: workspaceId,
        name: `Narrow ${RUN}`,
        url: `http://127.0.0.1:${port}/narrow`,
        signing_secret: SECRET,
        events: ['crm.contact.created'],
        created_by: user!.id,
      })
      .select('id').single()

    await publishEvent(workspaceId, 'crm.opportunity.won', { id: 'opp-2' })

    const { count } = await db
      .from('webhook_deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('subscription_id', narrow!.id)

    // It subscribed to contacts only, so an opportunity event queues nothing.
    expect(count).toBe(0)

    await db.from('webhook_subscriptions').delete().eq('id', narrow!.id)
  }, 60_000)

  it('sends nothing to an inactive subscription', async () => {
    const db = adminClient()
    await db.from('webhook_subscriptions').update({ is_active: false }).eq('id', subscriptionId)

    const queued = await publishEvent(workspaceId, 'crm.contact.created', { id: 'c-9' })
    expect(queued).toBe(0)

    await db.from('webhook_subscriptions').update({ is_active: true }).eq('id', subscriptionId)
  }, 60_000)
})
