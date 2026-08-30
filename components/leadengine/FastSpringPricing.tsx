'use client'

import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { useCallback, useEffect, useState } from 'react'

import type { BillingInterval, Tier } from '@/lib/fastspring/types'

const SBL_SRC = 'https://sbl.onfastspring.com/sbl/1.0.9/fastspring-builder.min.js'

/** Global name the SBL script tag is told to call when the popup closes. */
const POPUP_CLOSED_CALLBACK = 'outlioFastSpringPopupClosed'

type FastSpringSession = {
  products?: { path: string; quantity: number }[]
  paymentContact?: { email?: string }
  tags?: Record<string, string>
  country?: string
  reset?: boolean
}

type FastSpringBuilder = {
  push: (session: FastSpringSession) => void
  checkout: () => void
  reset: () => void
}

declare global {
  interface Window {
    fastspring?: { builder: FastSpringBuilder }
    [POPUP_CLOSED_CALLBACK]?: (data: unknown) => void
  }
}

type Props = {
  countryCode?: string
  customerEmail?: string
  customerUserId?: string
  storefront: string
  tiers: Tier[]
  /** FastSpring's own formatted price strings, keyed by product path. */
  prices: Record<string, string>
}

export function FastSpringPricing({
  countryCode,
  customerEmail,
  customerUserId,
  storefront,
  tiers,
  prices,
}: Props) {
  const router = useRouter()
  const [billing, setBilling] = useState<BillingInterval>('month')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openingPath, setOpeningPath] = useState<string | null>(null)

  /*
   * The SBL reads its callbacks by global name off `window`, so the handler has
   * to be installed before the script runs and removed when this page unmounts.
   */
  useEffect(() => {
    window[POPUP_CLOSED_CALLBACK] = (data: unknown) => {
      setOpeningPath(null)

      // The popup calls this on abandonment too. Only a completed order, which
      // carries a reference, is a purchase worth routing on.
      const reference =
        data && typeof data === 'object' && 'reference' in data
          ? (data as { reference?: unknown }).reference
          : undefined

      if (typeof reference === 'string' && reference.length > 0) router.push('/welcome')
    }

    return () => {
      delete window[POPUP_CLOSED_CALLBACK]
    }
  }, [router])

  const subscribe = useCallback(
    (tier: Tier) => {
      const path = tier.productPath[billing]
      const builder = window.fastspring?.builder
      if (!builder) {
        setError('Checkout is still loading. Please try again in a moment.')
        return
      }

      setOpeningPath(path)
      setError(null)

      try {
        builder.push({
          // One tier per checkout. Resetting prevents a monthly and a yearly
          // plan ending up in the same cart across two clicks.
          reset: true,
          products: [{ path, quantity: 1 }],
          ...(countryCode ? { country: countryCode } : {}),
          ...(customerEmail ? { paymentContact: { email: customerEmail } } : {}),
          ...(customerUserId
            ? {
                // Tags survive into every webhook for the resulting order and
                // subscription. This is what binds a purchase to an Outlio user.
                tags: {
                  outlio_user_id: customerUserId,
                  plan_key: tier.planKey,
                  billing_interval: billing,
                },
              }
            : {}),
        })
        builder.checkout()
      } catch {
        setOpeningPath(null)
        setError('Checkout could not open. Please refresh or contact support.')
      }
    },
    [billing, countryCode, customerEmail, customerUserId],
  )

  return (
    <>
      <Script
        id="fsc-api"
        src={SBL_SRC}
        strategy="afterInteractive"
        data-storefront={storefront}
        data-popup-closed={POPUP_CLOSED_CALLBACK}
        onReady={() => setReady(true)}
        onError={() =>
          setError('We could not load secure checkout. Please refresh or contact support.')
        }
      />

      <section className="bg-paper px-4 py-16 sm:py-24" aria-labelledby="pricing-heading">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
              FastSpring-secured billing
            </p>
            <h1 id="pricing-heading" className="mt-4 text-4xl font-bold uppercase tracking-tight sm:text-6xl">
              Pick the pace that fits.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-muted sm:text-lg">
              Prices are shown in your local currency where available. FastSpring calculates every
              total, including location-aware tax treatment.
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
              const path = tier.productPath[billing]
              const formattedTotal = prices[path]

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
                  <div className="mt-7 min-h-16">
                    {formattedTotal ? (
                      <p className="flex items-end gap-2">
                        <span className="text-5xl font-black tracking-tight text-ink">{formattedTotal}</span>
                        <span className="pb-1 text-sm font-medium text-muted">/{billing}</span>
                      </p>
                    ) : (
                      <p className="pt-4 text-sm font-medium text-muted">
                        Your local price is shown at checkout.
                      </p>
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
                    disabled={!ready || openingPath === path}
                    className={`mt-8 inline-flex h-12 items-center justify-center rounded-[var(--radius-md)] px-5 text-base font-semibold transition-[background-color,transform] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 ${
                      tier.featured
                        ? 'bg-accent text-white hover:bg-accent-deep'
                        : 'bg-ink text-cream hover:bg-accent'
                    }`}
                  >
                    {openingPath === path ? 'Opening checkout…' : 'Subscribe'}
                  </button>
                </article>
              )
            })}
          </div>

          <p className="mt-10 text-center text-sm text-muted">
            Secure checkout is provided by FastSpring, our merchant of record.
          </p>
        </div>
      </section>
    </>
  )
}
