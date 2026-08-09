'use client'

import { useActionState } from 'react'

import {
  redeemCodeAction,
  startCheckoutAction,
  submitAccessRequestAction,
  type AccessActionState,
} from '@/lib/access/actions'

const INITIAL: AccessActionState = { status: 'idle' }

type PlanOption = { id: string; name: string }

function Feedback({ state }: { state: AccessActionState }) {
  if (state.status === 'idle') return null
  const isError = state.status === 'error'
  return (
    <p
      role="alert"
      className={
        isError
          ? 'mt-3 rounded-[var(--radius-md)] border border-danger/25 bg-danger-soft px-3 py-2 text-sm leading-relaxed text-danger'
          : 'mt-3 rounded-[var(--radius-md)] border border-success/25 bg-success-soft px-3 py-2 text-sm leading-relaxed text-success'
      }
    >
      {state.message}
    </p>
  )
}

function Card({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-sm)]">
      <h3 className="text-base font-semibold tracking-[-0.015em] text-ink">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  )
}

const buttonClass =
  'inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] bg-accent px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-accent-deep active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60'

const secondaryButtonClass =
  'inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-4 text-sm font-semibold text-ink transition-[border-color,background-color,transform] duration-150 ease-out hover:border-accent/35 hover:bg-accent-soft/40 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60'

const inputClass =
  'w-full rounded-[var(--radius-md)] border border-border bg-panel px-3 py-2.5 text-sm text-ink transition-colors duration-150 placeholder:text-muted/70 hover:border-border-strong focus:border-accent'

export function RequestOptions({
  plans,
  invitationsOn,
  hasPendingRequest,
}: {
  plans: PlanOption[]
  invitationsOn: boolean
  hasPendingRequest: boolean
}) {
  const [requestState, requestAction] = useActionState(
    submitAccessRequestAction,
    INITIAL,
  )
  const [checkoutState, checkoutAction] = useActionState(startCheckoutAction, INITIAL)
  const [redeemState, redeemAction] = useActionState(redeemCodeAction, INITIAL)

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card
        title="Request approval"
        description="Tell us about your use case and we'll review it. This is the usual route."
      >
        <form action={requestAction} className="space-y-3">
          <input type="hidden" name="request_type" value="manual_approval" />
          <label htmlFor="message" className="sr-only">
            What do you plan to use Outlio for?
          </label>
          <textarea
            id="message"
            name="message"
            rows={3}
            maxLength={2000}
            placeholder="What do you plan to use Outlio for?"
            className={inputClass}
          />
          <button type="submit" className={buttonClass} disabled={hasPendingRequest}>
            {hasPendingRequest ? 'Request already submitted' : 'Request access'}
          </button>
          <Feedback state={requestState} />
        </form>
      </Card>

      <Card
        title="Talk to us first"
        description="Prefer a conversation? We'll set up a short call to walk through it."
      >
        <form action={requestAction} className="space-y-3">
          <input type="hidden" name="request_type" value="sales_call" />
          <button
            type="submit"
            className={secondaryButtonClass}
            disabled={hasPendingRequest}
          >
            Request a call
          </button>
        </form>
      </Card>

      <Card
        title="Purchase access"
        description="Choose a plan and we'll get you set up with payment details."
      >
        <form action={checkoutAction} className="space-y-3">
          <label htmlFor="plan_id" className="sr-only">
            Plan
          </label>
          <select id="plan_id" name="plan_id" className={inputClass} defaultValue="">
            <option value="" disabled>
              Choose a plan…
            </option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="submit" className={secondaryButtonClass}>
            Continue
          </button>
          <Feedback state={checkoutState} />
        </form>
      </Card>

      {invitationsOn ? (
        <Card
          title="Redeem an invitation"
          description="Been given a code? Enter it here to activate your access immediately."
        >
          <form action={redeemAction} className="space-y-3">
            <label htmlFor="code" className="sr-only">
              Invitation code
            </label>
            <input
              id="code"
              name="code"
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="Your invitation code"
              className={inputClass}
            />
            <button type="submit" className={secondaryButtonClass}>
              Redeem code
            </button>
            <Feedback state={redeemState} />
          </form>
        </Card>
      ) : null}
    </div>
  )
}
