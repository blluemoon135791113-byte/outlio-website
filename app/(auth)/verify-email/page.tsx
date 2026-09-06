import type { Metadata } from 'next'
import Link from 'next/link'

import { ResendForm } from './ResendForm'
import { AuthShell } from '@/components/auth/AuthShell'
import { getAccessContext } from '@/lib/auth/access'

export const metadata: Metadata = {
  title: 'Verify your email | Outlio',
  robots: { index: false, follow: false },
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>
}) {
  const { sent } = await searchParams
  const ctx = await getAccessContext()

  return (
    <AuthShell
      title="Verify your email"
      subtitle={
        sent
          ? 'We sent you a verification link. Open it to activate your account.'
          : 'Your email address needs to be verified before you can continue.'
      }
      footer={
        <Link href="/sign-in" className="font-semibold text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      <div className="space-y-6">
        <div className="rounded-[var(--radius-md)] bg-info-soft px-3 py-2.5 text-sm leading-relaxed text-info">
          Check your spam folder if it hasn&apos;t arrived within a few minutes.
        </div>

        <ResendForm defaultEmail={ctx.email ?? ''} />
      </div>
    </AuthShell>
  )
}
