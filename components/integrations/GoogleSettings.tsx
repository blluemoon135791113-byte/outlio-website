import { ConnectorLogo } from '@/components/integrations/ConnectorLogo'
import type { IntegrationConnectionStatus } from '@/types/database'

const feedbackMessages: Record<string, { tone: 'error' | 'success'; message: string }> = {
  connected: { tone: 'success', message: 'Google Sheets and Drive connected successfully.' },
  disconnected: { tone: 'success', message: 'Google disconnected.' },
  authorization_denied: { tone: 'error', message: 'Google authorization was cancelled.' },
  invalid_state: { tone: 'error', message: 'The Google connection request expired. Please try again.' },
  missing_code: { tone: 'error', message: 'Google did not return an authorization code.' },
  callback_failed: { tone: 'error', message: 'Google could not be connected. Please try again.' },
  configuration_error: { tone: 'error', message: 'Google is not configured correctly on this server.' },
  disconnect_failed: { tone: 'error', message: 'Google could not be disconnected. Please try again.' },
  rate_limited: { tone: 'error', message: 'Too many integration requests. Please wait and try again.' },
}

function statusLabel(status: IntegrationConnectionStatus | null) {
  if (status === 'connected') return '● Connected'
  if (status === 'reconnect_required') return '⚠ Reconnect required'
  if (status === 'error') return '✕ Connection error'
  return '○ Not connected'
}

export function GoogleSettings({
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
          <span aria-hidden className="relative flex h-10 w-14 items-center justify-center rounded-xl border border-border bg-panel">
            <ConnectorLogo name="google_sheets" className="size-5 -translate-x-1" />
            <ConnectorLogo name="google_drive" className="absolute right-2 size-5" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-ink">Google Sheets &amp; Drive</h3>
            <p className="text-sm text-muted">Create spreadsheets or save CSV files in your Google Drive.</p>
          </div>
        </div>
        <span className={connected ? 'rounded-full border border-success/25 bg-success-soft px-2.5 py-1 text-xs font-semibold text-success' : status === 'error' || status === 'reconnect_required' ? 'rounded-full border border-warning/25 bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning' : 'rounded-full border border-border bg-panel px-2.5 py-1 text-xs font-semibold text-muted'}>
          {statusLabel(status)}
        </span>
      </div>

      <div className="mt-5 space-y-4">
        {connected ? (
          <div className="rounded-lg border border-border bg-panel px-3 py-2.5">
            <p className="text-xs font-medium text-muted">Connected Google account</p>
            <p className="mt-1 text-sm font-semibold text-ink">{accountLabel ?? 'Google account'}</p>
            <p className="mt-1 text-xs text-muted">Outlio can create only the Sheets and Drive files it exports for you.</p>
          </div>
        ) : (
          <p className="text-xs leading-5 text-muted">Connect your own Google account. Outlio requests permission to create spreadsheets and Drive files for your exports.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {!connected ? (
            <a href="/api/integrations/google/connect" className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-md)] bg-accent px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.97]">
                <ConnectorLogo name="google_drive" className="size-4" />
                {status === 'reconnect_required' ? 'Reconnect Google' : 'Connect Google'}
            </a>
          ) : null}
          {status && status !== 'not_connected' ? (
            <form action="/api/integrations/google/disconnect" method="post">
              <button type="submit" className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-4 text-sm font-semibold text-ink transition-[border-color,color,transform] duration-150 hover:border-danger/35 hover:text-danger active:scale-[0.97]">Disconnect</button>
            </form>
          ) : null}
        </div>
        {feedbackMessage ? (
          <p role={feedbackMessage.tone === 'error' ? 'alert' : 'status'} className={feedbackMessage.tone === 'error' ? 'text-sm text-danger' : 'text-sm text-success'}>{feedbackMessage.message}</p>
        ) : null}
      </div>
    </div>
  )
}
