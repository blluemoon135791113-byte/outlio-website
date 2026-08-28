'use client'

/**
 * Per-run actions on an Extraction history strip: the export destinations and
 * the permanent delete. (Soft-delete — move to trash — lives beside them.)
 */

import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { ConnectorLogo, type ConnectorLogoName } from '@/components/integrations/ConnectorLogo'
import {
  deleteJobAction,
  getDownloadUrlAction,
  type JobActionState,
} from '@/lib/jobs/actions'
import {
  exportSelectedLeadsToClayAction,
  exportSelectedLeadsToGoogleAction,
  exportSelectedLeadsToGhlAction,
  type LeadExportActionState,
} from '@/lib/export/actions'

const INITIAL: JobActionState = { status: 'idle' }
const EXPORT_INITIAL: LeadExportActionState = { status: 'idle' }

function MenuSubmit({ logo, label }: { logo: ConnectorLogoName; label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-ink transition-[background-color,transform] duration-150 hover:bg-accent-soft/70 active:scale-[0.98] disabled:opacity-50"
    >
      <ConnectorLogo name={logo} className="size-5" />
      <span>{pending ? `Exporting to ${label}…` : label}</span>
    </button>
  )
}

function ConnectRow({ logo, label }: { logo: ConnectorLogoName; label: string }) {
  return (
    <Link
      href="/dashboard/settings/integrations"
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors duration-150 hover:bg-accent-soft/70 hover:text-accent"
    >
      <ConnectorLogo name={logo} className="size-5 opacity-60" />
      <span>Connect {label}</span>
    </Link>
  )
}

export function RowExportMenu({
  jobId,
  hasExport,
  leadsRemaining,
  clayConnected,
  googleConnected,
  ghlConnected,
}: {
  jobId: string
  hasExport: boolean
  leadsRemaining: number
  clayConnected: boolean
  googleConnected: boolean
  ghlConnected: boolean
}) {
  const [download, downloadAction] = useActionState(getDownloadUrlAction, INITIAL)
  const [clay, clayAction] = useActionState(exportSelectedLeadsToClayAction, EXPORT_INITIAL)
  const [google, googleAction] = useActionState(exportSelectedLeadsToGoogleAction, EXPORT_INITIAL)
  const [ghl, ghlAction] = useActionState(exportSelectedLeadsToGhlAction, EXPORT_INITIAL)
  const exportFeedback = [clay, google, ghl].find((state) => state.status !== 'idle')

  // Signed URLs expire in ~60s: download immediately rather than rendering a
  // link the user might click minutes later.
  useEffect(() => {
    if (download.status === 'ready') window.location.href = download.url
  }, [download])

  if (!hasExport && leadsRemaining === 0) return null

  return (
    <div className="space-y-1">
      {hasExport ? (
        <details className="group relative">
          <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-[var(--radius-md)] bg-accent px-3.5 text-[13px] font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.97] marker:content-none">
            Export
            <svg aria-hidden viewBox="0 0 20 20" className="size-3.5 transition-transform duration-150 group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 7 5 5 5-5" /></svg>
          </summary>
          <div className="absolute right-0 z-30 mt-2 w-60 origin-top-right rounded-xl border border-border bg-panel p-1.5 shadow-[var(--shadow-lg)]">
            <p className="px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Export destination</p>
            <form action={downloadAction}>
              <input type="hidden" name="job_id" value={jobId} />
              <MenuSubmit logo="csv" label="Download CSV" />
            </form>
            {leadsRemaining > 0 ? (
              <>
                <div className="my-1 border-t border-border" />
                {googleConnected ? (
                  <>
                    <form action={googleAction}><input type="hidden" name="job_id" value={jobId} /><input type="hidden" name="destination" value="google_sheets" /><MenuSubmit logo="google_sheets" label="Google Sheets" /></form>
                    <form action={googleAction}><input type="hidden" name="job_id" value={jobId} /><input type="hidden" name="destination" value="google_drive" /><MenuSubmit logo="google_drive" label="Google Drive" /></form>
                  </>
                ) : (
                  <ConnectRow logo="google_sheets" label="Google" />
                )}
                {ghlConnected ? (
                  <form action={ghlAction}><input type="hidden" name="job_id" value={jobId} /><MenuSubmit logo="ghl" label="GoHighLevel" /></form>
                ) : (
                  <ConnectRow logo="ghl" label="GoHighLevel" />
                )}
                {clayConnected ? (
                  <form action={clayAction}><input type="hidden" name="job_id" value={jobId} /><MenuSubmit logo="clay" label="Clay" /></form>
                ) : (
                  <ConnectRow logo="clay" label="Clay" />
                )}
              </>
            ) : null}
          </div>
        </details>
      ) : null}

      {download.status === 'error' ? <p role="alert" className="text-xs text-danger">{download.message}</p> : null}
      {exportFeedback?.status === 'error' ? <p role="alert" className="max-w-xs text-xs text-danger">{exportFeedback.message}</p> : null}
      {exportFeedback?.status === 'success' ? (
        <p role="status" className="max-w-xs text-xs text-success">
          {exportFeedback.message}
          {'destinationUrl' in exportFeedback && typeof exportFeedback.destinationUrl === 'string' ? (
            <> <a href={exportFeedback.destinationUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Open file</a></>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

/**
 * PERMANENT delete: erases the run, its lead data, its stored files and its
 * CSV. Distinct from the trash icon (soft, restorable) — this one is final,
 * so it confirms with explicit wording.
 */
export function DeleteRunButton({
  jobId,
  onDeleted,
}: {
  jobId: string
  onDeleted: () => void
}) {
  const [deleted, deleteAction] = useActionState(deleteJobAction, INITIAL)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (deleted.status === 'purged') onDeleted()
  }, [deleted, onDeleted])

  if (deleted.status === 'purged') return null

  return confirming ? (
    /*
     * ⚠️ NO VISIBLE PROMPT — the two buttons ARE the question. "Erase" beside
     * "Keep" reads as a confirmation without a line of copy repeating it.
     * `aria-label` therefore carries the whole meaning for a screen reader and
     * must not be dropped as decoration.
     */
    <div className="flex items-center gap-1.5" role="group" aria-label="Confirm permanent deletion">
      <form action={deleteAction}>
        <input type="hidden" name="job_id" value={jobId} />
        <button
          type="submit"
          className="rounded-[var(--radius-md)] bg-danger/10 px-2 py-1 text-[11px] font-semibold text-danger transition-colors duration-150 hover:bg-danger/20"
        >
          {deleted.status === 'idle' ? 'Erase' : 'Erasing…'}
        </button>
      </form>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-[var(--radius-md)] border border-border px-2 py-1 text-[11px] text-muted transition-colors duration-150 hover:text-ink"
      >
        Keep
      </button>
    </div>
  ) : (
    <button
      type="button"
      aria-label="Permanently delete this extraction"
      title="Delete permanently (erases lead data, files and CSV)"
      onClick={() => setConfirming(true)}
      className="inline-flex size-9 items-center justify-center rounded-[var(--radius-md)] border border-border text-muted transition-colors duration-150 hover:border-danger/40 hover:text-danger active:scale-[0.97]"
    >
      <svg aria-hidden viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="m5 5 10 10M15 5 5 15" />
      </svg>
    </button>
  )
}
