'use client'

import Link from 'next/link'
import { useActionState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'

import { ConnectorLogo, type ConnectorLogoName } from '@/components/integrations/ConnectorLogo'
import type { DashboardLead } from '@/lib/jobs/dashboard-types'
import {
  exportSelectedLeadsToClayAction,
  exportSelectedLeadsToGoogleAction,
  exportSelectedLeadsToGhlAction,
  type LeadExportActionState,
} from '@/lib/export/actions'

const INITIAL: LeadExportActionState = { status: 'idle' }

function MenuSubmit({ logo, label, disabled = false }: { logo: ConnectorLogoName; label: string; disabled?: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending || disabled} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-ink transition-[background-color,transform] duration-150 hover:bg-accent-soft/70 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45">
      <ConnectorLogo name={logo} className="size-5 shrink-0" />
      <span className="flex-1">{pending ? `Exporting to ${label}…` : label}</span>
    </button>
  )
}

function ConnectRow({ logo, label }: { logo: ConnectorLogoName; label: string }) {
  return (
    <Link href="/dashboard/settings#integrations" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors duration-150 hover:bg-accent-soft/70 hover:text-accent">
      <ConnectorLogo name={logo} className="size-5 shrink-0 opacity-60" />
      <span className="flex-1">Connect {label}</span>
    </Link>
  )
}

function csvCell(value: string | null): string {
  const text = value ?? ''
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function downloadSelectedCsv(leads: readonly DashboardLead[]) {
  const rows = [
    ['Name', 'LinkedIn Profile', 'Job Title', 'Company', 'Company LinkedIn URL', 'Company Website URL', 'Location', 'Sales Navigator URL'],
    ...leads.map((lead) => [lead.full_name, lead.linkedin_url, lead.job_title, lead.company_name, lead.company_url, lead.company_website_url, lead.location, lead.sales_navigator_url]),
  ]
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `outlio-selected-leads-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function LeadExportMenu({
  selectedLeads,
  clayConnected,
  googleConnected,
  ghlConnected,
  onSuccess,
}: {
  selectedLeads: readonly DashboardLead[]
  clayConnected: boolean
  googleConnected: boolean
  ghlConnected: boolean
  onSuccess: () => void
}) {
  const [clay, clayAction] = useActionState(exportSelectedLeadsToClayAction, INITIAL)
  const [google, googleAction] = useActionState(exportSelectedLeadsToGoogleAction, INITIAL)
  const [ghl, ghlAction] = useActionState(exportSelectedLeadsToGhlAction, INITIAL)
  const leadIds = JSON.stringify(selectedLeads.map((lead) => lead.id))
  const feedback = [clay, google, ghl].find((state) => state.status !== 'idle')

  useEffect(() => {
    if ([clay, google, ghl].some((state) => state.status === 'success')) onSuccess()
  }, [clay, ghl, google, onSuccess])

  return (
    <div className="space-y-2">
      <details className="group relative">
        <summary className="inline-flex h-10 cursor-pointer list-none items-center gap-2 rounded-[var(--radius-md)] bg-accent px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.97] marker:content-none">
          Export {selectedLeads.length.toLocaleString()} selected
          <svg aria-hidden viewBox="0 0 20 20" className="size-4 transition-transform duration-150 group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 7 5 5 5-5" /></svg>
        </summary>
        <div className="absolute right-0 z-30 mt-2 w-64 origin-top-right rounded-xl border border-border bg-panel p-1.5 shadow-[var(--shadow-lg)]">
          <p className="px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Export destination</p>
          <button type="button" disabled={!selectedLeads.length} onClick={() => downloadSelectedCsv(selectedLeads)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-ink transition-[background-color,transform] duration-150 hover:bg-accent-soft/70 active:scale-[0.98] disabled:opacity-45">
            <ConnectorLogo name="csv" className="size-5" /><span>Download CSV</span>
          </button>
          <div className="my-1 border-t border-border" />
          {googleConnected ? <>
            <form action={googleAction}><input type="hidden" name="lead_ids" value={leadIds} /><input type="hidden" name="destination" value="google_sheets" /><MenuSubmit logo="google_sheets" label="Google Sheets" disabled={!selectedLeads.length} /></form>
            <form action={googleAction}><input type="hidden" name="lead_ids" value={leadIds} /><input type="hidden" name="destination" value="google_drive" /><MenuSubmit logo="google_drive" label="Google Drive" disabled={!selectedLeads.length} /></form>
          </> : <ConnectRow logo="google_sheets" label="Google" />}
          {ghlConnected ? <form action={ghlAction}><input type="hidden" name="lead_ids" value={leadIds} /><MenuSubmit logo="ghl" label="GoHighLevel" disabled={!selectedLeads.length} /></form> : <ConnectRow logo="ghl" label="GoHighLevel" />}
          {clayConnected ? <form action={clayAction}><input type="hidden" name="lead_ids" value={leadIds} /><MenuSubmit logo="clay" label="Clay" disabled={!selectedLeads.length} /></form> : <ConnectRow logo="clay" label="Clay" />}
        </div>
      </details>
      {feedback?.status === 'error' ? <p role="alert" className="max-w-sm text-sm text-danger">{feedback.message}</p> : null}
      {feedback?.status === 'success' ? <p role="status" className="max-w-sm text-sm text-success">{feedback.message}{'destinationUrl' in feedback && typeof feedback.destinationUrl === 'string' ? <> <a href={feedback.destinationUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Open file</a></> : null}</p> : null}
    </div>
  )
}
