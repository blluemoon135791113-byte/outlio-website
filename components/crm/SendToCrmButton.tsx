'use client'

import { useActionState } from 'react'

import {
  sendExtractionToCrm,
  type SendToCrmState,
} from '@/app/(product)/crm/import/actions'

/**
 * "Add to CRM" on a finished extraction — R1.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE LEAD ENGINE AND THE CRM WERE TWO DISCONNECTED PRODUCTS.             ║
 * ║                                                                           ║
 * ║  `ingestExtractionJob` was built and tested in M2 and had no caller       ║
 * ║  anywhere, so extracted leads could never reach the CRM. This is the      ║
 * ║  bridge, and it is EXPLICIT: the brief is firm that thousands of contacts ║
 * ║  must not appear in someone's CRM without them asking for it.             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function SendToCrmButton({
  jobId,
  recordCount,
}: {
  jobId: string
  recordCount: number | null
}) {
  const [state, action, pending] = useActionState<SendToCrmState, FormData>(
    sendExtractionToCrm,
    null,
  )

  // Nothing to move. Showing the button would only produce a confusing no-op.
  if (!recordCount || recordCount === 0) return null

  if (state?.ok) {
    return <span className="text-xs font-medium text-success">{state.message}</span>
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="jobId" value={jobId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius-md)] bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
      >
        {/*
          Says the count, so the action is not a leap of faith. Says "Add",
          not "Sync" — this happens once, when asked.
        */}
        {pending ? 'Adding…' : `Add ${recordCount} to CRM`}
      </button>

      {state && !state.ok ? (
        <span className="text-xs text-danger">{state.error}</span>
      ) : null}
    </form>
  )
}
