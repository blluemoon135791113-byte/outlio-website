'use client'

import Link from 'next/link'
import { useActionState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'

import {
  exportSelectedLeadsToSalesforceAction,
  type LeadExportActionState,
} from '@/lib/export/actions'

const INITIAL: LeadExportActionState = { status: 'idle' }

function ExportButton({ count }: { count: number }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending || count === 0}
      className="inline-flex h-10 items-center rounded-[var(--radius-md)] bg-accent px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending
        ? 'Exporting to Salesforce…'
        : `Export ${count.toLocaleString()} selected to Salesforce`}
    </button>
  )
}

export function SalesforceLeadExport({
  selectedLeadIds,
  salesforceConnected,
  onSuccess,
}: {
  selectedLeadIds: readonly string[]
  salesforceConnected: boolean
  onSuccess: () => void
}) {
  const [state, action] = useActionState(exportSelectedLeadsToSalesforceAction, INITIAL)

  useEffect(() => {
    if (state.status === 'success') onSuccess()
  }, [onSuccess, state.status])

  if (!salesforceConnected) {
    return (
      <Link href="/dashboard/settings#integrations" className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-4 text-sm font-semibold text-ink hover:border-accent/35 hover:text-accent">
        Connect Salesforce to export
      </Link>
    )
  }

  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="lead_ids" value={JSON.stringify(selectedLeadIds)} />
        <ExportButton count={selectedLeadIds.length} />
      </form>
      {state.status === 'error' ? <p role="alert" className="text-sm text-danger">{state.message}</p> : null}
      {state.status === 'success' ? <p role="status" className="text-sm text-success">{state.message}</p> : null}
    </div>
  )
}
