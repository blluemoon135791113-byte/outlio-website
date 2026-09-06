'use server'

import { redirect } from 'next/navigation'

import { assertUser } from '@/lib/auth/access'
import { fastSpringApi } from '@/lib/fastspring/server'
import { createAdminClient } from '@/lib/supabase/admin'

type AuthenticateResponse = {
  accounts?: { result?: string; url?: string }[]
}

export async function openFastSpringAccountPortal(): Promise<never> {
  // Authentication happens before any account lookup or FastSpring API call.
  const user = await assertUser()
  const admin = createAdminClient()

  const { data: subscriptions, error: subscriptionError } = await admin
    .from('fastspring_subscriptions')
    .select('account_id, state, active')
    .eq('user_id', user.userId!)
    .order('updated_at', { ascending: false })
    .limit(25)

  if (subscriptionError) {
    throw new Error(`Could not load FastSpring subscriptions: ${subscriptionError.message}`)
  }

  const preferred = subscriptions?.find(({ active }) => active) ?? subscriptions?.[0]

  let accountId: string | null = preferred?.account_id ?? null
  if (!accountId) {
    const { data: account, error: accountError } = await admin
      .from('fastspring_accounts')
      .select('account_id')
      .eq('user_id', user.userId!)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (accountError) throw new Error(`Could not load FastSpring account: ${accountError.message}`)
    accountId = account?.account_id ?? null
  }

  if (!accountId) redirect('/pricing?billing=not-ready')

  const session = await fastSpringApi<AuthenticateResponse>(
    `/accounts/${encodeURIComponent(accountId)}/authenticate`,
  )

  const url = session.accounts?.find(({ result }) => result !== 'error')?.url
  if (!url) throw new Error('FastSpring returned no account management URL')

  // These links are short-lived. Mint one per click and redirect immediately.
  // The fragment lands the customer on Subscriptions rather than Orders.
  redirect(`${url}#/subscriptions`)
}
