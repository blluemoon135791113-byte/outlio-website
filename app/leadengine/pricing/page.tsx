import type { Metadata } from 'next'
import { headers } from 'next/headers'

import Footer from '@/app/components/Footer'
import Nav from '@/app/components/Nav'
import { PaddlePricing } from '@/components/leadengine/PaddlePricing'
import {
  countryCodeFromHeader,
  getPaddleBrowserConfig,
  getPricingTiers,
} from '@/lib/paddle/config'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Lead Engine Pricing | Outlio',
  description: 'Localized monthly and annual pricing for Outlio Lead Engine.',
  alternates: { canonical: 'https://app.outlio.io/leadengine/pricing' },
}

export default async function PricingPage() {
  const requestHeaders = await headers()
  const countryCode = countryCodeFromHeader(requestHeaders.get('x-vercel-ip-country'))
  const {
    data: { user },
  } = await (await createClient()).auth.getUser()
  const paddle = getPaddleBrowserConfig()

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
          tiers={getPricingTiers()}
        />
      </main>
      <Footer surface="leadengine" />
    </>
  )
}
