'use client'

import { useState, useTransition } from 'react'

import { runServerAnalyticsValidation } from '@/app/(product)/dashboard/analytics-validation/actions'
import { captureClientEvent, captureClientException } from '@/lib/analytics/client'

export function AnalyticsValidationPanel({
  workspaceId,
  validationRunId,
}: {
  workspaceId: string
  validationRunId: string
}) {
  const [browserSent, setBrowserSent] = useState(false)
  const [serverState, setServerState] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <section
      data-private
      aria-label="Synthetic analytics validation"
      className="rounded-[var(--radius-lg)] border border-dashed border-accent/40 bg-accent-soft/25 p-4"
    >
      <p className="text-sm font-semibold text-ink">Synthetic PostHog validation</p>
      <p className="mt-1 text-xs text-muted">
        Development-only controls. No customer action, email, export, payment, or AI request is
        performed.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-[var(--radius-md)] bg-accent px-3 py-2 text-xs font-semibold text-white"
          onClick={() => {
            captureClientEvent('analytics_validation_completed', {
              workspace_id: workspaceId,
              channel: 'browser',
              validation_run_id: validationRunId,
            })
            captureClientException(
              new Error('synthetic-private-message person@example.com token=do-not-capture'),
              {
                route: '/dashboard',
                workspaceId,
                errorCode: 'SYNTHETIC_BROWSER_VALIDATION',
              },
            )
            setBrowserSent(true)
          }}
        >
          Send browser event + error
        </button>
        <button
          type="button"
          disabled={pending}
          className="rounded-[var(--radius-md)] border border-border bg-panel px-3 py-2 text-xs font-semibold text-ink disabled:opacity-60"
          onClick={() => {
            startTransition(async () => {
              const result = await runServerAnalyticsValidation(validationRunId)
              setServerState(result.ok ? 'Server event + error queued' : result.error)
            })
          }}
        >
          {pending ? 'Sending…' : 'Send server event + error'}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted" aria-live="polite">
        {browserSent ? 'Browser event + error queued. ' : ''}
        {serverState ?? ''}
      </p>
    </section>
  )
}
