import type { IntegrationConnectionStatus } from '@/types/database'
import { ConnectorLogo } from '@/components/integrations/ConnectorLogo'
import { OAuthConnectButton } from '@/components/integrations/OAuthConnectButton'

const feedbackMessages: Record<string, { tone: 'error' | 'success'; message: string }> = {
  connected: { tone: 'success', message: 'Salesforce connected successfully.' },
  disconnected: { tone: 'success', message: 'Salesforce disconnected.' },
  authorization_denied: { tone: 'error', message: 'Salesforce authorization was cancelled.' },
  authorization_blocked: { tone: 'error', message: 'Your Salesforce organization blocked Outlio. Ask a Salesforce administrator to allow or install the app, then try again.' },
  authorization_failed: { tone: 'error', message: 'Salesforce rejected the authorization request. Please try again or ask your Salesforce administrator to allow Outlio.' },
  invalid_state: { tone: 'error', message: 'The Salesforce connection request expired. Please try again.' },
  missing_code: { tone: 'error', message: 'Salesforce did not return an authorization code.' },
  callback_failed: { tone: 'error', message: 'Salesforce could not be connected. Please try again.' },
  configuration_error: { tone: 'error', message: 'Salesforce could not start the connection. The server configuration is being checked.' },
  disconnect_failed: { tone: 'error', message: 'Salesforce could not be revoked. Please try again.' },
  rate_limited: { tone: 'error', message: 'Too many integration requests. Please wait and try again.' },
}

function statusLabel(status: IntegrationConnectionStatus | null) {
  if (status === 'connected') return '● Connected'
  if (status === 'reconnect_required') return '⚠ Reconnect required'
  if (status === 'error') return '✕ Connection error'
  return '○ Not connected'
}

export function SalesforceSettings({
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
          <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-panel"><ConnectorLogo name="salesforce" className="h-6 w-8" /></span>
          <div>
            <h3 className="text-sm font-semibold text-ink">Salesforce</h3>
            <p className="text-sm text-muted">Export selected leads to your Salesforce organization.</p>
          </div>
        </div>
        <span className={connected ? 'rounded-full border border-success/25 bg-success-soft px-2.5 py-1 text-xs font-semibold text-success' : status === 'error' || status === 'reconnect_required' ? 'rounded-full border border-warning/25 bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning' : 'rounded-full border border-border bg-panel px-2.5 py-1 text-xs font-semibold text-muted'}>
          {statusLabel(status)}
        </span>
      </div>

      <div className="mt-5 space-y-4">
        {connected ? (
          <div className="rounded-lg border border-border bg-panel px-3 py-2.5">
            <p className="text-xs font-medium text-muted">Connected organization</p>
            <p className="mt-1 text-sm font-semibold text-ink">{accountLabel ?? 'Salesforce organization'}</p>
            <p className="mt-1 text-xs text-muted">OAuth tokens and the organization instance URL are encrypted server-side.</p>
          </div>
        ) : (
          <p className="text-xs leading-5 text-muted">You will sign in to and authorize your own Salesforce organization. Outlio requests API access and offline refresh access.</p>
        )}

        <div className="flex flex-wrap gap-2">
          {!connected ? (
            <OAuthConnectButton href="/api/integrations/salesforce/connect" logo="salesforce" label={status === 'reconnect_required' ? 'Reconnect Salesforce' : 'Connect Salesforce'} />
          ) : null}
          {status && status !== 'not_connected' ? (
            <form action="/api/integrations/salesforce/disconnect" method="post">
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
