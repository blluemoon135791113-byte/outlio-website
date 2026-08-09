import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { MfaChallengeForm } from './MfaChallengeForm'
import { AuthShell } from '@/components/auth/AuthShell'
import { safeRedirectPath } from '@/lib/auth/redirects'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Verify sign-in | Outlio', robots: { index: false, follow: false } }

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const next = safeRedirectPath((await searchParams).next)
  if (assurance?.currentLevel === 'aal2') redirect(next)
  if (assurance?.nextLevel !== 'aal2') {
    redirect('/dashboard/settings?required_mfa=1#security')
  }

  return <AuthShell title="Verify it’s you" subtitle="Enter the code from your authenticator app to finish signing in."><MfaChallengeForm next={next} /></AuthShell>
}
