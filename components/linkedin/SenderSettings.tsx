'use client'

/**
 * LinkedIn accounts — the operator's own view of their sender.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE QUESTION THIS SCREEN ANSWERS IS "CAN I WORK TODAY, AND HOW MUCH?"    ║
 * ║                                                                           ║
 * ║  Everything else is secondary to those two facts, so they are the two      ║
 * ║  largest things on each card. Status first because a warning makes the     ║
 * ║  budget irrelevant; budget second because that is what a setter plans      ║
 * ║  their morning around.                                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ NO GREEN "SAFE" BADGE, ANYWHERE. §4.10 is explicit: manual mode cannot
 * claim continuous account-health monitoring, so the card says "Checked by you
 * 2 hours ago" — a fact somebody asserted — rather than "Healthy", which would
 * be a claim Outlio is in no position to make about LinkedIn's opinion.
 */
import { useActionState } from 'react'

import { RelativeTime } from '@/components/ui/LocalTime'
import {
  linkSenderAction,
  recordOwnerReview,
  reportSenderWarning,
  type SenderActionState,
} from '@/app/(product)/dashboard/settings/linkedin/actions'

export type SenderView = {
  senderId: string
  displayLabel: string
  status: string
  stage: number
  isMine: boolean
  lastOwnerReviewAt: string | null
  budgets: { label: string; remaining: number; cap: number; limitedBy: string | null }[]
}

export function SenderSettings({ senders, enabled }: { senders: SenderView[]; enabled: boolean }) {
  return (
    <div className="space-y-5">
      {senders.length === 0 ? <FirstSender enabled={enabled} /> : null}

      {senders.map((sender) => (
        <SenderCard key={sender.senderId} sender={sender} />
      ))}

      {senders.length > 0 && enabled ? <LinkForm compact /> : null}
    </div>
  )
}

/**
 * ⚠️ THE EMPTY STATE ANSWERS THE QUESTION EVERY NEW USER ACTUALLY HAS, which is
 * not "how do I link an account" but "is this going to log into my LinkedIn".
 * Leaving that unanswered is the moment somebody closes the page — so it is the
 * first sentence, stated plainly, before anything is asked of them.
 */
function FirstSender({ enabled }: { enabled: boolean }) {
  return (
    <section className="clay p-6">
      <h3 className="text-base font-semibold tracking-[-0.02em] text-ink">
        Connect the LinkedIn account you send from
      </h3>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">
        Outlio never signs in to LinkedIn and never asks for your password. It prepares the
        message, tells you when to send it, and records what you did — you perform every
        action in LinkedIn yourself.
      </p>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">
        Linking an account lets Outlio keep one shared daily allowance for it, so two
        campaigns cannot quietly spend the same day twice.
      </p>

      {enabled ? (
        <div className="mt-5">
          <LinkForm />
        </div>
      ) : (
        <p className="mt-5 rounded-[var(--radius-md)] border border-border bg-surface-muted px-3 py-2 text-sm text-muted">
          The LinkedIn channel is not enabled on your plan.
        </p>
      )}
    </section>
  )
}

function LinkForm({ compact = false }: { compact?: boolean }) {
  const [state, action, pending] = useActionState<SenderActionState, FormData>(
    linkSenderAction,
    null,
  )

  return (
    <form action={action} className={compact ? 'clay space-y-3 p-5' : 'space-y-3'}>
      {compact ? (
        <h3 className="text-sm font-semibold tracking-[-0.02em] text-ink">Link another account</h3>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-end">
        <Field
          name="profileUrl"
          label="Your LinkedIn profile URL"
          placeholder="linkedin.com/in/your-name"
          hint="The public profile you send from."
        />
        <Field
          name="displayLabel"
          label="Name it"
          placeholder="Ada — main account"
          hint="Only you and your team see this."
        />
        <button
          type="submit"
          disabled={pending}
          className="product-gradient inline-flex h-9 items-center justify-center rounded-[var(--radius-md)] px-4 text-sm font-semibold text-white transition-[filter,transform] duration-150 ease-out hover:brightness-95 active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? 'Linking…' : 'Link account'}
        </button>
      </div>

      <Result state={state} />
    </form>
  )
}

function Field({
  name,
  label,
  placeholder,
  hint,
}: {
  name: string
  label: string
  placeholder: string
  hint: string
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      <input
        name={name}
        placeholder={placeholder}
        autoComplete="off"
        className="mt-1.5 h-9 w-full rounded-[var(--radius-md)] border border-border bg-panel px-3 text-sm text-ink placeholder:text-muted focus:border-border-strong focus:outline-none"
      />
      <span className="mt-1 block text-[11px] leading-4 text-muted">{hint}</span>
    </label>
  )
}

/** One place that renders an action's outcome, so no form invents its own. */
function Result({ state }: { state: SenderActionState }) {
  if (!state) return null
  return (
    <p
      role={state.ok ? 'status' : 'alert'}
      className={`rounded-[var(--radius-md)] px-3 py-2 text-sm ${
        state.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
      }`}
    >
      {state.ok ? state.message : state.error}
    </p>
  )
}

function SenderCard({ sender }: { sender: SenderView }) {
  const unreviewed = sender.stage === 0
  const halted = sender.status === 'warning' || sender.status === 'restricted'

  return (
    <section className="clay p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold tracking-[-0.02em] text-ink">
            {sender.displayLabel}
          </h3>
          {/*
            ⚠️ A FACT SOMEBODY ASSERTED, NOT A HEALTH VERDICT. §4.10: manual
            mode cannot claim continuous monitoring, so this says who checked
            and when — and says plainly when nobody has.
          */}
          <p className="mt-0.5 text-xs text-muted">
            {sender.lastOwnerReviewAt ? (
              <>
                Checked by its owner <RelativeTime iso={sender.lastOwnerReviewAt} />
              </>
            ) : (
              'Nobody has checked this account yet'
            )}
          </p>
        </div>
        <StatusChip status={sender.status} stage={sender.stage} />
      </div>

      {halted ? (
        <p
          role="alert"
          className="mt-4 rounded-[var(--radius-md)] bg-warning-soft px-3 py-2 text-sm leading-relaxed text-warning"
        >
          No tasks are being released for this account. Read the notice LinkedIn sent you
          before resuming — the cause matters more than the wait.
        </p>
      ) : unreviewed ? (
        /*
          ⚠️ STAGE 0 IS NOT "OUT OF BUDGET" AND MUST NOT READ AS IT. Waiting
          fixes a spent allowance; it never fixes an unreviewed account. So the
          card asks for the one thing that does.
        */
        <ReviewPrompt sender={sender} />
      ) : (
        <BudgetRow budgets={sender.budgets} />
      )}

      {!halted ? (
        <div className="mt-4 border-t border-border pt-3">
          <WarningButton senderId={sender.senderId} />
        </div>
      ) : null}
    </section>
  )
}

function ReviewPrompt({ sender }: { sender: SenderView }) {
  const [state, action, pending] = useActionState<SenderActionState, FormData>(
    recordOwnerReview,
    null,
  )

  return (
    <div className="mt-4 rounded-[var(--radius-md)] border border-border bg-surface-muted p-4">
      <p className="max-w-prose text-sm leading-relaxed text-ink">
        Nothing is released for this account yet. Open LinkedIn, check the account is in
        good standing and that recent activity looks normal, then confirm below.
      </p>
      {sender.isMine ? (
        <form action={action} className="mt-3 space-y-2">
          <input type="hidden" name="senderId" value={sender.senderId} />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-3.5 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-panel/60 disabled:opacity-60"
          >
            {pending ? 'Recording…' : 'I have checked this account'}
          </button>
          <Result state={state} />
        </form>
      ) : (
        /*
          ⚠️ ONLY THE OWNER MAY ATTEST. §4.10 wants the person whose account it
          is to confirm it — a manager clicking on their behalf is exactly the
          attestation the rule exists to prevent. So the button is absent rather
          than present-and-refusing.
        */
        <p className="mt-3 text-sm text-muted">
          Only the person who owns this account can confirm that.
        </p>
      )}
    </div>
  )
}

/**
 * ⚠️ THE NUMBER IS "REMAINING", NOT "USED". A setter planning their morning
 * needs to know how many more they may do; used-of-cap makes them do the
 * subtraction, and they will do it wrong when they are busy.
 */
function BudgetRow({ budgets }: { budgets: SenderView['budgets'] }) {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      {budgets.map((b) => {
        const pct = b.cap === 0 ? 0 : Math.min((b.remaining / b.cap) * 100, 100)
        return (
          <div key={b.label}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                {b.label}
              </span>
              <span className="text-[11px] text-muted">
                {/* Tabular so the three columns' digits line up. */}
                <span className="tabular-nums">{b.cap}</span> a day
              </span>
            </div>
            <p className="mt-1 font-heading text-[22px] font-semibold leading-none tracking-[-0.04em] tabular-nums text-ink">
              {b.remaining}
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-muted">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-150"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] leading-4 text-muted">
              {b.remaining === 0 && b.limitedBy === 'week'
                ? 'None left this week'
                : b.remaining === 0
                  ? 'None left today'
                  : b.limitedBy === 'week'
                    ? 'Limited by this week, not today'
                    : 'left today'}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function WarningButton({ senderId }: { senderId: string }) {
  const [state, action, pending] = useActionState<SenderActionState, FormData>(
    reportSenderWarning,
    null,
  )

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="senderId" value={senderId} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Seen a warning or restriction from LinkedIn on this account?
        </p>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-8 items-center rounded-[var(--radius-md)] border border-border px-3 text-xs font-semibold text-muted transition-colors duration-150 hover:border-danger/40 hover:text-danger disabled:opacity-60"
        >
          {pending ? 'Recording…' : 'Report it and stop sending'}
        </button>
      </div>
      <Result state={state} />
    </form>
  )
}

function StatusChip({ status, stage }: { status: string; stage: number }) {
  const { text, tone } =
    status === 'restricted' || status === 'warning'
      ? { text: 'Stopped', tone: 'bg-danger-soft text-danger' }
      : status === 'paused'
        ? { text: 'Paused', tone: 'bg-surface-muted text-muted' }
        : status === 'disconnected'
          ? { text: 'Disconnected', tone: 'bg-surface-muted text-muted' }
          : stage === 0
            ? { text: 'Needs a check', tone: 'bg-warning-soft text-warning' }
            : // ⚠️ Names the RUNG, not a verdict. "Stage 2 of 3" is a fact about
              // how much Outlio will release; "Healthy" would be a claim about
              // LinkedIn's opinion, which nobody here has.
              { text: `Stage ${stage} of 3`, tone: 'bg-accent-soft text-accent' }

  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}
    >
      {text}
    </span>
  )
}
