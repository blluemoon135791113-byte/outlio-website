import { EventName } from '@paddle/paddle-node-sdk'

import { getPaddleClient, getPaddleWebhookSecret } from '@/lib/paddle/server'
import {
  syncCustomerEvent,
  syncSubscriptionEvent,
  syncTransactionCompletedEvent,
} from '@/lib/paddle/webhooks'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get('paddle-signature')
  if (!signature) return new Response('Missing Paddle-Signature', { status: 400 })

  // Signature verification requires the exact bytes Paddle sent. Never parse
  // this body before `unmarshal` verifies and types it.
  const rawBody = await request.text()

  let event: Awaited<ReturnType<ReturnType<typeof getPaddleClient>['webhooks']['unmarshal']>>
  try {
    event = await getPaddleClient().webhooks.unmarshal(
      rawBody,
      getPaddleWebhookSecret(),
      signature,
    )
  } catch {
    return new Response('Invalid webhook signature', { status: 400 })
  }

  try {
    switch (event.eventType) {
      case EventName.CustomerCreated:
      case EventName.CustomerUpdated:
        await syncCustomerEvent(event)
        break
      case EventName.SubscriptionCreated:
      case EventName.SubscriptionUpdated:
      case EventName.SubscriptionCanceled:
        await syncSubscriptionEvent(event)
        break
      case EventName.TransactionCompleted:
        await syncTransactionCompletedEvent(event)
        break
      default:
        // Verified but intentionally not part of the fulfillment contract.
        break
    }
  } catch (error) {
    console.error('Verified Paddle webhook processing failed', {
      eventId: event.eventId,
      eventType: event.eventType,
      message: error instanceof Error ? error.message : 'unknown error',
    })
    // Paddle retries non-2xx deliveries. Never acknowledge a failed handler.
    return new Response('Webhook processing failed', { status: 500 })
  }

  return Response.json({ received: true })
}

