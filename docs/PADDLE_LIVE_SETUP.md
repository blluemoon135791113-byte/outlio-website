# Paddle live setup

The application code is ready for Paddle Billing, but the permanent live
catalog, credentials, and notification destination must belong to the Outlio
Paddle account. Do not delete these entities after testing: products, prices,
customers, subscriptions, transactions, and the notification destination are
production infrastructure.

## 1. Create the permanent catalog

Create three products in the live Paddle account: Lead Engine, Pro, and Pro + Hubble.
Give each product one monthly recurring price and one yearly recurring price.
Use the exact base prices, country overrides, and lowest-denomination amounts in
`docs/PADDLE_CATALOG_MANIFEST.md`. Copy the six returned `pri_...` IDs into the
matching deployment variables documented in `.env.example`.

## 2. Add live credentials

In Paddle, create a live client-side token under **Developer tools >
Authentication**. It must start with `live_`. Create a server-side API key as
well. Add both to the deployment environment; never put the API key in browser
code.

Set `PADDLE_ENVIRONMENT=production`. The app intentionally has no default and
will fail if this value or any required price ID is absent.

## 3. Apply the database migration

Apply `supabase/migrations/0056_paddle_billing.sql` to the production Supabase
project before enabling webhook delivery. It adds the verified Paddle mirrors,
idempotency ledger, and entitlement reconciliation functions.

Access is granted for `active` and `trialing`. A `trialing` subscription uses
the internal 10-credit trial plan; the purchased tier is applied only when
Paddle reports `active`. Access is denied for `paused`,
`past_due`, and `canceled`. A scheduled future cancel or pause does not revoke
access while the actual status remains `active` or `trialing`.

## 4. Create the permanent notification destination

After deployment, open **Developer tools > Notifications** in the live Paddle
dashboard and create a destination for:

`https://app.outlio.io/api/webhooks/paddle`

Subscribe it to:

- `customer.created`
- `customer.updated`
- `subscription.created`
- `subscription.updated`
- `subscription.canceled`
- `transaction.completed`

Copy that destination's signing secret into `PADDLE_WEBHOOK_SECRET`. This is not
the Paddle API key. Keep the destination and secret permanently.

## 5. Configure checkout

Open **Checkout > Checkout settings** and set the default payment link to the
live pricing page:

`https://app.outlio.io/pricing`

The domain must be approved by Paddle. A live checkout cannot use localhost.
Localhost is only valid with the sandbox account and sandbox credentials.

## 6. Live-safe verification

Do not complete a real payment yet. On the deployed live page:

1. Confirm localized totals load for the visitor's country.
2. Toggle monthly/yearly and confirm Paddle's six totals appear unchanged by
   frontend formatting.
3. Open each tier's Subscribe button and confirm the one-page overlay contains
   the same selected price and prefilled signed-in email.
4. Close each overlay without payment.

A real live transaction and `/welcome` redirect should only be tested after
Paddle account verification and domain approval.
