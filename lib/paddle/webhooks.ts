import 'server-only'

import type {
  CustomerCreatedEvent,
  CustomerUpdatedEvent,
  SubscriptionCanceledEvent,
  SubscriptionCreatedEvent,
  SubscriptionUpdatedEvent,
  TransactionCompletedEvent,
} from '@paddle/paddle-node-sdk'

import { planKeyForPriceId } from '@/lib/paddle/config'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'

type CustomerEvent = CustomerCreatedEvent | CustomerUpdatedEvent
type SubscriptionEvent =
  | SubscriptionCreatedEvent
  | SubscriptionUpdatedEvent
  | SubscriptionCanceledEvent

function json(value: unknown): Json | null {
  if (value === null || value === undefined) return null
  return JSON.parse(JSON.stringify(value)) as Json
}

export async function syncCustomerEvent(event: CustomerEvent): Promise<void> {
  const customer = event.data
  const { error } = await createAdminClient().rpc('sync_paddle_customer', {
    p_event_id: event.eventId,
    p_event_type: event.eventType,
    p_occurred_at: event.occurredAt,
    p_customer_id: customer.id,
    p_email: customer.email,
    p_name: customer.name ?? '',
    p_status: customer.status,
    p_marketing_consent: customer.marketingConsent,
    p_custom_data: json(customer.customData),
    p_paddle_created_at: customer.createdAt,
    p_paddle_updated_at: customer.updatedAt,
  })

  if (error) throw new Error(`Paddle customer sync failed: ${error.message}`)
}

export async function syncSubscriptionEvent(event: SubscriptionEvent): Promise<void> {
  const subscription = event.data
  const item = subscription.items.find((candidate) => candidate.status === 'active')
    ?? subscription.items[0]
  const priceId = item?.price?.id
  const productId = item?.product?.id ?? item?.price?.productId

  if (!priceId || !productId) {
    throw new Error(`Paddle subscription ${subscription.id} has no catalog price/product`)
  }

  /*
   * The generated RPC type marks every no-default parameter as required, but
   * the function accepts NULL for the optional lifecycle fields (scheduled
   * change, period bounds, cancellation). The cast keeps the honest nulls.
   */
  const { error } = await createAdminClient().rpc('sync_paddle_subscription', {
    p_event_id: event.eventId,
    p_event_type: event.eventType,
    p_occurred_at: event.occurredAt,
    p_subscription_id: subscription.id,
    p_customer_id: subscription.customerId,
    p_status: subscription.status,
    p_price_id: priceId,
    p_product_id: productId,
    p_plan_key: planKeyForPriceId(priceId),
    p_scheduled_change_action: subscription.scheduledChange?.action ?? null,
    p_scheduled_change_at: subscription.scheduledChange?.effectiveAt ?? null,
    p_current_period_start: subscription.currentBillingPeriod?.startsAt ?? null,
    p_current_period_end: subscription.currentBillingPeriod?.endsAt ?? null,
    p_canceled_at: subscription.canceledAt,
    p_paused_at: subscription.pausedAt,
    p_custom_data: json(subscription.customData),
  } as never)

  if (error) throw new Error(`Paddle subscription sync failed: ${error.message}`)
}

export async function syncTransactionCompletedEvent(
  event: TransactionCompletedEvent,
): Promise<void> {
  const transaction = event.data
  const item = transaction.items[0]

  // Same conservative-generated-type cast as sync_paddle_subscription above.
  const { error } = await createAdminClient().rpc('sync_paddle_transaction', {
    p_event_id: event.eventId,
    p_event_type: event.eventType,
    p_occurred_at: event.occurredAt,
    p_transaction_id: transaction.id,
    p_customer_id: transaction.customerId,
    p_subscription_id: transaction.subscriptionId,
    p_status: transaction.status,
    p_price_id: item?.price?.id ?? null,
    p_product_id: item?.price?.productId ?? null,
    p_currency_code: transaction.currencyCode,
    p_total: transaction.details?.totals?.grandTotal ?? transaction.details?.totals?.total ?? null,
    p_custom_data: json(transaction.customData),
    p_billed_at: transaction.billedAt,
  } as never)

  if (error) throw new Error(`Paddle transaction sync failed: ${error.message}`)
}

