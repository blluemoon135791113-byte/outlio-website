import 'server-only'

/**
 * Outbound webhooks — M8 Phase 25.5.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  M8 CRITERION 8: "signed, retried with backoff, IDEMPOTENT FOR CONSUMERS, ║
 * ║  with visible delivery logs."                                             ║
 * ║                                                                           ║
 * ║  The idempotency half is the one that is easy to get wrong, because it is ║
 * ║  not about us. WE cannot make a consumer's handler idempotent — only they ║
 * ║  can. What we owe them is a STABLE EVENT ID that survives every retry, so ║
 * ║  that "have I already processed this?" is answerable on their side. A new ║
 * ║  id per attempt makes each retry look like a fresh event, and a consumer  ║
 * ║  doing the right thing would still double-process.                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { backoffSeconds, signWebhookPayload, type WebhookEvent } from '@/lib/api/signing'
import { assertSafeWebhookUrl, UnsafeWebhookUrlError } from '@/lib/api/webhook-url'

export { backoffSeconds, signWebhookPayload, WEBHOOK_EVENTS } from '@/lib/api/signing'
export type { WebhookEvent } from '@/lib/api/signing'

export type DeliveryOutcome = {
  delivered: number
  retrying: number
  exhausted: number
}

/**
 * Publishes a domain event to every subscriber.
 *
 * ⚠️ FIRE AND FORGET FROM THE CALLER'S POINT OF VIEW. Nothing in the CRM waits
 * on a customer's endpoint: a slow subscriber must never slow down creating a
 * contact. Rows are queued here and delivered by the worker below.
 */
export async function publishEvent(
  workspaceId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<number> {
  const { data, error } = await createAdminClient().rpc('enqueue_webhook_delivery', {
    p_workspace_id: workspaceId,
    p_event_type: event,
    p_payload: payload as never,
  })

  if (error) {
    /*
     * A webhook that cannot be queued must NOT fail the thing that caused it.
     * Someone creating a contact should not see an error because their own
     * webhook configuration is broken.
     */
    console.error('[webhooks] could not enqueue', { workspaceId, event, message: error.message })
    return 0
  }

  return data ?? 0
}

/**
 * Attempts due deliveries.
 *
 * ⚠️ A DELIVERY IS MARKED ATTEMPTED BEFORE THE REQUEST GOES OUT, and its next
 * attempt is scheduled at the same time. A crash mid-request then leaves a row
 * that retries later rather than one that retries immediately and forever.
 */
export async function deliverPendingWebhooks(limit = 20): Promise<DeliveryOutcome> {
  const db = createAdminClient()
  const outcome: DeliveryOutcome = { delivered: 0, retrying: 0, exhausted: 0 }

  /*
   * ╔═══════════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ THE DATABASE DECIDES WHAT IS DUE, BECAUSE THE DATABASE WROTE THE TIME. ║
   * ║                                                                           ║
   * ║  This used to be `.lte('next_attempt_at', new Date().toISOString())` — the ║
   * ║  APPLICATION clock — while `next_attempt_at` defaults to `now()` on insert ║
   * ║  — the DATABASE clock. Whenever the database is ahead, a delivery that was ║
   * ║  just queued is invisible to its own worker until the gap elapses.        ║
   * ║                                                                           ║
   * ║  Measured against staging: skew of 1914ms / 1836ms / 1887ms, and a queue- ║
   * ║  then-deliver returning `{ delivered: 0 }` against a row sitting `pending` ║
   * ║  with `attempts: 0`, untouched.                                          ║
   * ║                                                                           ║
   * ║  Mild in production — both sides are NTP-synced and the next tick collects ║
   * ║  whatever was missed, so nothing is lost — but a due-time comparison that  ║
   * ║  spans two clocks does not belong in a retry loop. See 0116.             ║
   * ╚═══════════════════════════════════════════════════════════════════════════╝
   */
  const { data: due } = await db.rpc('due_webhook_deliveries', { p_limit: limit })

  for (const delivery of due ?? []) {
    const { data: subscription } = await db
      .from('webhook_subscriptions')
      .select('url, signing_secret, is_active, failure_count')
      .eq('id', delivery.subscription_id)
      .maybeSingle()

    if (!subscription?.is_active) {
      await db
        .from('webhook_deliveries')
        .update({ status: 'exhausted', last_error: 'The subscription is no longer active.' })
        .eq('id', delivery.id)
      outcome.exhausted += 1
      continue
    }

    /*
     * ⚠️ RE-CHECKED AT DELIVERY, not only when the subscription was saved. A
     * hostname that was public when it was created can later resolve
     * elsewhere, and a row written before this guard existed would otherwise
     * keep being delivered to wherever it points.
     */
    try {
      assertSafeWebhookUrl(subscription.url)
    } catch (unsafe) {
      await db
        .from('webhook_deliveries')
        .update({
          status: 'exhausted',
          last_error:
            unsafe instanceof UnsafeWebhookUrlError
              ? unsafe.message
              : 'That webhook URL is not allowed.',
        })
        .eq('id', delivery.id)
      outcome.exhausted += 1
      continue
    }

    const attempt = delivery.attempts + 1
    const body = JSON.stringify({
      id: delivery.event_id,
      type: delivery.event_type,
      created_at: new Date().toISOString(),
      data: delivery.payload,
    })
    const { signature } = signWebhookPayload(body, subscription.signing_secret)

    // Claim the attempt BEFORE sending.
    await db
      .from('webhook_deliveries')
      .update({
        attempts: attempt,
        next_attempt_at: new Date(Date.now() + backoffSeconds(attempt) * 1000).toISOString(),
      })
      .eq('id', delivery.id)

    let status = 0
    let error: string | null = null

    try {
      const response = await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Outlio-Signature': signature,
          /*
           * ⚠️ STABLE ACROSS RETRIES. This is the header a consumer dedupes on,
           * and it is the whole of what we can offer toward criterion 8's
           * "idempotent for consumers".
           */
          'Outlio-Event-Id': delivery.event_id,
          'Outlio-Event-Type': delivery.event_type,
          'Outlio-Delivery-Attempt': String(attempt),
        },
        body,
        // A consumer's slow endpoint must not occupy a worker indefinitely.
        signal: AbortSignal.timeout(10_000),
      })
      status = response.status
      if (!response.ok) error = `The endpoint returned ${response.status}.`
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'The request failed.'
    }

    if (!error) {
      await db
        .from('webhook_deliveries')
        .update({
          status: 'delivered',
          delivered_at: new Date().toISOString(),
          last_status_code: status,
          last_error: null,
        })
        .eq('id', delivery.id)

      // A success clears the consecutive-failure count.
      await db
        .from('webhook_subscriptions')
        .update({ failure_count: 0 })
        .eq('id', delivery.subscription_id)

      outcome.delivered += 1
      continue
    }

    const exhausted = attempt >= delivery.max_attempts

    await db
      .from('webhook_deliveries')
      .update({
        status: exhausted ? 'exhausted' : 'pending',
        last_status_code: status || null,
        last_error: error,
      })
      .eq('id', delivery.id)

    if (exhausted) {
      outcome.exhausted += 1

      /*
       * ⚠️ A SUBSCRIPTION THAT KEEPS FAILING IS DISABLED, with the reason
       * recorded. Retrying into a dead endpoint forever burns worker time on
       * every future event and buries real failures in noise. Twenty
       * consecutive exhausted deliveries is well past "briefly down".
       */
      const failures = (subscription.failure_count ?? 0) + 1
      const shouldDisable = failures >= 20

      await db
        .from('webhook_subscriptions')
        .update({
          failure_count: failures,
          ...(shouldDisable
            ? {
                is_active: false,
                disabled_at: new Date().toISOString(),
                disabled_reason: `Disabled after ${failures} deliveries failed in a row. Fix the endpoint and re-enable it.`,
              }
            : {}),
        })
        .eq('id', delivery.subscription_id)
    } else {
      outcome.retrying += 1
    }
  }

  return outcome
}
