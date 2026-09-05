import { z } from 'zod'

/**
 * FastSpring webhook payloads, validated at the trust boundary.
 *
 * Every schema here is deliberately tolerant about *shape* and strict about
 * *meaning*. FastSpring returns `account` and `product` either as a bare
 * identifier string or as a fully expanded object depending on whether Webhook
 * Expansion is enabled on the destination, so both forms are accepted. What is
 * never guessed is the subscription state or the `active` flag: those decide
 * access, so an unrecognised value fails loudly instead of defaulting.
 */

/** Milliseconds since epoch, an ISO string, or a plain date — all to ISO. */
const timestamp = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value): string | null => {
    if (value === null || value === undefined || value === '') return null

    const asNumber = typeof value === 'number' ? value : Number(value)
    const date = Number.isFinite(asNumber) ? new Date(asNumber) : new Date(value)

    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  })

const tags = z.record(z.string(), z.unknown()).nullish().transform((value) => value ?? null)

const contact = z
  .object({
    email: z.string().nullish(),
    first: z.string().nullish(),
    last: z.string().nullish(),
    company: z.string().nullish(),
  })
  .partial()
  .passthrough()

const account = z.union([
  z.string().min(1),
  z
    .object({
      id: z.string().min(1),
      contact: contact.nullish(),
      country: z.string().nullish(),
      language: z.string().nullish(),
    })
    .passthrough(),
])

/** A product path, whether FastSpring sent it bare or expanded. */
const product = z.union([
  z.string().min(1),
  z.object({ product: z.string().min(1) }).passthrough(),
  z.object({ path: z.string().min(1) }).passthrough(),
])

type AccountInput = z.infer<typeof account>
type ProductInput = z.infer<typeof product>

export type NormalizedAccount = {
  accountId: string
  email: string | null
  name: string | null
  company: string | null
  country: string | null
  language: string | null
}

function normalizeAccount(value: AccountInput | null | undefined): NormalizedAccount | null {
  if (!value) return null
  if (typeof value === 'string') {
    return { accountId: value, email: null, name: null, company: null, country: null, language: null }
  }

  const name = [value.contact?.first, value.contact?.last].filter(Boolean).join(' ').trim()

  return {
    accountId: value.id,
    email: value.contact?.email ?? null,
    name: name || null,
    company: value.contact?.company ?? null,
    country: value.country ?? null,
    language: value.language ?? null,
  }
}

function normalizeProduct(value: ProductInput | null | undefined): string | null {
  if (!value) return null
  if (typeof value === 'string') return value

  // Passthrough objects carry an index signature, so read both spellings off
  // the record rather than narrowing on key presence.
  const record = value as Record<string, unknown>
  const path = record.product ?? record.path
  return typeof path === 'string' ? path : null
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export const fastSpringEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  live: z.boolean().nullish(),
  created: timestamp,
  data: z.record(z.string(), z.unknown()).nullish().transform((value) => value ?? {}),
})

/** Each POST may bundle several events; duplicates are keyed on `id`. */
export const fastSpringEnvelopeSchema = z.object({
  events: z.array(fastSpringEventSchema),
})

export type FastSpringEvent = z.infer<typeof fastSpringEventSchema>

// ---------------------------------------------------------------------------
// Account events
// ---------------------------------------------------------------------------

const accountDataSchema = z
  .object({
    id: z.string().min(1),
    contact: contact.nullish(),
    country: z.string().nullish(),
    language: z.string().nullish(),
    tags,
  })
  .passthrough()

export function parseAccountEvent(data: unknown): NormalizedAccount & {
  tags: Record<string, unknown> | null
} {
  const parsed = accountDataSchema.parse(data)
  const normalized = normalizeAccount(parsed)!
  return { ...normalized, tags: parsed.tags }
}

// ---------------------------------------------------------------------------
// Subscription events
// ---------------------------------------------------------------------------

const subscriptionDataSchema = z
  .object({
    id: z.string().min(1),
    account,
    product,
    // The five documented FastSpring subscription states. An unrecognised value
    // must not be silently coerced — it would decide someone's access.
    state: z.enum(['active', 'trial', 'overdue', 'canceled', 'deactivated']),
    active: z.boolean().nullish(),
    autoRenew: z.boolean().nullish(),
    currency: z.string().nullish(),
    price: z.number().nullish(),
    begin: timestamp,
    nextChargeDate: timestamp,
    // FastSpring has used several names for the end of a canceled subscription
    // depending on payload version; all three mean the same instant.
    end: timestamp,
    deactivationDate: timestamp,
    canceledDate: timestamp,
    tags,
  })
  .passthrough()

export type NormalizedSubscription = {
  subscriptionId: string
  account: NormalizedAccount
  productPath: string
  state: 'active' | 'trial' | 'overdue' | 'canceled' | 'deactivated'
  active: boolean
  autoRenew: boolean | null
  currency: string | null
  price: number | null
  beginAt: string | null
  nextChargeAt: string | null
  canceledAt: string | null
  deactivatedAt: string | null
  tags: Record<string, unknown> | null
}

export function parseSubscriptionEvent(data: unknown): NormalizedSubscription {
  const parsed = subscriptionDataSchema.parse(data)

  const productPath = normalizeProduct(parsed.product)
  if (!productPath) {
    throw new Error(`FastSpring subscription ${parsed.id} has no product path`)
  }

  const normalizedAccount = normalizeAccount(parsed.account)
  if (!normalizedAccount) {
    throw new Error(`FastSpring subscription ${parsed.id} has no account`)
  }

  return {
    subscriptionId: parsed.id,
    account: normalizedAccount,
    productPath,
    state: parsed.state,
    // FastSpring always sends `active`. If a payload omits it, a canceled
    // subscription is still paid through its period, so only an explicit
    // deactivation ends access.
    active: parsed.active ?? parsed.state !== 'deactivated',
    autoRenew: parsed.autoRenew ?? null,
    currency: parsed.currency ?? null,
    price: parsed.price ?? null,
    beginAt: parsed.begin,
    nextChargeAt: parsed.nextChargeDate,
    canceledAt: parsed.canceledDate,
    deactivatedAt: parsed.deactivationDate ?? parsed.end,
    tags: parsed.tags,
  }
}

// ---------------------------------------------------------------------------
// Order events
// ---------------------------------------------------------------------------

/** A subscription reference: a bare ID, or the nested object on a charge. */
const subscriptionRef = z.union([
  z.string().min(1),
  z.object({ id: z.string().min(1) }).passthrough(),
  z.object({ subscription: z.string().min(1) }).passthrough(),
])

function normalizeSubscriptionRef(value: unknown): string | null {
  if (typeof value === 'string') return value || null
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  const id = record.id ?? record.subscription
  return typeof id === 'string' && id ? id : null
}

const orderDataSchema = z
  .object({
    // `order.completed` names the order `id`; `subscription.charge.completed`
    // names the same field `order`. Both spellings appear in live payloads.
    id: z.string().min(1).nullish(),
    order: z.union([z.string().min(1), z.record(z.string(), z.unknown())]).nullish(),
    reference: z.string().nullish(),
    account: account.nullish(),
    customer: contact.nullish(),
    live: z.boolean().nullish(),
    currency: z.string().min(1),
    total: z.number().nullish(),
    completed: timestamp,
    changed: timestamp,
    timestamp,
    // A charge payload carries the subscription at the top level; a plain order
    // carries it per item.
    subscription: subscriptionRef.nullish(),
    items: z
      .array(
        z
          .object({ product: product.nullish(), subscription: z.string().nullish() })
          .passthrough(),
      )
      .nullish(),
    tags,
  })
  .passthrough()

export type NormalizedOrder = {
  orderId: string
  account: NormalizedAccount | null
  subscriptionId: string | null
  email: string | null
  reference: string | null
  live: boolean
  currency: string
  total: number | null
  productPath: string | null
  completedAt: string | null
  tags: Record<string, unknown> | null
}

export function parseOrderEvent(data: unknown): NormalizedOrder {
  const parsed = orderDataSchema.parse(data)

  const orderId = parsed.id ?? (typeof parsed.order === 'string' ? parsed.order : null)
  if (!orderId) throw new Error('FastSpring order event has no order identifier')

  // A rebill order carries many items; only the one bound to a subscription
  // moves entitlement. Fall back to the first item for a one-off purchase.
  const items = parsed.items ?? []
  const item = items.find((candidate) => Boolean(candidate.subscription)) ?? items[0]
  const normalizedAccount = normalizeAccount(parsed.account)

  return {
    orderId,
    account: normalizedAccount,
    subscriptionId:
      normalizeSubscriptionRef(parsed.subscription) ?? item?.subscription ?? null,
    email: normalizedAccount?.email ?? parsed.customer?.email ?? null,
    reference: parsed.reference ?? null,
    live: parsed.live ?? true,
    currency: parsed.currency,
    total: parsed.total ?? null,
    productPath: normalizeProduct(item?.product),
    completedAt: parsed.completed ?? parsed.timestamp ?? parsed.changed,
    tags: parsed.tags,
  }
}

// ---------------------------------------------------------------------------
// Failed charges
// ---------------------------------------------------------------------------

/*
 * `subscription.charge.failed` is shaped unlike every other billing event: it
 * has no order object at all, only `{ reason, account, subscription }`, and the
 * money details live on the nested subscription.
 */
const chargeFailedDataSchema = z
  .object({
    reason: z.string().nullish(),
    account: account.nullish(),
    subscription: z
      .object({
        id: z.string().min(1).nullish(),
        subscription: z.string().min(1).nullish(),
        account: account.nullish(),
        product: product.nullish(),
        currency: z.string().nullish(),
        price: z.number().nullish(),
        declineReason: z.string().nullish(),
        tags,
      })
      .passthrough(),
  })
  .passthrough()

export type NormalizedFailedCharge = {
  subscriptionId: string
  account: NormalizedAccount | null
  email: string | null
  productPath: string | null
  currency: string | null
  total: number | null
  declineReason: string | null
  tags: Record<string, unknown> | null
}

export function parseChargeFailedEvent(data: unknown): NormalizedFailedCharge {
  const parsed = chargeFailedDataSchema.parse(data)
  const subscription = parsed.subscription

  const subscriptionId = subscription.id ?? subscription.subscription
  if (!subscriptionId) {
    throw new Error('FastSpring failed-charge event has no subscription identifier')
  }

  const normalizedAccount =
    normalizeAccount(parsed.account) ?? normalizeAccount(subscription.account)

  return {
    subscriptionId,
    account: normalizedAccount,
    email: normalizedAccount?.email ?? null,
    productPath: normalizeProduct(subscription.product),
    currency: subscription.currency ?? null,
    total: subscription.price ?? null,
    // `reason` is the top-level code (EXPIRED_CARD); declineReason adds detail.
    declineReason: [parsed.reason, subscription.declineReason]
      .filter((value): value is string => Boolean(value))
      .join(': ') || null,
    tags: subscription.tags,
  }
}
