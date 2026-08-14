import type { IntegrationConnectionStatus } from '@/types/database'
import { ConnectorLogo } from '@/components/integrations/ConnectorLogo'
import { OAuthConnectButton } from '@/components/integrations/OAuthConnectButton'

const feedbackMessages: Record<string, { tone: 'error' | 'success'; message: string }> = {
  connected: { tone: 'success', message: 'HubSpot connected successfully.' },
  disconnected: { tone: 'success', message: 'HubSpot disconnected.' },
  authorization_denied: { tone: 'error', message: 'HubSpot authorization was cancelled.' },
  invalid_state: { tone: 'error', message: 'The HubSpot connection request expired. Please try again.' },
  missing_code: { tone: 'error', message: 'HubSpot did not return an authorization code.' },
  callback_failed: { tone: 'error', message: 'HubSpot could not be connected. Please try again.' },
  configuration_error: { tone: 'error', message: 'HubSpot is not configured on this server.' },
  disconnect_failed: { tone: 'error', message: 'HubSpot could not be revoked. Please try again.' },
  rate_limited: { tone: 'error', message: 'Too many integration requests. Please wait and try again.' },
}

function statusLabel(status: IntegrationConnectionStatus | null) {
  if (status === 'connected') return '● Connected'
  if (status === 'reconnect_required') return '⚠ Reconnect required'
  if (status === 'error') return '✕ Connection error'
  return '○ Not connected'
}

export function HubSpotSettings({
  status,
  accountLabel,
  feedback,
}: {
  status: IntegrationConnectionStatus | null
  accountLabel: string | null
  feedback: string | null
}) {
  const connected = status === 'connected'
  const feedbackMessage = feedback ? feedbackMessages[feedback] : null

  return (
    <div className="rounded-xl border border-border bg-app/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-panel"><ConnectorLogo name="hubspot" className="size-5" /></span>
          <div>
            <h3 className="text-sm font-semibold text-ink">HubSpot</h3>
            <p className="text-sm text-muted">Export selected leads to your HubSpot contacts.</p>
          </div>
        </div>
        <span className={connected ? 'rounded-full border border-success/25 bg-success-soft px-2.5 py-1 text-xs font-semibold text-success' : status === 'error' || status === 'reconnect_required' ? 'rounded-full border border-warning/25 bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning' : 'rounded-full border border-border bg-panel px-2.5 py-1 text-xs font-semibold text-muted'}>
          {statusLabel(status)}
        </span>
      </div>

      <div className="mt-5 space-y-4">
        {connected ? (
          <div className="rounded-lg border border-border bg-panel px-3 py-2.5">
            <p className="text-xs font-medium text-muted">Connected account</p>
            <p className="mt-1 text-sm font-semibold text-ink">{accountLabel ?? 'HubSpot account'}</p>
            <p className="mt-1 text-xs text-muted">OAuth tokens are encrypted server-side and are never sent to your browser.</p>
          </div>
        ) : (
          <p className="text-xs leading-5 text-muted">You will choose which HubSpot account to authorize. Outlio requests contact write access and optional contact read access for duplicate detection.</p>
        )}

        <div className="flex flex-wrap gap-2">
          {!connected ? (
            <OAuthConnectButton href="/api/integrations/hubspot/connect" logo="hubspot" label={status === 'reconnect_required' ? 'Reconnect HubSpot' : 'Connect HubSpot'} />
          ) : null}
          {status && status !== 'not_connected' ? (
            <form action="/api/integrations/hubspot/disconnect" method="post">
              <button type="submit" className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-4 text-sm font-semibold text-ink hover:border-danger/35 hover:text-danger">Disconnect</button>
            </form>
          ) : null}
        </div>

        {feedbackMessage ? (
          <p role={feedbackMessage.tone === 'error' ? 'alert' : 'status'} className={feedbackMessage.tone === 'error' ? 'text-sm text-danger' : 'text-sm text-success'}>
            {feedbackMessage.message}
          </p>
        ) : null}
      </div>
    </div>
  )
}
