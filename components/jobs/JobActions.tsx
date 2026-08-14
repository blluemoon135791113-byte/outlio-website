'use client'

import Link from 'next/link'
import { useActionState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'

import {
  getDownloadUrlAction,
  purgeJobAction,
  type JobActionState,
} from '@/lib/jobs/actions'
import { ConnectorLogo, type ConnectorLogoName } from '@/components/integrations/ConnectorLogo'
import {
  exportSelectedLeadsToClayAction,
  exportSelectedLeadsToGoogleAction,
  exportSelectedLeadsToGhlAction,
  exportSelectedLeadsToHubSpotAction,
  exportSelectedLeadsToSalesforceAction,
  type LeadExportActionState,
} from '@/lib/export/actions'

const INITIAL: JobActionState = { status: 'idle' }
const EXPORT_INITIAL: LeadExportActionState = { status: 'idle' }

function MenuSubmit({ logo, label }: { logo: ConnectorLogoName; label: string }) {
  const { pending } = useFormStatus()
  return <button type="submit" disabled={pending} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-ink transition-[background-color,transform] duration-150 hover:bg-accent-soft/70 active:scale-[0.98] disabled:opacity-50"><ConnectorLogo name={logo} className="size-5" /><span>{pending ? `Exporting to ${label}…` : label}</span></button>
}

function ConnectRow({ logo, label }: { logo: ConnectorLogoName; label: string }) {
  return <Link href="/dashboard/settings#integrations" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors duration-150 hover:bg-accent-soft/70 hover:text-accent"><ConnectorLogo name={logo} className="size-5 opacity-60" /><span>Connect {label}</span></Link>
}

function Pending({ label, busyLabel, primary }: { label: string; busyLabel: string; primary?: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={
        primary
          ? 'rounded-[var(--radius-md)] bg-accent px-3.5 py-2 text-sm font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60'
          : 'rounded-[var(--radius-md)] border border-border px-3.5 py-2 text-sm font-medium text-muted transition-colors duration-150 hover:border-border-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-60'
      }
    >
      {pending ? busyLabel : label}
    </button>
  )
}

export function JobActions({
  jobId,
  hasExport,
  leadsRemaining,
  clayConnected,
  googleConnected,
  ghlConnected,
  hubSpotConnected,
  salesforceConnected,
}: {
  jobId: string
  hasExport: boolean
  leadsRemaining: number
  clayConnected: boolean
  googleConnected: boolean
  ghlConnected: boolean
  hubSpotConnected: boolean
  salesforceConnected: boolean
}) {
  const [download, downloadAction] = useActionState(getDownloadUrlAction, INITIAL)
  const [purge, purgeAction] = useActionState(purgeJobAction, INITIAL)
  const [clay, clayAction] = useActionState(exportSelectedLeadsToClayAction, EXPORT_INITIAL)
  const [google, googleAction] = useActionState(exportSelectedLeadsToGoogleAction, EXPORT_INITIAL)
  const [ghl, ghlAction] = useActionState(exportSelectedLeadsToGhlAction, EXPORT_INITIAL)
  const [hubspot, hubspotAction] = useActionState(exportSelectedLeadsToHubSpotAction, EXPORT_INITIAL)
  const [salesforce, salesforceAction] = useActionState(exportSelectedLeadsToSalesforceAction, EXPORT_INITIAL)
  const exportFeedback = [clay, google, ghl, hubspot, salesforce].find((state) => state.status !== 'idle')

  /**
   * Signed URLs expire in ~60s, so we trigger the download immediately rather
   * than rendering a link the user might click minutes later.
   */
  useEffect(() => {
    if (download.status === 'ready') {
      window.location.href = download.url
    }
  }, [download])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {hasExport ? (
          <details className="group relative">
            <summary className="inline-flex h-10 cursor-pointer list-none items-center gap-2 rounded-[var(--radius-md)] bg-accent px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.97] marker:content-none">Export leads<svg aria-hidden viewBox="0 0 20 20" className="size-4 transition-transform duration-150 group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 7 5 5 5-5" /></svg></summary>
            <div className="absolute right-0 z-30 mt-2 w-64 origin-top-right rounded-xl border border-border bg-panel p-1.5 shadow-[var(--shadow-lg)]">
              <p className="px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Export destination</p>
              <form action={downloadAction}><input type="hidden" name="job_id" value={jobId} /><MenuSubmit logo="csv" label="Download CSV" /></form>
              {leadsRemaining > 0 ? <>
                <div className="my-1 border-t border-border" />
                {googleConnected ? <><form action={googleAction}><input type="hidden" name="job_id" value={jobId} /><input type="hidden" name="destination" value="google_sheets" /><MenuSubmit logo="google_sheets" label="Google Sheets" /></form><form action={googleAction}><input type="hidden" name="job_id" value={jobId} /><input type="hidden" name="destination" value="google_drive" /><MenuSubmit logo="google_drive" label="Google Drive" /></form></> : <ConnectRow logo="google_sheets" label="Google" />}
                {hubSpotConnected ? <form action={hubspotAction}><input type="hidden" name="job_id" value={jobId} /><MenuSubmit logo="hubspot" label="HubSpot" /></form> : <ConnectRow logo="hubspot" label="HubSpot" />}
                {salesforceConnected ? <form action={salesforceAction}><input type="hidden" name="job_id" value={jobId} /><MenuSubmit logo="salesforce" label="Salesforce" /></form> : <ConnectRow logo="salesforce" label="Salesforce" />}
                {ghlConnected ? <form action={ghlAction}><input type="hidden" name="job_id" value={jobId} /><MenuSubmit logo="ghl" label="GoHighLevel" /></form> : <ConnectRow logo="ghl" label="GoHighLevel" />}
                {clayConnected ? <form action={clayAction}><input type="hidden" name="job_id" value={jobId} /><MenuSubmit logo="clay" label="Clay" /></form> : <ConnectRow logo="clay" label="Clay" />}
              </> : null}
            </div>
          </details>
        ) : null}

        {leadsRemaining > 0 ? (
          <form action={purgeAction}>
            <input type="hidden" name="job_id" value={jobId} />
            <Pending label="Clear data" busyLabel="Clearing…" />
          </form>
        ) : null}
      </div>

      {download.status === 'error' ? (
        <p role="alert" className="text-sm text-danger">
          {download.message}
        </p>
      ) : null}

      {exportFeedback?.status === 'error' ? <p role="alert" className="max-w-sm text-sm text-danger">{exportFeedback.message}</p> : null}
      {exportFeedback?.status === 'success' ? <p role="status" className="max-w-sm text-sm text-success">{exportFeedback.message}{'destinationUrl' in exportFeedback && typeof exportFeedback.destinationUrl === 'string' ? <> <a href={exportFeedback.destinationUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Open file</a></> : null}</p> : null}

      {purge.status === 'error' ? (
        <p role="alert" className="text-sm text-danger">
          {purge.message}
        </p>
      ) : null}

      {purge.status === 'purged' ? (
        <p role="status" className="text-sm text-success">
          Cleared {purge.deleted.toLocaleString()} lead
          {purge.deleted === 1 ? '' : 's'} from the database. Your CSV is unaffected.
        </p>
      ) : null}

      {leadsRemaining === 0 && hasExport ? (
        <p className="text-sm text-muted">
          Lead data cleared — the CSV remains downloadable.
        </p>
      ) : null}
    </div>
  )
}
