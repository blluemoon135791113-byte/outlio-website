'use client'

import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { useCallback, useEffect, useState } from 'react'

import type { BillingInterval, Tier } from '@/lib/fastspring/types'

import styles from './Pricing.module.css'

const SBL_SRC = 'https://sbl.onfastspring.com/sbl/1.0.9/fastspring-builder.min.js'

/** Global name the SBL script tag is told to call when the popup closes. */
const POPUP_CLOSED_CALLBACK = 'outlioFastSpringPopupClosed'

const PLAN_USAGE: Record<Tier['planKey'], { credits: string; capacity: string }> = {
  starter: { credits: '100 credits', capacity: '2,500 / month' },
  professional: { credits: '300 credits', capacity: '7,500 / month' },
  custom: { credits: '1000+ credits', capacity: '25,000+ / month' },
}

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

      <section className={styles.section} aria-labelledby="pricing-heading">
        <div className={styles.container}>
          <div className={styles.intro}>
            <p className={styles.eyebrow}>
              FastSpring-secured billing
            </p>
            <h1 id="pricing-heading" className={styles.heading}>
              Pick the pace that fits.
            </h1>
            <p className={styles.description}>
              Prices are shown in your local currency where available. FastSpring calculates every
              total, including location-aware tax treatment.
            </p>
            <p className={styles.checkoutSubcopy}>
              These plans purchase access to self-serve Lead Engine software only. They do not include
              managed marketing, outreach campaigns, appointment setting, consulting, or other human services.
            </p>

            <div className={styles.billingToggle} role="group" aria-label="Billing interval">
              {(['month', 'year'] as const).map((interval) => (
                <button
                  key={interval}
                  type="button"
                  onClick={() => setBilling(interval)}
                  aria-pressed={billing === interval}
                  className={`${styles.billingOption} ${billing === interval ? styles.billingOptionActive : ''}`}
                >
                  {interval === 'month' ? 'Monthly' : 'Yearly'}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <p role="alert" className={styles.checkoutError}>
              {error}
            </p>
          ) : null}

          <div className={styles.pricingStrip}>
            {tiers.map((tier, index) => {
              const path = tier.productPath[billing]
              const formattedTotal = prices[path]
              const usage = PLAN_USAGE[tier.planKey]

              return (
                <article
                  key={tier.name}
                  className={`${styles.planPanel} ${tier.featured ? styles.featuredPlan : ''}`}
                >
                  {tier.featured ? (
                    <span className={styles.badge}>
                      Most popular
                    </span>
                  ) : null}

                  <div className={styles.planIntro}>
                    <header>
                      <div className={styles.planTopline}>
                        <p className={styles.planIndex}>0{index + 1}</p>
                        <span className={styles.drawerHint} aria-hidden>→</span>
                      </div>
                      <h2 className={styles.planName}>{tier.name}</h2>
                      <p className={styles.planBlurb}>{tier.description}</p>
                    </header>

                    <div className={styles.priceBlock}>
                    {formattedTotal ? (
                        <>
                          <p className={styles.price}>{formattedTotal}</p>
                          <p className={styles.period}>/{billing}</p>
                        </>
                    ) : (
                        <p className={styles.checkoutPriceFallback}>
                        Your local price is shown at checkout.
                      </p>
                    )}
                    </div>

                    <dl className={styles.planMetrics}>
                      <div className={styles.planStat}>
                        <dt>Credits</dt>
                        <dd>{usage.credits}</dd>
                      </div>
                      <div className={styles.planStat}>
                        <dt>Capacity</dt>
                        <dd>{usage.capacity}</dd>
                      </div>
                    </dl>

                    <button
                      type="button"
                      onClick={() => subscribe(tier)}
                      disabled={!ready || openingPath === path}
                      className={`${styles.checkoutCta} ${tier.featured ? styles.checkoutCtaFeatured : ''}`}
                    >
                      <span>{openingPath === path ? 'Opening checkout…' : 'Get This'}</span>
                      <span aria-hidden>↗</span>
                    </button>
                  </div>

                  <div className={styles.planIncludes}>
                    <div className={styles.includesInner}>
                      <p className={styles.listLabel}>Plan Includes</p>
                      <ul className={styles.features}>
                        {tier.features.map((feature) => (
                          <li key={feature}>
                            <span aria-hidden className={styles.checkoutTick}>✓</span>
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>

          <p className={styles.merchantNote}>
            Secure checkout is provided by FastSpring, our merchant of record.
          </p>
        </div>
      </section>
    </>
  )
}
