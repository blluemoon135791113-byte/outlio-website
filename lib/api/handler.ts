import 'server-only'

/**
 * The shared shape of every public API route — M8 Phase 25.5.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  EVERY ROUTE GOES THROUGH `apiRoute`. That is what makes criterion 7      ║
 * ║  hold: authentication, rate limiting, scope checking, workspace scoping   ║
 * ║  and audit logging happen in ONE place, so a new endpoint cannot forget   ║
 * ║  one of them. A handler receives a workspace id it did not choose and     ║
 * ║  has no way to ask for a different one.                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { NextResponse } from 'next/server'

import { authenticateApiKey, logApiRequest, type ApiAuthContext, type ApiScope } from '@/lib/api/keys'

export type ApiHandler = (
  request: Request,
  context: ApiAuthContext,
) => Promise<{ status: number; body: unknown }>

/**
 * ⚠️ PAGINATION IS CAPPED AND THE CAP IS NOT NEGOTIABLE. Without it a single
 * request can ask for a workspace's entire contact table, which is both a
 * denial-of-service against our database and an exfiltration primitive if a
 * key ever leaks. 100 is generous for a page and small enough to be cheap.
 */
export const MAX_PAGE_SIZE = 100
export const DEFAULT_PAGE_SIZE = 25

export function readPaging(request: Request): { limit: number; offset: number } {
  const url = new URL(request.url)
  const rawLimit = Number(url.searchParams.get('limit') ?? DEFAULT_PAGE_SIZE)
  const rawOffset = Number(url.searchParams.get('offset') ?? 0)

  return {
    // NaN, negatives and absurd values all collapse to something sane rather
    // than reaching the database.
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE,
    offset: Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0,
  }
}

/** Wraps a handler with auth, limits, scoping and logging. */
export function apiRoute(scope: ApiScope, handler: ApiHandler) {
  return async function route(request: Request): Promise<Response> {
    const startedAt = Date.now()
    const url = new URL(request.url)
    const auth = await authenticateApiKey(request, scope)

    if (!auth.ok) {
      await logApiRequest({
        workspaceId: null,
        apiKeyId: null,
        method: request.method,
        path: url.pathname,
        status: auth.status,
        deniedReason: auth.failure,
        durationMs: Date.now() - startedAt,
      })

      return NextResponse.json(
        { error: { code: auth.failure, message: auth.message } },
        {
          status: auth.status,
          headers: auth.retryAfter ? { 'Retry-After': String(auth.retryAfter) } : undefined,
        },
      )
    }

    try {
      const result = await handler(request, auth.context)

      await logApiRequest({
        workspaceId: auth.context.workspaceId,
        apiKeyId: auth.context.apiKeyId,
        method: request.method,
        path: url.pathname,
        status: result.status,
        durationMs: Date.now() - startedAt,
      })

      return NextResponse.json(result.body, {
        status: result.status,
        headers: {
          // So a caller can back off before being refused rather than after.
          'X-RateLimit-Limit': String(auth.context.rateLimitPerMinute),
          'Cache-Control': 'no-store',
        },
      })
    } catch (error) {
      /*
       * ⚠️ NEVER RETURNS THE ERROR. A stack trace, a SQL string or an internal
       * id in a public API response is a map of the system for anyone probing
       * it (CLAUDE.md). The detail goes to the log; the caller gets a code.
       */
      console.error('[api] handler failed', {
        path: url.pathname,
        workspaceId: auth.context.workspaceId,
        message: error instanceof Error ? error.message : 'unknown',
      })

      await logApiRequest({
        workspaceId: auth.context.workspaceId,
        apiKeyId: auth.context.apiKeyId,
        method: request.method,
        path: url.pathname,
        status: 500,
        deniedReason: 'handler_error',
        durationMs: Date.now() - startedAt,
      })

      return NextResponse.json(
        { error: { code: 'internal_error', message: 'Something went wrong.' } },
        { status: 500 },
      )
    }
  }
}
