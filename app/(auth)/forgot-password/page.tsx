import type { Metadata } from 'next'
import Link from 'next/link'

import { ForgotPasswordForm } from './ForgotPasswordForm'
import { AuthShell } from '@/components/auth/AuthShell'

export const metadata: Metadata = {
  title: 'Reset your password | Outlio',
  robots: { index: false, follow: false },
}

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we’ll send a secure link to set a new password."
      footer={
        <Link href="/sign-in" className="font-semibold text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  )
}
