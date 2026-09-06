# FastSpring setup

FastSpring is Outlio's merchant of record. The application code is complete; the
catalog, credentials, and webhook destination must belong to the Outlio
FastSpring account. Do not delete these entities after testing — products,
accounts, subscriptions, orders, and the webhook destination are production
infrastructure.

Test and live are two separate FastSpring **stores**, not a mode flag. Every
step below is done once per store.

## 1. Create the catalog

Create three subscription products: Lead Engine, Pro, and Pro + Hubble. Give
each a monthly and a yearly version, so six products in total, each with a
three-day free trial.

Copy the six **product paths** — the storefront slug, e.g. `lead-engine-monthly`,
not the internal product ID — into the deployment variables listed in
`.env.example`:

```
FASTSPRING_LEAD_ENGINE_MONTH_PRODUCT
FASTSPRING_LEAD_ENGINE_YEAR_PRODUCT
FASTSPRING_PRO_MONTH_PRODUCT
FASTSPRING_PRO_YEAR_PRODUCT
FASTSPRING_PRO_HUBBLE_MONTH_PRODUCT
FASTSPRING_PRO_HUBBLE_YEAR_PRODUCT
```

`lib/fastspring/config.ts` maps each path back to an Outlio plan key. A product
path that is not in this list produces a subscription with a `NULL` plan key,
which reconciliation refuses to grant access for.

## 2. Set the storefront

Create a **popup** storefront and copy its address into:

```
NEXT_PUBLIC_FASTSPRING_STOREFRONT=husnain.onfastspring.com/popup-husnain
```

The value is `store.onfastspring.com/storefront-path` with no scheme. This one
variable decides test versus live:

- `*.test.onfastspring.com/...` — test store, no real money. The webhook route
  accepts FastSpring's `live: false` events.
- `*.onfastspring.com/...` — live store. The webhook route **drops** `live: false`
  events so a test purchase can never grant real access.

## 3. Add credentials

Under **Integrations > API Credentials**, create API credentials and set:

```
FASTSPRING_API_USERNAME=
FASTSPRING_API_PASSWORD=
```

These are server-only. Never prefix either with `NEXT_PUBLIC_`. They are used
for localized price lookups on `/pricing` and for minting account management
portal links; neither ever reaches the browser.

## 4. Apply the database migration

Apply both migrations to the production Supabase project **before** enabling
webhook delivery, in order:

- `0068_fastspring_billing.sql` — the verified FastSpring mirrors, the
  idempotency ledger, and entitlement reconciliation.
- `0069_fastspring_charges_and_credits.sql` — charge records and paid-period
  credit allocation.

Then regenerate the database types, which replaces the hand-written FastSpring
entries currently in `types/database.ts`:

```bash
npm run db:types
```

### How access is decided

Access follows FastSpring's **`active` boolean**, not the state string. This is
the one thing to get right:

| `state` | `active` | Access | Meaning |
|---|---|---|---|
| `trial` | `true` | granted, on the 10-credit trial plan | three-day trial |
| `active` | `true` | granted, on the purchased tier | paying |
| `canceled` | `true` | **granted** | cancelled, but paid through the current period |
| `overdue` | `true` | denied | dunning |
| `deactivated` | `false` | denied | the paid period has ended |

A cancellation is an intent, not an expiry. FastSpring emits
`subscription.canceled` with `active: true` immediately and only flips `active`
to false at `subscription.deactivated`, at the end of the period the customer
already paid for. Revoking on `subscription.canceled` would cut off paid access.

A `trial` subscription receives the generic internal 10-credit trial plan; the
purchased tier is applied when FastSpring moves the state to `active`.

## 5. Create the webhook destination

Under **Integrations > Webhooks**, add a destination for:

`https://app.outlio.io/api/webhooks/fastspring`

Subscribe it to:

| Event | What it does |
|---|---|
| `account.created` / `account.updated` | mirrors the customer account, binds it to a user |
| `order.completed` | first purchase: activates the plan, allocates credits, stores order + subscription IDs |
| `subscription.activated` | promotes trial → purchased tier |
| `subscription.updated` | re-reconciles plan and period |
| `subscription.charge.completed` | successful rebill: records the charge, replenishes credits |
| `subscription.charge.failed` | records the failed charge, allocates nothing |
| `subscription.canceled` | schedules cancellation, keeps paid access |
| `subscription.uncanceled` | reverses a scheduled cancellation |
| `subscription.deactivated` | ends access, stops future credit allocation |

Any other event type is verified, logged as `event.unhandled_type`, and ignored.

Enable **Webhook Expansion** so payloads carry the full account and product
objects. The parser accepts unexpanded payloads too, but without expansion a
subscription event has no customer email, which removes the email fallback used
to bind an order placed outside our own checkout to an Outlio user.

Copy the destination's **HMAC secret** into `FASTSPRING_WEBHOOK_SECRET`. This is
not the API password. Every delivery is verified as
`base64(HMAC-SHA256(raw body, secret))` against the `X-FS-Signature` header
before the body is parsed.

## 6. How credits are allocated

Credits are allowanced per **calendar month**
(`date_trunc('month', now())` in `consume_credit`, `credit_balance`,
`granted_credits`, `charge_extraction_leads` and `finalize_upload_job`), while
FastSpring rebills on the **subscription anniversary**. The two do not line up,
so a successful charge does not reset a counter — it tops the user back up to
one full plan allowance using the existing `credit_grants` mechanism:

```
grant = max(0, used - already_granted)
```

That makes `granted` equal `used`, so remaining returns to exactly the plan's
`credits_per_month`. Three properties follow:

- **Self-limiting.** Run it twice and the second run grants nothing, because
  `granted` already equals `used`. Even if `order.completed` and
  `subscription.charge.completed` both fire for one payment, the user is topped
  up once.
- **Never doubles.** A renewal in the middle of a calendar month cannot hand out
  two allowances.
- **Keeps bonuses.** A referral grant larger than consumption is left alone.

Credits are allocated only when the subscription currently grants access, so a
deactivated subscription can never receive another allocation. A free-trial
order totals zero and allocates nothing — the trial plan's own 10-credit
allowance covers it.

Every allocation writes a `credit_grants` row stamped with the FastSpring event
ID, under a unique index. That is the hard guarantee that a retry cannot pay out
twice, independent of the event ledger.

### Product → plan → credits

The mapping is server-side only, in `lib/fastspring/config.ts` (path → plan,
from environment variables) and `plans.limits` (plan → allowance, read at
runtime). **Price, quantity and any credit count in a webhook payload are
ignored entirely.** The product path is the only catalog value taken from
FastSpring. A path outside the configured catalog yields a `NULL` plan key,
which allocates nothing and logs `event.unhandled_type`.

## 7. Logging

Every line is one JSON object prefixed `[fastspring]`. Filter on that, then on
an `eventId`, to trace a delivery end to end:

`webhook.received` · `webhook.verification_failed` · `webhook.unreadable` ·
`event.processing` · `event.duplicate_ignored` · `event.ignored_test_mode` ·
`event.unhandled_type` · `event.failed` · `user.matched` · `user.unmatched` ·
`credits.allocated` · `credits.none_needed` · `billing.status_changed` ·
`billing.charge_failed`

The secret, the signature, the raw body, and customer names and emails are never
logged. A user appears as their Outlio UUID.

## 8. How a purchase binds to an Outlio user

`/pricing` attaches the signed-in user's ID as a FastSpring **tag**:

```js
tags: { outlio_user_id, plan_key, billing_interval }
```

Tags survive into every webhook for the resulting order and subscription, and
`resolve_fastspring_user` reads them first. It falls back to a known FastSpring
account, then to a case-insensitive match on the profile email — that fallback
covers purchases made while signed out or created by support.

## 9. Delivery semantics

A single POST may bundle several events. Each sync function claims its event ID
in `fastspring_webhook_events` before doing any work, so a redelivered batch is
a no-op for events already applied. The route returns 500 on the first failing
event; FastSpring retries the whole batch and the ledger absorbs the repeats.

## Migrating from Paddle

The Paddle tables from migration 0059 are intentionally left in place as
historical record. Nothing writes to them and no entitlement decision reads
them. Dropping `paddle_customers`, `paddle_subscriptions`, `paddle_transactions`,
`paddle_webhook_events`, their functions, and the `paddle_*` columns on
`subscriptions` is a separate, deliberate migration.
