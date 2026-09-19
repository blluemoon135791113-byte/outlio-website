import 'server-only'

import { after } from 'next/server'
import { PostHog } from 'posthog-node'

import {
  sanitizeEventProperties,
  sanitizeAnalyticsException,
  type AnalyticsEventName,
  type AnalyticsEventProperties,
} from '@/lib/analytics/catalog'

let posthogClient: PostHog | null = null

function getPostHogClient(): PostHog | null {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
  // Browser traffic uses the same-origin /ingest proxy. Server traffic must
  // call PostHog directly rather than making a request back through this app.
  const host = process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com'

  if (!token) return null

  posthogClient ??= new PostHog(token, {
    host,
    flushAt: 1,
    flushInterval: 0,
    enableExceptionAutocapture: false,
    requestTimeout: 2_000,
    fetchRetryCount: 0,
    // PostHog AI observability must remain metadata-only if introduced here.
    privacyMode: true,
  })

  return posthogClient
}

export async function captureServerEvent<E extends AnalyticsEventName>(
  distinctId: string,
  event: E,
  properties: AnalyticsEventProperties<E>,
  options: {
    eventId?: string
    delivery?: 'after_response' | 'immediate'
  } = {},
): Promise<void> {
  const posthog = getPostHogClient()
  if (!posthog) return

  const send = async () => {
    const safeProperties = sanitizeEventProperties(event, properties, serverContext())
    const workspaceId = safeProperties.workspace_id
    posthog.capture({
      distinctId,
      event,
      properties: { ...safeProperties, $geoip_disable: true, $ip: '0.0.0.0' },
      ...(typeof workspaceId === 'string' ? { groups: { workspace: workspaceId } } : {}),
      ...(options.eventId ? { uuid: options.eventId } : {}),
      disableGeoip: true,
    })
    await posthog.flush()
  }

  if (options.delivery === 'immediate') {
    await runAnalytics(send)
    return
  }

  scheduleAnalytics(send)
}

export async function identifyServerUser(
  distinctId: string,
  properties: { plan?: string | null; is_admin?: boolean; workspace_role?: string | null },
): Promise<void> {
  const posthog = getPostHogClient()
  if (!posthog) return

  scheduleAnalytics(async () => {
    posthog.identify({ distinctId, properties, disableGeoip: true })
    await posthog.flush()
  })
}

export async function captureServerException(
  error: unknown,
  distinctId: string,
  context: { workspaceId?: string; route?: string; errorCode?: string } = {},
): Promise<void> {
  const posthog = getPostHogClient()
  if (!posthog) return

  scheduleAnalytics(async () => {
    const safeError = sanitizeAnalyticsException(error, 'Sanitized server exception')
    posthog.captureException(safeError, distinctId, {
      ...serverContext(),
      $geoip_disable: true,
      $ip: '0.0.0.0',
      ...(context.workspaceId
        ? { workspace_id: context.workspaceId, $groups: { workspace: context.workspaceId } }
        : {}),
      ...(context.route ? { route: context.route.slice(0, 120) } : {}),
      ...(context.errorCode ? { error_code: context.errorCode.slice(0, 80) } : {}),
    })
    await posthog.flush()
  })
}

function scheduleAnalytics(task: () => Promise<void>): void {
  const safeTask = () => runAnalytics(task)

  try {
    // Next/Vercel keeps the invocation alive without delaying the response.
    after(safeTask)
  } catch {
    // A worker or test without request context still fails open.
    void safeTask()
  }
}

async function runAnalytics(task: () => Promise<void>): Promise<void> {
  try {
    await task()
  } catch {
    // Observability must never change the business operation's outcome.
  }
}

function serverContext(): Record<string, string | boolean> {
  return {
    app_environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 40) ?? 'unknown',
    is_synthetic: process.env.NEXT_PUBLIC_POSTHOG_SYNTHETIC === 'true',
  }
}
