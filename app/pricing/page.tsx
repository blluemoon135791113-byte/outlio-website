import type { Metadata } from 'next'
import { headers } from 'next/headers'

import Footer from '@/app/components/Footer'
import Nav from '@/app/components/Nav'
import { FastSpringPricing } from '@/components/leadengine/FastSpringPricing'
import { Pricing } from '@/components/leadengine/Pricing'
import {
  countryCodeFromHeader,
  getPricingTiers,
  getStorefront,
} from '@/lib/fastspring/config'
import { getProductPrices } from '@/lib/fastspring/pricing'
import { appUrl } from '@/lib/site'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Lead Engine Pricing | Outlio',
  description: 'Localized monthly and annual pricing for Outlio Lead Engine.',
  alternates: { canonical: appUrl('/pricing') },
}

export default async function PricingPage() {
  const requestHeaders = await headers()
  const countryCode = countryCodeFromHeader(requestHeaders.get('x-vercel-ip-country'))
  const {
    data: { user },
  } = await (await createClient()).auth.getUser()

  let storefront: string
  let tiers: ReturnType<typeof getPricingTiers>

  try {
    storefront = getStorefront().storefront
    tiers = getPricingTiers()
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown configuration error'
    console.warn(`[fastspring-pricing] Checkout configuration is incomplete: ${reason}`)

    return (
      <>
        <Nav surface="leadengine" />
        <main>
          <Pricing
            ctaHref="/sign-up"
            ctaLabel="Get This"
          />
        </main>
        <Footer surface="leadengine" />
      </>
    )
  }

  /*
   * Price display is a nicety, not a gate. If the FastSpring price API is
   * unreachable the page still renders and checkout still opens — the popup
   * quotes the authoritative amount either way.
   */
  let prices: Record<string, string> = {}
  try {
    prices = await getProductPrices(
      tiers.flatMap((tier) => [tier.productPath.month, tier.productPath.year]),
      countryCode,
    )
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown pricing error'
    console.warn(`[fastspring-pricing] Could not load localized prices: ${reason}`)
  }

  return (
    <>
      <Nav surface="leadengine" />
      <main>
        <FastSpringPricing
          countryCode={countryCode}
          customerEmail={user?.email}
          customerUserId={user?.id}
          storefront={storefront}
          tiers={tiers}
          prices={prices}
        />
      </main>
      <Footer surface="leadengine" />
    </>
  )
}
