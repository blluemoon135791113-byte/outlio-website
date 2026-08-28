'use client'

import { useActionState } from 'react'

import {
  connectClayAction,
  disconnectClayAction,
  testClayConnectionAction,
  type ClayActionState,
} from '@/lib/integrations/clay-actions'
import type { IntegrationConnectionStatus } from '@/types/database'
import { ConnectorLogo } from '@/components/integrations/ConnectorLogo'

const INITIAL: ClayActionState = { status: 'idle' }
const inputClass = 'w-full field px-3 py-2.5 text-base text-ink placeholder:text-muted focus:outline-none'

function Feedback({ state }: { state: ClayActionState }) {
  if (state.status === 'idle') return null
  return (
    <p
      role={state.status === 'error' ? 'alert' : 'status'}
      className={state.status === 'error' ? 'text-sm text-danger' : 'text-sm text-success'}
    >
      {state.message}
    </p>
  )
}

function Submit({ children }: { children: React.ReactNode }) {
  return (
    <button type="submit" className="inline-flex h-10 items-center rounded-[var(--radius-md)] bg-accent px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.97] disabled:opacity-60">
      {children}
    </button>
  )
}

function statusLabel(status: IntegrationConnectionStatus | null) {
  if (status === 'connected') return '● Connected'
  if (status === 'reconnect_required') return '⚠ Reconnect required'
  if (status === 'error') return '✕ Connection error'
  return '○ Not connected'
}

export function ClaySettings({
  status,
  accountLabel,
}: {
  status: IntegrationConnectionStatus | null
  accountLabel: string | null
}) {
  const [connectState, connectAction] = useActionState(connectClayAction, INITIAL)
  const [testState, testAction] = useActionState(testClayConnectionAction, INITIAL)
  const [disconnectState, disconnectAction] = useActionState(disconnectClayAction, INITIAL)
  const connected = status === 'connected'

  return (
    <div className="rounded-xl border border-border bg-app/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-panel"><ConnectorLogo name="clay" className="size-6" /></span>
            <div>
              <h3 className="text-sm font-semibold text-ink">Clay</h3>
              <p className="text-sm text-muted">Send selected leads to a Clay table webhook.</p>
            </div>
          </div>
        </div>
        <span className={connected ? 'rounded-full border border-success/25 bg-success-soft px-2.5 py-1 text-xs font-semibold text-success' : status === 'error' || status === 'reconnect_required' ? 'rounded-full border border-warning/25 bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning' : 'rounded-full border border-border bg-panel px-2.5 py-1 text-xs font-semibold text-muted'}>
          {statusLabel(status)}
        </span>
      </div>

      {connected ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg border border-border bg-panel px-3 py-2.5">
            <p className="text-xs font-medium text-muted">Connected webhook</p>
            <p className="mt-1 text-sm font-semibold text-ink">{accountLabel ?? 'Clay webhook'}</p>
            <p className="mt-1 text-xs text-muted">The webhook URL and token are encrypted and never displayed again.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={testAction}><Submit>Test connection</Submit></form>
            <form action={disconnectAction}>
              <button type="submit" className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-4 text-sm font-semibold text-ink hover:border-danger/35 hover:text-danger">Disconnect</button>
            </form>
          </div>
          <Feedback state={testState} />
          <Feedback state={disconnectState} />
        </div>
      ) : (
        <form action={connectAction} className="mt-5 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">Clay Webhook URL</span>
            <input className={inputClass} name="webhook_url" type="url" required maxLength={2048} autoComplete="off" placeholder="https://api.clay.com/v3/sources/webhook/…" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">Authentication Token <span className="font-normal text-muted">Optional</span></span>
            <input className={inputClass} name="authentication_token" type="password" maxLength={1024} autoComplete="new-password" />
          </label>
          <p className="text-xs leading-5 text-muted">Connect tests the webhook first. If Clay accepts it, Outlio encrypts and saves the URL and optional token server-side.</p>
          <Submit>{status === 'reconnect_required' ? 'Reconnect Clay' : 'Connect Clay'}</Submit>
          <Feedback state={connectState} />
        </form>
      )}
    </div>
  )
}
