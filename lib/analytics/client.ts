'use client'

import posthog from 'posthog-js'

import {
  isMarketingReplayRoute,
  isReplaySafeRoute,
  isReplaySampled,
  sanitizeAnalyticsException,
  sanitizeEventProperties,
  workspaceSizeBand,
  type AnalyticsEventName,
  type AnalyticsEventProperties,
} from '@/lib/analytics/catalog'

type Identity = {
  userId: string
  plan: string | null
  isAdmin: boolean
  workspaceId?: string | null
  workspaceRole?: string | null
  workspaceMemberCount?: number | null
}

let identifiedUserId: string | null = null

/*
 * Visitors are anonymous and nothing persists between loads (persistence is
 * disabled in instrumentation-client.ts), so there is no stable ID to sample
 * on. One draw per page load: a soft navigation keeps the decision.
 */
const marketingReplaySampled = typeof window !== 'undefined' && Math.random() < 0.1
let marketingReplayActive = false

export function captureClientEvent<E extends AnalyticsEventName>(
  event: E,
  properties: AnalyticsEventProperties<E>,
): void {
  try {
    posthog.capture(event, sanitizeEventProperties(event, properties, browserContext()))
  } catch {
    // Analytics is observational and must never interrupt a product action.
  }
}

export function identifyAnalyticsUser(identity: Identity): void {
  try {
    if (identifiedUserId && identifiedUserId !== identity.userId) posthog.reset()

    posthog.identify(identity.userId, {
      plan: identity.plan,
      is_admin: identity.isAdmin,
      workspace_role: identity.workspaceRole ?? null,
    })

    if (identity.workspaceId) {
      posthog.group('workspace', identity.workspaceId, {
        plan: identity.plan,
        workspace_size_band: workspaceSizeBand(identity.workspaceMemberCount ?? 1),
      })
    }
    identifiedUserId = identity.userId
  } catch {
    // Authentication and navigation must work when analytics is unavailable.
  }
}

export function resetAnalyticsIdentity(): void {
  identifiedUserId = null
  try {
    posthog.stopSessionRecording()
    posthog.reset()
  } catch {
    // Sign-out must not be blocked by analytics.
  }
}

export function syncSessionReplayForPath(pathname: string, userId: string): void {
  try {
    const testOverride =
      process.env.NODE_ENV !== 'production' &&
      process.env.NEXT_PUBLIC_POSTHOG_REPLAY_TEST_OVERRIDE === 'true'
    const search = typeof window === 'undefined' ? '' : window.location.search
    const hash = typeof window === 'undefined' ? '' : window.location.hash
    if (isReplaySafeRoute(pathname, search, hash) && (testOverride || isReplaySampled(userId))) {
      posthog.startSessionRecording()
    }
    else posthog.stopSessionRecording()
  } catch {
    // Replay is optional and must fail open.
  }
}

/**
 * Marketing counterpart of syncSessionReplayForPath. It only ever stops a
 * recording it started itself, so it cannot cut off a product replay that
 * ProductShell began.
 *
 * Reads the browser URL rather than usePathname(): on app.outlio.io the
 * proxy serves `/` from the internal `/app-home` route, and the allowlist is
 * about the public address — the one the visitor sees and the replay records.
 */
export function syncMarketingReplay(): void {
  try {
    const testOverride =
      process.env.NODE_ENV !== 'production' &&
      process.env.NEXT_PUBLIC_POSTHOG_REPLAY_TEST_OVERRIDE === 'true'
    const { pathname, search, hash } = window.location
    const record =
      isMarketingReplayRoute(pathname, search, hash) &&
      (testOverride || marketingReplaySampled)

    if (record && !marketingReplayActive) {
      posthog.startSessionRecording()
      marketingReplayActive = true
    } else if (!record && marketingReplayActive) {
      posthog.stopSessionRecording()
      marketingReplayActive = false
    }
  } catch {
    // Replay is optional and must fail open.
  }
}

export function captureClientException(
  error: unknown,
  context: { route: string; workspaceId?: string; errorCode?: string },
): void {
  try {
    const safeError = sanitizeAnalyticsException(error, 'Sanitized client exception')
    posthog.captureException(safeError, {
      route: context.route.split(/[?#]/, 1)[0].slice(0, 120),
      ...(context.workspaceId ? { workspace_id: context.workspaceId.slice(0, 120) } : {}),
      ...(context.errorCode ? { error_code: context.errorCode.slice(0, 80) } : {}),
      app_environment: browserContext().app_environment,
    })
  } catch {
    // Error reporting must not obscure the original failure.
  }
}

function browserContext(): Record<string, string | boolean> {
  return {
    app_environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 40) ?? 'unknown',
    is_synthetic: process.env.NEXT_PUBLIC_POSTHOG_SYNTHETIC === 'true',
  }
}
