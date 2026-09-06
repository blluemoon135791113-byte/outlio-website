import { getStorefront } from '@/lib/fastspring/config'
import { fastSpringEnvelopeSchema } from '@/lib/fastspring/events'
import { logFastSpring } from '@/lib/fastspring/log'
import { getFastSpringWebhookSecret } from '@/lib/fastspring/server'
import { verifyFastSpringSignature } from '@/lib/fastspring/signature'
import { handleFastSpringEvent } from '@/lib/fastspring/webhooks'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get('x-fs-signature')
  if (!signature) {
    logFastSpring('warn', 'webhook.verification_failed', { reason: 'missing_signature' })
    return new Response('Missing X-FS-Signature', { status: 400 })
  }

  // Signature verification requires the exact bytes FastSpring sent. Never
  // parse this body before the digest over it has been verified.
  const rawBody = await request.text()

  if (!verifyFastSpringSignature(rawBody, signature, getFastSpringWebhookSecret())) {
    // The signature itself is never logged — it is a secret-derived value.
    logFastSpring('error', 'webhook.verification_failed', {
      reason: 'signature_mismatch',
      bodyBytes: rawBody.length,
    })
    return new Response('Invalid webhook signature', { status: 400 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    logFastSpring('error', 'webhook.unreadable', { reason: 'invalid_json' })
    return new Response('Unreadable webhook envelope', { status: 400 })
  }

  const parsed = fastSpringEnvelopeSchema.safeParse(body)
  if (!parsed.success) {
    // Signed but unreadable. Retrying identical bytes cannot help, so this is
    // acknowledged rather than queued forever.
    logFastSpring('error', 'webhook.unreadable', { reason: 'envelope_schema' })
    return new Response('Unreadable webhook envelope', { status: 400 })
  }

  /*
   * A test storefront and a live storefront are different FastSpring stores,
   * but one webhook destination can be subscribed to both. Test money must
   * never grant real access or real credits, so a live deployment drops
   * `live: false` events.
   */
  const { isTest } = getStorefront()

  logFastSpring('info', 'webhook.received', {
    events: parsed.data.events.length,
    storefrontMode: isTest ? 'test' : 'live',
  })

  for (const event of parsed.data.events) {
    if (event.live === false && !isTest) {
      logFastSpring('warn', 'event.ignored_test_mode', {
        eventId: event.id,
        eventType: event.type,
      })
      continue
    }

    logFastSpring('info', 'event.processing', {
      eventId: event.id,
      eventType: event.type,
      live: event.live,
    })

    try {
      const outcome = await handleFastSpringEvent(event)

      if (!outcome.claimed) {
        // The event ID was already in the ledger: a FastSpring retry, or the
        // same event redelivered inside a later batch. Nothing was re-applied.
        logFastSpring('info', 'event.duplicate_ignored', {
          eventId: event.id,
          eventType: event.type,
        })
      }
    } catch (error) {
      logFastSpring('error', 'event.failed', {
        eventId: event.id,
        eventType: event.type,
        message: error instanceof Error ? error.message : 'unknown error',
      })
      /*
       * FastSpring retries non-2xx deliveries, and a retry redelivers the whole
       * batch. Events already applied are no-ops because every sync claims its
       * event ID first, so stopping here is safe and loses nothing.
       */
      return new Response('Webhook processing failed', { status: 500 })
    }
  }

  return Response.json({ received: true })
}
