import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { RequestOptions } from '@/components/access/RequestOptions'
import { invitationsEnabled } from '@/lib/access/actions'
import { requireUser, type AccessReason } from '@/lib/auth/access'
import { listActivePlans } from '@/lib/limits/plans'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = {
  title: 'Access | Outlio',
  robots: { index: false, follow: false },
}

/**
 * Access status and request options.
 *
 * Uses requireUser(), NOT requireAccess() — otherwise a denied user would be
 * redirected here in an infinite loop. Each reason renders a distinct,
 * plain-language state with a clear next action.
 */
export default async function AccessPage() {
  const ctx = await requireUser()

  // Users who already have access have no business here.
  if (ctx.canUseScraper) redirect('/dashboard')

  const supabase = createAdminClient()
  // Service role bypasses RLS — scoping by the verified session id is mandatory.
  const { data: pending } = await supabase
    .from('access_requests')
    .select('id, request_type, created_at')
    .eq('user_id', ctx.userId!)
    .eq('status', 'pending')
    .maybeSingle()

  const [plans, invitationsOn] = await Promise.all([
    listActivePlans(),
    invitationsEnabled(),
  ])

  const { title, body, tone } = describe(ctx.reason)

  // Terminal states offer no self-service action.
  const showOptions = !['suspended', 'rejected', 'email_unverified'].includes(ctx.reason)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          Outlio account
        </p>
        <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-[30px]">
          Access status
        </h1>
        <p className="mt-1 text-sm text-muted">{ctx.email}</p>
      </header>

      <div
        className={
          tone === 'danger'
            ? 'rounded-[var(--radius-xl)] border border-danger/25 bg-danger-soft p-6 shadow-[var(--shadow-sm)]'
            : tone === 'warning'
              ? 'rounded-[var(--radius-xl)] border border-warning/25 bg-warning-soft p-6 shadow-[var(--shadow-sm)]'
              : 'rounded-[var(--radius-xl)] border border-info/25 bg-info-soft p-6 shadow-[var(--shadow-sm)]'
        }
      >
        <h2
          className={
            tone === 'danger'
              ? 'text-base font-semibold text-danger'
              : tone === 'warning'
                ? 'text-base font-semibold text-warning'
                : 'text-base font-semibold text-info'
          }
        >
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink">{body}</p>

        {pending ? (
          <p className="mt-3 text-sm text-ink">
            Submitted{' '}
            <time dateTime={pending.created_at}>
              {new Date(pending.created_at).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </time>
            .
          </p>
        ) : null}
      </div>

      {showOptions ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">
            How would you like to get access?
          </h2>
          <RequestOptions
            plans={plans.map((p) => ({ id: p.id, name: p.name }))}
            invitationsOn={invitationsOn}
            hasPendingRequest={Boolean(pending)}
          />
        </div>
      ) : null}

      <p className="text-sm text-muted">
        Questions?{' '}
        <a
          href="mailto:husnain@outlio.io"
          className="font-medium text-accent hover:underline"
        >
          Contact us
        </a>
        {' | '}
        <Link href="/dashboard" className="font-medium text-accent hover:underline">
          Back to dashboard
        </Link>
      </p>
    </div>
  )
}

function describe(reason: AccessReason): {
  title: string
  body: string
  tone: 'info' | 'warning' | 'danger'
} {
  switch (reason) {
    case 'pending':
      return {
        title: 'Under review',
        body: "Your access request is being reviewed. We'll email you as soon as it's approved.",
        tone: 'info',
      }
    case 'rejected':
      return {
        title: 'Not approved',
        body: 'Your access request was not approved. Get in touch if you think this is a mistake.',
        tone: 'danger',
      }
    case 'expired':
      return {
        title: 'Access expired',
        body: 'Your access period has ended. Renew below to pick up where you left off.',
        tone: 'warning',
      }
    case 'suspended':
      return {
        title: 'Account suspended',
        body: 'This account has been suspended. Contact support for details.',
        tone: 'danger',
      }
    case 'limit_reached':
      return {
        title: 'Plan limit reached',
        body: "You've used everything included in your plan for this period. It resets at the start of next month, or you can move to a larger plan.",
        tone: 'warning',
      }
    case 'payment_required':
      return {
        title: 'No active plan',
        body: 'Your account does not have a plan assigned yet. Choose one below or request approval.',
        tone: 'warning',
      }
    case 'email_unverified':
      return {
        title: 'Email not verified',
        body: 'Verify your email address to continue. Check your inbox for the link.',
        tone: 'warning',
      }
    case 'no_request':
    case 'unauthenticated':
    case 'ok':
      return {
        title: 'Request access',
        body: 'Your account is registered but does not have access yet. Access is approved manually, so choose an option below to get started.',
        tone: 'info',
      }
  }
}
