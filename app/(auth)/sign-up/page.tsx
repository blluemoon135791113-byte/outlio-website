import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { SignUpForm } from './SignUpForm'
import { AuthShell } from '@/components/auth/AuthShell'
import { getAccessContext } from '@/lib/auth/access'
import { REFERRAL_REWARD_CREDITS, normalizeReferralCode } from '@/lib/referrals/constants'

export const metadata: Metadata = {
  title: 'Create an account | Outlio',
  robots: { index: false, follow: false },
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>
}) {
  const ctx = await getAccessContext()
  if (ctx.userId) redirect('/dashboard')

  // Normalized here so a mangled link cannot put junk in a hidden field.
  const referralCode = normalizeReferralCode((await searchParams).ref ?? '')

  return (
    <AuthShell
      title="Create an account"
      subtitle={
        referralCode
          ? `You were invited by an Outlio customer. You'll both get ${REFERRAL_REWARD_CREDITS} bonus credits once your access is approved.`
          : "Access is approved manually. You'll be able to request it once your email is verified."
      }
      footer={
        <>
          Already have an account?{' '}
          <Link href="/sign-in" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm referralCode={referralCode} />
    </AuthShell>
  )
}
