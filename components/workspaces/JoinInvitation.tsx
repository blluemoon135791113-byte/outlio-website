'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { FormFeedback } from '@/components/auth/FormFeedback'
import { SubmitButton } from '@/components/auth/SubmitButton'
import { acceptInvitationAction, type WorkspaceActionState } from '@/lib/workspaces/actions'

const INITIAL: WorkspaceActionState = { status: 'idle' }

export function JoinInvitation({
  token,
  workspaceName,
  role,
  invitedEmail,
  signedInEmail,
}: {
  token: string
  workspaceName: string
  role: string
  invitedEmail: string
  signedInEmail: string | null
}) {
  const [state, action] = useActionState(acceptInvitationAction, INITIAL)

  const mismatch = signedInEmail?.toLowerCase() !== invitedEmail

  return (
    <div className="space-y-5">
      <FormFeedback state={state} />

      <div className="rounded-[var(--radius-md)] bg-surface-muted p-4">
        <p className="text-sm text-muted">You have been invited to join</p>
        <p className="mt-1 text-lg font-semibold tracking-[-0.02em] text-ink">
          {workspaceName}
        </p>
        <p className="mt-1 text-sm text-muted">
          as <span className="font-semibold text-ink">{role}</span>
        </p>
      </div>

      {mismatch ? (
        // The server refuses this too — `redeem_workspace_invitation` compares
        // the invitation address with the caller's verified email. Saying so
        // here just saves the user a pointless click.
        <div className="space-y-3">
          <p className="text-sm text-muted">
            This invitation was sent to{' '}
            <span className="font-semibold text-ink">{invitedEmail}</span>, but you are
            signed in as <span className="font-semibold text-ink">{signedInEmail}</span>.
            Sign in with the invited address to accept it.
          </p>
          <Link
            href="/sign-in"
            className="inline-flex rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm font-semibold text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink"
          >
            Switch account
          </Link>
        </div>
      ) : state.status === 'success' ? (
        <Link
          href="/dashboard"
          className="inline-flex rounded-[var(--radius-md)] bg-accent px-4 py-3 text-sm font-semibold text-cream shadow-[var(--shadow-button)] transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.98]"
        >
          Go to dashboard
        </Link>
      ) : (
        <form action={action}>
          <input type="hidden" name="token" value={token} />
          <SubmitButton>Accept invitation</SubmitButton>
        </form>
      )}
    </div>
  )
}
