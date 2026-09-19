'use server'

import { captureServerEvent, captureServerException } from '@/lib/posthog-server'
import { requireWorkspace } from '@/lib/workspaces/context'

export type AnalyticsValidationState =
  | { ok: true; validationRunId: string }
  | { ok: false; error: string }

export async function runServerAnalyticsValidation(
  validationRunId: string,
): Promise<AnalyticsValidationState> {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.NEXT_PUBLIC_POSTHOG_SYNTHETIC !== 'true'
  ) {
    return { ok: false, error: 'Synthetic analytics validation is disabled.' }
  }

  const ctx = await requireWorkspace()
  const properties = {
    workspace_id: ctx.workspace.id,
    channel: 'server' as const,
    validation_run_id: validationRunId,
  }

  // Deliberately submit the same event twice with the same UUID. PostHog must
  // store it once, proving an action retry cannot double-count this event.
  await captureServerEvent(ctx.userId, 'analytics_validation_completed', properties, {
    eventId: validationRunId,
  })
  await captureServerEvent(ctx.userId, 'analytics_validation_completed', properties, {
    eventId: validationRunId,
  })

  await captureServerException(
    new Error('synthetic-private-message person@example.com token=do-not-capture'),
    ctx.userId,
    {
      workspaceId: ctx.workspace.id,
      route: '/dashboard',
      errorCode: 'SYNTHETIC_SERVER_VALIDATION',
    },
  )

  return { ok: true, validationRunId }
}
