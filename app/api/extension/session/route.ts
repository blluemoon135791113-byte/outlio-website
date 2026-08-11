/**
 * POST /api/extension/session — start or finish a capture session.
 *
 * Starting is idempotent: a partial unique index allows one active session per
 * user, so a second Start Capture resumes the running one instead of splitting
 * the counters. That is what makes "stop and resume" and "reopened the popup"
 * safe rather than a source of duplicate sessions.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { RULES, consume } from '@/lib/auth/rate-limit'
import { finishCaptureSession, getActiveSession, startCaptureSession } from '@/lib/extension/capture'
import { resolveExtensionAuth } from '@/lib/extension/auth'
import { recordSecurityEvent } from '@/lib/security/events'

export const runtime = 'nodejs'

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('finish'), sessionId: z.string().uuid() }),
])

export async function POST(request: Request) {
  const auth = await resolveExtensionAuth(request)

  if (!auth.ok) {
    return NextResponse.json({ error: auth.code }, { status: auth.status })
  }

  const { ctx, device } = auth
  const userId = ctx.userId!

  const limit = await consume(RULES.extensionSession, `device:${device.id}`)
  if (!limit.allowed) {
    return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 })
  }

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 })
  }

  if (body.action === 'start') {
    const session = await startCaptureSession({
      userId,
      deviceId: device.id,
      browser: device.browser,
    })

    await recordSecurityEvent({
      event: 'capture.started',
      userId,
      context: { session_id: session.id, device_id: device.id },
    })

    return NextResponse.json({
      sessionId: session.id,
      status: session.status,
      pagesProcessed: session.pages_processed,
      leadsFound: session.leads_found,
      leadsImported: session.leads_imported,
      duplicatesSkipped: session.duplicates_skipped,
    })
  }

  const finished = await finishCaptureSession(userId, body.sessionId)

  if (!finished) {
    // Already finished, or never belonged to this user. Report the current
    // state rather than an error the popup cannot act on.
    const active = await getActiveSession(userId)
    return NextResponse.json(
      { sessionId: body.sessionId, status: active ? 'active' : 'completed' },
      { status: 200 },
    )
  }

  await recordSecurityEvent({
    event: 'capture.completed',
    userId,
    context: {
      session_id: finished.id,
      pages: finished.pages_processed,
      leads: finished.leads_imported,
    },
  })

  return NextResponse.json({
    sessionId: finished.id,
    status: finished.status,
    pagesProcessed: finished.pages_processed,
    leadsFound: finished.leads_found,
    leadsImported: finished.leads_imported,
    duplicatesSkipped: finished.duplicates_skipped,
  })
}
