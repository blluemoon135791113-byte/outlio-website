'use client'

import { useActionState, useState } from 'react'

import {
  SendingSettings,
  type AccountSchedule,
} from '@/components/email/SendingSettings'

import {
  disconnectAccount,
  recheckAccount,
  testMailboxConnection,
  type ActionState,
} from '@/app/(product)/email/actions'

type Check = { id: string; label: string; status: string; detail: string }

type Account = {
  id: string
  displayName: string
  fromEmail: string
  fromDomain: string
  status: string
  healthScore: number | null
  provider: string
  repliesSupported: boolean
  repliesReason: string | null
  lastSendAt: string | null
}

/**
 * One mailbox, with its checks explained.
 *
 * ⚠️ THE SCORE NEVER APPEARS WITHOUT ITS CHECKS. "Your score is 62" is a
 * support ticket, not an answer — the whole point of the readiness model is
 * that every point lost has a named cause the customer can act on.
 */
export function MailboxCard({
  account,
  checks,
  canManage,
  schedule,
}: {
  account: Account
  checks: Check[]
  canManage: boolean
  /** Null for anyone who may not change it — see R13. */
  schedule: AccountSchedule | null
}) {
  const [expanded, setExpanded] = useState(false)
  const [recheckState, recheck, rechecking] = useActionState<ActionState, FormData>(
    recheckAccount,
    null,
  )
  const [testState, runTest, testing] = useActionState<ActionState, FormData>(
    testMailboxConnection,
    null,
  )
  const [disconnectState, disconnect, disconnecting] = useActionState<ActionState, FormData>(
    disconnectAccount,
    null,
  )

  const problems = checks.filter((c) => c.status === 'fail' || c.status === 'warn')

  return (
    <div className="clay space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">{account.displayName}</h3>
            <StatusPill status={account.status} />
            {!account.repliesSupported ? (
              <span
                className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning"
                title={account.repliesReason ?? undefined}
              >
                send only
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">
            {account.fromEmail} · {account.provider.toUpperCase()}
          </p>
        </div>

        <div className="text-right">
          {account.healthScore === null ? (
            <p className="text-xs text-muted">Not checked yet</p>
          ) : (
            <>
              <p className="text-xl font-semibold tracking-[-0.02em] text-ink">
                {account.healthScore}
                <span className="text-sm font-normal text-muted">/100</span>
              </p>
              <p className="text-[10px] uppercase tracking-[0.08em] text-muted">setup &amp; health</p>
            </>
          )}
        </div>
      </div>

      {/*
        ⚠️ PROBLEMS ARE SHOWN WITHOUT EXPANDING. A customer whose SPF is broken
        should not have to go looking for that; hiding it behind a disclosure is
        how a mailbox quietly stays misconfigured for weeks.
      */}
      {problems.length > 0 ? (
        <ul className="space-y-1.5">
          {problems.map((check) => (
            <li key={check.id} className="flex gap-2 text-xs leading-relaxed">
              <span
                className={
                  check.status === 'fail'
                    ? 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-danger'
                    : 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning'
                }
              />
              <span className="text-muted">
                <span className="font-semibold text-ink">{check.label}:</span> {check.detail}
              </span>
            </li>
          ))}
        </ul>
      ) : checks.length > 0 ? (
        <p className="text-xs text-success">Everything checked out.</p>
      ) : null}

      {expanded && checks.length > 0 ? (
        <ul className="space-y-1.5 border-t border-border pt-3">
          {checks
            .filter((c) => c.status === 'pass' || c.status === 'unknown')
            .map((check) => (
              <li key={check.id} className="flex gap-2 text-xs leading-relaxed">
                <span
                  className={
                    check.status === 'pass'
                      ? 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-success'
                      : 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted'
                  }
                />
                <span className="text-muted">
                  <span className="font-semibold text-ink">{check.label}:</span> {check.detail}
                </span>
              </li>
            ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {checks.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
          >
            {expanded ? 'Hide passing checks' : 'Show all checks'}
          </button>
        ) : null}

        {canManage && schedule ? <SendingSettings account={schedule} /> : null}

        {canManage ? (
          <>
            <form action={recheck}>
              <input type="hidden" name="accountId" value={account.id} />
              <button
                type="submit"
                disabled={rechecking}
                className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-semibold text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink disabled:opacity-60"
              >
                {rechecking ? 'Checking…' : 'Re-check'}
              </button>
            </form>

            {/*
              ⚠️ SEPARATE FROM "Re-check", WHICH ONLY RE-READS DNS. This one
              decrypts the stored credential and actually talks to the mail
              server, so it is the only control that can prove SMTP and IMAP
              authentication. It sends nothing unless a recipient is given, and
              the action refuses any address outside this workspace.
            */}
            <form action={runTest} className="flex items-center gap-1.5">
              <input type="hidden" name="accountId" value={account.id} />
              <input
                type="email"
                name="sendTestTo"
                placeholder="optional: send a test to…"
                className="w-52 rounded-[var(--radius-md)] border border-border bg-surface px-2 py-1.5 text-xs text-ink placeholder:text-muted"
              />
              <button
                type="submit"
                disabled={testing}
                className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-semibold text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink disabled:opacity-60"
              >
                {testing ? 'Testing…' : 'Test connection'}
              </button>
            </form>

            <form action={disconnect}>
              <input type="hidden" name="accountId" value={account.id} />
              <button
                type="submit"
                disabled={disconnecting}
                className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-semibold text-danger transition-colors duration-150 hover:bg-danger-soft disabled:opacity-60"
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </form>
          </>
        ) : null}

        {account.lastSendAt ? (
          <span className="ml-auto text-xs text-muted">
            Last send {new Date(account.lastSendAt).toLocaleDateString()}
          </span>
        ) : (
          <span className="ml-auto text-xs text-muted">Nothing sent yet</span>
        )}
      </div>

      {recheckState ? (
        <p className={recheckState.ok ? 'text-xs text-success' : 'text-xs text-danger'}>
          {recheckState.ok ? recheckState.message : recheckState.error}
        </p>
      ) : null}
      {testState ? (
        testState.ok ? (
          /*
            A report, not a sentence — `formatDiagnostics` returns aligned
            lines and collapsing them into a paragraph loses the columns that
            make SMTP and IMAP comparable at a glance.
          */
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-[var(--radius-md)] border border-border bg-surface-muted p-3 text-xs leading-relaxed text-ink">
            {testState.message}
          </pre>
        ) : (
          <p className="text-xs text-danger">{testState.error}</p>
        )
      ) : null}
      {disconnectState && !disconnectState.ok ? (
        <p className="text-xs text-danger">{disconnectState.error}</p>
      ) : null}
    </div>
  )
}

/**
 * ⚠️ THE LABELS SAY WHAT THE STATE MEANS, not what the enum is called.
 * "Ramping" means nothing to a customer; "building up volume" does.
 */
function StatusPill({ status }: { status: string }) {
  const display: Record<string, { label: string; tone: string }> = {
    ready: { label: 'Ready', tone: 'bg-success-soft text-success' },
    ramping: { label: 'Building up volume', tone: 'bg-accent-soft text-accent' },
    warning: { label: 'Needs attention', tone: 'bg-warning-soft text-warning' },
    throttled: { label: 'Rate-limited', tone: 'bg-warning-soft text-warning' },
    paused: { label: 'Paused', tone: 'bg-surface-muted text-muted' },
    disconnected: { label: 'Disconnected', tone: 'bg-danger-soft text-danger' },
    authentication_required: { label: 'Sign in again', tone: 'bg-danger-soft text-danger' },
    error: { label: 'Unreachable', tone: 'bg-danger-soft text-danger' },
    not_configured: { label: 'Not set up', tone: 'bg-surface-muted text-muted' },
  }

  const { label, tone } = display[status] ?? { label: status, tone: 'bg-surface-muted text-muted' }

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>
      {label}
    </span>
  )
}
