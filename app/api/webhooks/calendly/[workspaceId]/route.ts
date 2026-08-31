import { NextResponse } from 'next/server'

/**
 * Calendly webhook receiver — M8 Phase 24.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE RAW BODY IS READ BEFORE ANYTHING ELSE AND NEVER RE-SERIALISED.      ║
 * ║                                                                           ║
 * ║  The signature is an HMAC over `<timestamp>.<raw body>`. Parsing the JSON ║
 * ║  and stringifying it back changes key order and whitespace, so the        ║
 * ║  signature would never match — and the usual "fix" is to disable          ║
 * ║  verification, which turns this into an open write endpoint.             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ ALWAYS RETURNS 200 ONCE THE SIGNATURE IS VALID. Calendly retries on a
 * non-2xx, so returning 500 for a payload we cannot parse would have it
 * redelivered forever. A valid-but-unhandled event is logged and accepted.
 * An INVALID signature returns 401, because that is not Calendly.
 */
import {
  normalizeCalendlyEvent,
  UnsupportedCalendlyEvent,
} from '@/lib/integrations/calendly/normalize'
import { verifyCalendlySignature } from '@/lib/integrations/calendly/signature'
import { ingestMeetingEvent } from '@/lib/meetings/ingest'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
): Promise<Response> {
  const { workspaceId } = await params

  // Raw first. Never `request.json()` before verifying.
  const rawBody = await request.text()

  const verification = verifyCalendlySignature(
    rawBody,
    request.headers.get('calendly-webhook-signature'),
    process.env.CALENDLY_WEBHOOK_SIGNING_KEY,
  )

  if (!verification.valid) {
    /*
     * ⚠️ THE REASON IS LOGGED, NOT RETURNED. Telling a caller whether their
     * signature was stale versus wrong helps them forge one; the log is where
     * an operator can tell a misconfiguration from an attack.
     */
    console.warn('[calendly] rejected a webhook', { workspaceId, reason: verification.reason })
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ ok: true, ignored: 'unparseable body' }, { status: 200 })
  }

  try {
    const event = normalizeCalendlyEvent(parsed)
    const result = await ingestMeetingEvent(workspaceId, event)

    return NextResponse.json(
      {
        ok: true,
        // Useful in Calendly's own delivery log when someone is debugging.
        recorded: result.isNew,
        matched: result.matched,
        queued: result.queuedForMatching,
      },
      { status: 200 },
    )
  } catch (error) {
    if (error instanceof UnsupportedCalendlyEvent) {
      // Expected: routing forms, and the cancellation half of a reschedule.
      return NextResponse.json({ ok: true, ignored: error.message }, { status: 200 })
    }

    /*
     * A genuine failure DOES return 500, so Calendly retries it — the dedupe
     * key makes that safe, and losing a real booking silently would be worse
     * than a retry.
     */
    console.error('[calendly] failed to ingest', {
      workspaceId,
      message: error instanceof Error ? error.message : 'unknown',
    })
    return NextResponse.json({ error: 'could not process' }, { status: 500 })
  }
}
