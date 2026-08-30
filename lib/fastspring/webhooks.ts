import 'server-only'

import { resolveProductMapping } from '@/lib/fastspring/catalog'
import { billingIntervalForProductPath, planKeyForProductPath } from '@/lib/fastspring/config'
import {
  parseAccountEvent,
  parseChargeFailedEvent,
  parseOrderEvent,
  parseSubscriptionEvent,
  type FastSpringEvent,
} from '@/lib/fastspring/events'
import { logFastSpring } from '@/lib/fastspring/log'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'

/** What a verified event actually did, for logging and for the caller. */
export type SyncOutcome = {
  /** False when the event ID was already in the ledger and nothing was done. */
  claimed: boolean
  userId: string | null
  creditsAllocated: number
}

const IGNORED: SyncOutcome = { claimed: false, userId: null, creditsAllocated: 0 }

function json(value: unknown): Json | null {
  if (value === null || value === undefined) return null
  return JSON.parse(JSON.stringify(value)) as Json
}

/** Event `created` is always present in practice; delivery time is the floor. */
function occurredAt(event: FastSpringEvent): string {
  return event.created ?? new Date().toISOString()
}

/** The `{claimed, user_id, credits_allocated}` jsonb the sync functions return. */
function toOutcome(value: unknown): SyncOutcome {
  const record = (value ?? {}) as Record<string, unknown>
  return {
    claimed: record.claimed === true,
    userId: typeof record.user_id === 'string' ? record.user_id : null,
    creditsAllocated:
      typeof record.credits_allocated === 'number' ? record.credits_allocated : 0,
  }
}

function logUserMatch(event: FastSpringEvent, outcome: SyncOutcome): void {
  if (outcome.userId) {
    logFastSpring('info', 'user.matched', {
      eventId: event.id,
      eventType: event.type,
      userId: outcome.userId,
    })
  } else {
    logFastSpring('warn', 'user.unmatched', {
      eventId: event.id,
      eventType: event.type,
    })
  }
}

function logCredits(
  event: FastSpringEvent,
  outcome: SyncOutcome,
  planKey: string | null,
  creditsPerMonth: number | null,
): void {
  if (outcome.creditsAllocated > 0) {
    logFastSpring('info', 'credits.allocated', {
      eventId: event.id,
      eventType: event.type,
      userId: outcome.userId,
      planKey,
      planAllowance: creditsPerMonth,
      credits: outcome.creditsAllocated,
    })
  } else {
    // Expected whenever the user has not spent below their allowance yet, and
    // the self-limiting case when a second event covers the same payment.
    logFastSpring('info', 'credits.none_needed', {
      eventId: event.id,
      eventType: event.type,
      userId: outcome.userId,
      planKey,
    })
  }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function syncAccountEvent(event: FastSpringEvent): Promise<SyncOutcome> {
  const account = parseAccountEvent(event.data)

  const { data, error } = await createAdminClient().rpc('sync_fastspring_account', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_occurred_at: occurredAt(event),
    p_account_id: account.accountId,
    p_email: account.email,
    p_name: account.name,
    p_company: account.company,
    p_country: account.country,
    p_language: account.language,
    p_tags: json(account.tags),
  } as never)

  if (error) throw new Error(`FastSpring account sync failed: ${error.message}`)
  return data === true ? { claimed: true, userId: null, creditsAllocated: 0 } : IGNORED
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export async function syncSubscriptionEvent(event: FastSpringEvent): Promise<SyncOutcome> {
  const subscription = parseSubscriptionEvent(event.data)
  const admin = createAdminClient()

  /*
   * The generated RPC types mark every parameter without a SQL default as
   * required, but the function accepts NULL for each optional lifecycle field.
   * The cast keeps the honest nulls rather than inventing placeholder values.
   */
  const { data, error } = await admin.rpc('sync_fastspring_subscription', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_occurred_at: occurredAt(event),
    p_subscription_id: subscription.subscriptionId,
    p_account_id: subscription.account.accountId,
    p_email: subscription.account.email,
    p_state: subscription.state,
    p_active: subscription.active,
    p_product_path: subscription.productPath,
    p_plan_key: planKeyForProductPath(subscription.productPath),
    p_billing_interval: billingIntervalForProductPath(subscription.productPath),
    p_auto_renew: subscription.autoRenew,
    p_currency: subscription.currency,
    p_price: subscription.price,
    p_begin_at: subscription.beginAt,
    p_next_charge_at: subscription.nextChargeAt,
    p_canceled_at: subscription.canceledAt,
    p_deactivated_at: subscription.deactivatedAt,
    p_tags: json(subscription.tags),
  } as never)

  if (error) throw new Error(`FastSpring subscription sync failed: ${error.message}`)
  if (data !== true) return IGNORED

  logFastSpring('info', 'billing.status_changed', {
    eventId: event.id,
    eventType: event.type,
    subscriptionId: subscription.subscriptionId,
    state: subscription.state,
    active: subscription.active,
    grantsAccess:
      subscription.active &&
      ['active', 'trial', 'canceled'].includes(subscription.state),
    planKey: planKeyForProductPath(subscription.productPath),
    nextChargeAt: subscription.nextChargeAt,
    deactivatedAt: subscription.deactivatedAt,
  })

  // The RPC returns only a claim flag, so the resolved user is read back off
  // the mirror row it just wrote. One indexed lookup, only on a claimed event.
  const { data: row } = await admin
    .from('fastspring_subscriptions')
    .select('user_id')
    .eq('subscription_id', subscription.subscriptionId)
    .maybeSingle()

  return { claimed: true, userId: row?.user_id ?? null, creditsAllocated: 0 }
}

// ---------------------------------------------------------------------------
// Orders and charges
// ---------------------------------------------------------------------------

export async function syncOrderEvent(event: FastSpringEvent): Promise<SyncOutcome> {
  const order = parseOrderEvent(event.data)
  const mapping = await resolveProductMapping(order.productPath)

  if (order.productPath && !mapping?.planKey) {
    logFastSpring('warn', 'event.unhandled_type', {
      eventId: event.id,
      eventType: event.type,
      reason: 'product_path_outside_catalog',
      productPath: order.productPath,
    })
  }

  const { data, error } = await createAdminClient().rpc('sync_fastspring_order', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_occurred_at: occurredAt(event),
    p_order_id: order.orderId,
    p_account_id: order.account?.accountId ?? null,
    p_subscription_id: order.subscriptionId,
    p_email: order.email,
    p_reference: order.reference,
    p_live: order.live,
    p_currency: order.currency,
    p_total: order.total,
    p_product_path: order.productPath,
    p_plan_key: mapping?.planKey ?? null,
    p_tags: json(order.tags),
    p_completed_at: order.completedAt,
  } as never)

  if (error) throw new Error(`FastSpring order sync failed: ${error.message}`)

  const outcome = toOutcome(data)
  if (!outcome.claimed) return outcome

  logUserMatch(event, outcome)
  logCredits(event, outcome, mapping?.planKey ?? null, mapping?.creditsPerMonth ?? null)
  return outcome
}

/** A successful recurring charge. Shaped like an order, with a subscription. */
export async function syncChargeCompletedEvent(
  event: FastSpringEvent,
): Promise<SyncOutcome> {
  const charge = parseOrderEvent(event.data)
  const mapping = await resolveProductMapping(charge.productPath)

  const { data, error } = await createAdminClient().rpc('sync_fastspring_charge', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_occurred_at: occurredAt(event),
    p_charge_id: charge.orderId,
    p_subscription_id: charge.subscriptionId,
    p_account_id: charge.account?.accountId ?? null,
    p_email: charge.email,
    p_status: 'completed',
    p_currency: charge.currency,
    p_total: charge.total,
    p_decline_reason: null,
    p_product_path: charge.productPath,
    p_plan_key: mapping?.planKey ?? null,
    p_tags: json(charge.tags),
  } as never)

  if (error) throw new Error(`FastSpring charge sync failed: ${error.message}`)

  const outcome = toOutcome(data)
  if (!outcome.claimed) return outcome

  logUserMatch(event, outcome)
  logCredits(event, outcome, mapping?.planKey ?? null, mapping?.creditsPerMonth ?? null)
  return outcome
}

/** A failed rebill. Records the attempt and never allocates credits. */
export async function syncChargeFailedEvent(event: FastSpringEvent): Promise<SyncOutcome> {
  const charge = parseChargeFailedEvent(event.data)
  const planKey = charge.productPath ? planKeyForProductPath(charge.productPath) : null

  const { data, error } = await createAdminClient().rpc('sync_fastspring_charge', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_occurred_at: occurredAt(event),
    p_charge_id: null,
    p_subscription_id: charge.subscriptionId,
    p_account_id: charge.account?.accountId ?? null,
    p_email: charge.email,
    // 'failed' is what stops `sync_fastspring_charge` reaching the credit path.
    p_status: 'failed',
    p_currency: charge.currency,
    p_total: charge.total,
    p_decline_reason: charge.declineReason,
    p_product_path: charge.productPath,
    p_plan_key: planKey,
    p_tags: json(charge.tags),
  } as never)

  if (error) throw new Error(`FastSpring failed-charge sync failed: ${error.message}`)

  const outcome = toOutcome(data)
  if (!outcome.claimed) return outcome

  logUserMatch(event, outcome)
  logFastSpring('warn', 'billing.charge_failed', {
    eventId: event.id,
    subscriptionId: charge.subscriptionId,
    userId: outcome.userId,
    declineReason: charge.declineReason,
  })
  return outcome
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * Route a single verified event to its sync function.
 *
 * `subscription.charge.completed` carries an *order* payload with the
 * subscription nested inside it, so it parses as an order. `charge.failed` is
 * the odd one out: no order object at all, only `{reason, account,
 * subscription}`. Unrecognised event types are verified and intentionally
 * ignored.
 */
export async function handleFastSpringEvent(event: FastSpringEvent): Promise<SyncOutcome> {
  switch (event.type) {
    case 'account.created':
    case 'account.updated':
      return syncAccountEvent(event)
    case 'subscription.activated':
    case 'subscription.updated':
    case 'subscription.canceled':
    case 'subscription.uncanceled':
    case 'subscription.deactivated':
      return syncSubscriptionEvent(event)
    case 'order.completed':
      return syncOrderEvent(event)
    case 'subscription.charge.completed':
      return syncChargeCompletedEvent(event)
    case 'subscription.charge.failed':
      return syncChargeFailedEvent(event)
    default:
      logFastSpring('info', 'event.unhandled_type', {
        eventId: event.id,
        eventType: event.type,
      })
      return IGNORED
  }
}
