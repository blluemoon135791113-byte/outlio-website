'use server'

import { redirect } from 'next/navigation'

import { assertUser } from '@/lib/auth/access'
import { getPaddleClient } from '@/lib/paddle/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function openPaddleCustomerPortal(): Promise<never> {
  // Authentication happens before any customer lookup or Paddle API call.
  const user = await assertUser()
  const admin = createAdminClient()

  const { data: subscriptions, error: subscriptionError } = await admin
    .from('paddle_subscriptions')
    .select('subscription_id, customer_id, status')
    .eq('user_id', user.userId!)
    .order('updated_at', { ascending: false })
    .limit(25)

  if (subscriptionError) {
    throw new Error(`Could not load Paddle subscriptions: ${subscriptionError.message}`)
  }

  const preferred = subscriptions?.find(({ status }) => status === 'active' || status === 'trialing')
    ?? subscriptions?.[0]

  let customerId: string | null = preferred?.customer_id ?? null
  if (!customerId) {
    const { data: customer, error: customerError } = await admin
      .from('paddle_customers')
      .select('customer_id')
      .eq('user_id', user.userId!)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (customerError) throw new Error(`Could not load Paddle customer: ${customerError.message}`)
    customerId = customer?.customer_id ?? null
  }

  if (!customerId) redirect('/leadengine/pricing?billing=not-ready')

  // `redirect()` never returns, but retaining a local non-null value keeps the
  // Paddle SDK boundary explicit for TypeScript and future refactors.
  const resolvedCustomerId = customerId

  const subscriptionIds = (subscriptions ?? [])
    .filter((subscription) => subscription.customer_id === resolvedCustomerId)
    .map((subscription) => subscription.subscription_id)

  const session = await getPaddleClient().customerPortalSessions.create(
    resolvedCustomerId,
    subscriptionIds,
  )

  // Portal links are temporary. Mint one per click and redirect immediately.
  redirect(session.urls.general.overview)
}
