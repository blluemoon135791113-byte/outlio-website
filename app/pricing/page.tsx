import type { Metadata } from 'next'
import { headers } from 'next/headers'

import Footer from '@/app/components/Footer'
import Nav from '@/app/components/Nav'
import { PaddlePricing } from '@/components/leadengine/PaddlePricing'
import { Pricing } from '@/components/leadengine/Pricing'
import {
  countryCodeFromHeader,
  getPaddleBrowserConfig,
  getPricingTiers,
} from '@/lib/paddle/config'
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
  let paddle: ReturnType<typeof getPaddleBrowserConfig>
  let tiers: ReturnType<typeof getPricingTiers>

  try {
    paddle = getPaddleBrowserConfig()
    tiers = getPricingTiers()
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown configuration error'
    console.warn(`[paddle-pricing] Checkout configuration is incomplete: ${reason}`)

    return (
      <>
        <Nav surface="leadengine" />
        <main>
          <Pricing
            billingNotice="Secure subscription checkout is temporarily unavailable. You can still create your account and begin the 3-day trial with 10 credits; no payment will be taken from this page."
            ctaHref="/sign-up"
            ctaLabel="Start 3-day free trial"
          />
        </main>
        <Footer surface="leadengine" />
      </>
    )
  }

  return (
    <>
      <Nav surface="leadengine" />
      <main>
        <PaddlePricing
          countryCode={countryCode}
          customerEmail={user?.email}
          customerUserId={user?.id}
          environment={paddle.environment}
          token={paddle.token}
          tiers={tiers}
        />
      </main>
      <Footer surface="leadengine" />
    </>
  )
}
