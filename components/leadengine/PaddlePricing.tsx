'use client'

import {
  initializePaddle,
  type CountryCode,
  type Paddle,
  type PricePreviewResponse,
} from '@paddle/paddle-js'
import { useEffect, useMemo, useState } from 'react'

import type { BillingInterval, PaddleEnvironment, Tier } from '@/lib/paddle/types'

type Props = {
  countryCode?: string
  customerEmail?: string
  customerUserId?: string
  environment: PaddleEnvironment
  token: string
  tiers: Tier[]
}

type PriceState = Record<string, string>

export function PaddlePricing({
  countryCode,
  customerEmail,
  customerUserId,
  environment,
  token,
  tiers,
}: Props) {
  const [billing, setBilling] = useState<BillingInterval>('month')
  const [paddle, setPaddle] = useState<Paddle>()
  const [prices, setPrices] = useState<PriceState>({})
  const [error, setError] = useState<string | null>(null)
  const [openingPriceId, setOpeningPriceId] = useState<string | null>(null)

  const allPriceIds = useMemo(
    () => tiers.flatMap((tier) => [tier.priceId.month, tier.priceId.year]),
    [tiers],
  )

  useEffect(() => {
    let cancelled = false

    async function setup() {
      try {
        const instance = await initializePaddle({ token, environment })
        if (!instance || cancelled) return
        setPaddle(instance)

        // Preview every price as the same one-item cart that Checkout will
        // open. This avoids mixed monthly/yearly carts and guarantees the
        // displayed line total corresponds to the exact selected checkout.
        const previews = await Promise.all(
          allPriceIds.map((priceId) => instance.PricePreview({
            items: [{ priceId, quantity: 1 }],
            ...(countryCode
              ? { address: { countryCode: countryCode as CountryCode } }
              : {}),
          })),
        )
        if (cancelled) return
        setPrices(Object.assign({}, ...previews.map(pricesFromPreview)))
      } catch {
        if (!cancelled) {
          setError('We could not load localized pricing. Please refresh or contact support.')
        }
      }
    }

    void setup()
    return () => {
      cancelled = true
    }
  }, [allPriceIds, countryCode, environment, token])

  function subscribe(tier: Tier) {
    const selectedPriceId = tier.priceId[billing]
    if (!paddle || !prices[selectedPriceId]) return

    setOpeningPriceId(selectedPriceId)
    setError(null)
    try {
      paddle.Checkout.open({
        items: [{ priceId: selectedPriceId, quantity: 1 }],
        settings: {
          displayMode: 'overlay',
          variant: 'one-page',
          successUrl: `${window.location.origin}/welcome`,
        },
        ...(customerEmail ? { customer: { email: customerEmail } } : {}),
        ...(customerUserId
          ? {
              customData: {
                outlio_user_id: customerUserId,
                plan_key: tier.planKey,
                billing_interval: billing,
              },
            }
          : {}),
      })
    } catch {
      setError('Checkout could not open. Please refresh or contact support.')
    } finally {
      setOpeningPriceId(null)
    }
  }

  return (
    <section className="bg-paper px-4 py-16 sm:py-24" aria-labelledby="pricing-heading">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
            Paddle-secured billing
          </p>
          <h1 id="pricing-heading" className="mt-4 text-4xl font-bold uppercase tracking-tight sm:text-6xl">
            Pick the pace that fits.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-muted sm:text-lg">
            Prices are shown in your local currency where available. Paddle calculates every total,
            including location-aware tax treatment.
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-muted">
            These plans purchase access to self-serve Lead Engine software only. They do not include
            managed marketing, outreach campaigns, appointment setting, consulting, or other human services.
          </p>

          <div className="mx-auto mt-8 inline-flex rounded-full bg-cream p-1 shadow-[var(--shadow-sm)]" role="group" aria-label="Billing interval">
            {(['month', 'year'] as const).map((interval) => (
              <button
                key={interval}
                type="button"
                onClick={() => setBilling(interval)}
                aria-pressed={billing === interval}
                className={`rounded-full px-5 py-2.5 text-sm font-semibold transition-colors ${
                  billing === interval ? 'bg-accent text-white' : 'text-muted hover:text-ink'
                }`}
              >
                {interval === 'month' ? 'Monthly' : 'Yearly'}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <p role="alert" className="mx-auto mt-8 max-w-2xl rounded-xl bg-danger-soft px-4 py-3 text-center text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {tiers.map((tier) => {
            const selectedPriceId = tier.priceId[billing]
            const formattedTotal = prices[selectedPriceId]
            const checkoutReady = Boolean(paddle && formattedTotal)

            return (
              <article
                key={tier.name}
                className={`relative flex flex-col rounded-[var(--radius-xl)] bg-panel p-7 shadow-[var(--shadow-md)] ${
                  tier.featured ? 'ring-2 ring-accent' : 'ring-1 ring-border'
                }`}
              >
                {tier.featured ? (
                  <span className="absolute -top-3 left-7 rounded-full bg-accent px-3 py-1 text-[11px] font-bold uppercase tracking-[0.15em] text-white">
                    Most popular
                  </span>
                ) : null}
                <h2 className="text-2xl font-bold tracking-tight text-ink">{tier.name}</h2>
                <p className="mt-2 min-h-12 text-sm leading-6 text-muted">{tier.description}</p>
                <div className="mt-7 min-h-16" aria-live="polite">
                  {formattedTotal ? (
                    <p className="flex items-end gap-2">
                      <span className="text-5xl font-black tracking-tight text-ink">{formattedTotal}</span>
                      <span className="pb-1 text-sm font-medium text-muted">/{billing}</span>
                    </p>
                  ) : (
                    <div className="h-12 w-40 animate-pulse rounded-xl bg-cream" aria-label="Loading price" />
                  )}
                </div>
                <ul className="mt-7 flex-1 space-y-3 text-sm leading-6 text-muted">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex gap-3">
                      <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => subscribe(tier)}
                  disabled={!checkoutReady || openingPriceId === selectedPriceId}
                  className={`mt-8 inline-flex h-12 items-center justify-center rounded-[var(--radius-md)] px-5 text-base font-semibold transition-[background-color,transform] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 ${
                    tier.featured
                      ? 'bg-accent text-white hover:bg-accent-deep'
                      : 'bg-ink text-cream hover:bg-accent'
                  }`}
                >
                  {openingPriceId === selectedPriceId ? 'Opening checkout…' : 'Subscribe'}
                </button>
              </article>
            )
          })}
        </div>

        <p className="mt-10 text-center text-sm text-muted">
          Secure one-page checkout is provided by Paddle, our merchant of record.
        </p>
      </div>
    </section>
  )
}

export function pricesFromPreview(preview: PricePreviewResponse): PriceState {
  return Object.fromEntries(
    preview.data.details.lineItems.map((lineItem) => [
      lineItem.price.id,
      lineItem.formattedTotals.total,
    ]),
  )
}
