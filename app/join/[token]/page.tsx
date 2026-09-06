import type { Metadata } from 'next'
import Link from 'next/link'

import { AuthShell } from '@/components/auth/AuthShell'
import { JoinInvitation } from '@/components/workspaces/JoinInvitation'
import { requireUser } from '@/lib/auth/access'
import { describeInvitation } from '@/lib/workspaces/invitations'

export const metadata: Metadata = {
  title: 'Join a workspace | Outlio',
  robots: { index: false, follow: false },
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'an admin',
  manager: 'a manager',
  setter: 'a setter',
  viewer: 'a viewer',
}

/**
 * Invitation landing page.
 *
 * ⚠️ READS ONLY. Accepting is a Server Action behind an explicit button — see
 * `describeInvitation`. Rendering must never spend the invitation.
 *
 * `proxy.ts` lists `/join` as a protected prefix, so an unauthenticated visitor
 * is sent to sign-in with `?next=` still carrying the token and lands back here
 * afterwards.
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const ctx = await requireUser()
  const invitation = await describeInvitation(token)

  if (!invitation) {
    return (
      <AuthShell
        title="This invitation is not valid"
        subtitle="It may have been used, revoked, or it has expired."
        footer={
          <Link href="/dashboard" className="font-semibold text-accent hover:underline">
            Go to your dashboard
          </Link>
        }
      >
        <p className="text-sm text-muted">
          Ask whoever invited you to send a new link.
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Join a workspace"
      subtitle="Review the invitation before you accept it."
      footer={
        <Link href="/dashboard" className="font-semibold text-accent hover:underline">
          Not now
        </Link>
      }
    >
      <JoinInvitation
        token={token}
        workspaceName={invitation.workspaceName}
        role={ROLE_LABEL[invitation.role] ?? invitation.role}
        invitedEmail={invitation.email}
        signedInEmail={ctx.email}
      />
    </AuthShell>
  )
}
