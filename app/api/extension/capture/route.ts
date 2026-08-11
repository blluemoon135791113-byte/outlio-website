/**
 * POST /api/extension/capture — receive one captured page.
 *
 * The hot path. Order is deliberate, cheapest rejection first:
 *
 *   1. auth + entitlement   (resolveExtensionAuth: all seven checks)
 *   2. rate limit per device
 *   3. body shape and size
 *   4. content hash claim   (duplicate → 200, no work, no credit)
 *   5. hand to the existing pipeline
 *
 * A duplicate is a SUCCESS, not an error: refreshing a page or stepping back
 * is normal browsing, and the user should see "already captured", not a
 * failure they feel they have to fix.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { RULES, consume } from '@/lib/auth/rate-limit'
import { claimPage, contentHash, markPageFailed } from '@/lib/extension/capture'
import { resolveExtensionAuth } from '@/lib/extension/auth'
import { ingestCapturedPage } from '@/lib/extension/ingest'
import { recordSecurityEvent } from '@/lib/security/events'
import { isAppError } from '@/lib/errors/catalog'

/** Node runtime: the ingest path uses node:crypto and the service role. */
export const runtime = 'nodejs'

/** A Sales Navigator results page is ~1 MB of HTML; 4 MB is generous. */
const MAX_HTML_BYTES = 4 * 1024 * 1024

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  html: z.string().min(1).max(MAX_HTML_BYTES),
  sourceUrl: z.string().url().max(2048).nullable().optional(),
  pageIdentifier: z.string().max(64).nullable().optional(),
  /** Client's hash, compared against ours to catch truncated transfers. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
})

export async function POST(request: Request) {
  const auth = await resolveExtensionAuth(request)

  if (!auth.ok) {
    return NextResponse.json({ error: auth.code }, { status: auth.status })
  }

  const { ctx, device } = auth
  const userId = ctx.userId!

  const limit = await consume(RULES.extensionCapture, `device:${device.id}`)
  if (!limit.allowed) {
    return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 })
  }

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 })
  }

  // Integrity check. A mismatch means the page was truncated in transit, and
  // parsing half a page would silently under-report leads.
  const serverHash = contentHash(body.html)
  if (body.contentHash && body.contentHash !== serverHash) {
    return NextResponse.json({ error: 'CONTENT_HASH_MISMATCH' }, { status: 400 })
  }

  const claim = await claimPage({
    userId,
    sessionId: body.sessionId,
    html: body.html,
    sourceUrl: body.sourceUrl ?? null,
    pageIdentifier: body.pageIdentifier ?? null,
  })

  if (claim.status === 'duplicate') {
    await recordSecurityEvent({
      event: 'capture.page.duplicate',
      userId,
      context: { session_id: body.sessionId, page: body.pageIdentifier ?? null },
    })
    return NextResponse.json({
      success: true,
      duplicate: true,
      leadsFound: 0,
      leadsAdded: 0,
      duplicatesSkipped: 1,
    })
  }

  if (claim.status !== 'claimed') {
    return NextResponse.json(
      { error: claim.status === 'session_closed' ? 'SESSION_CLOSED' : 'SESSION_NOT_FOUND' },
      { status: 409 },
    )
  }

  await recordSecurityEvent({
    event: 'capture.page.received',
    userId,
    context: { session_id: body.sessionId, page: body.pageIdentifier ?? null },
  })

  try {
    const { jobId } = await ingestCapturedPage({
      userId,
      captureSessionId: body.sessionId,
      pageId: claim.pageId,
      html: body.html,
      pageIdentifier: body.pageIdentifier ?? null,
    })

    // Counts are not known yet — the worker parses asynchronously and pushes
    // them over Realtime. Returning "queued" keeps the request short instead
    // of holding the connection open while a page is parsed.
    return NextResponse.json({
      success: true,
      duplicate: false,
      queued: true,
      jobId,
      pageId: claim.pageId,
    })
  } catch (e) {
    const code = isAppError(e) ? e.code : 'ERR_INTERNAL'
    await markPageFailed(userId, claim.pageId, code)

    await recordSecurityEvent({
      event: 'capture.page.failed',
      level: 'error',
      userId,
      context: { session_id: body.sessionId, code },
    })

    // Out of credits is the user's to fix, so it gets its own status.
    const status = code === 'ERR_LIMIT_REACHED' ? 402 : 422
    return NextResponse.json({ error: code }, { status })
  }
}
