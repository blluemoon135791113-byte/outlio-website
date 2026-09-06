/**
 * GET /api/extension/me — identity and entitlement for the popup.
 *
 * The popup renders its state from THIS response, never from anything it
 * decided locally. `canCapture` is the server's verdict; the extension's job
 * is to display it, not to compute it.
 */
import { NextResponse } from 'next/server'

import { getActiveSession } from '@/lib/extension/capture'
import { resolveExtensionAuth } from '@/lib/extension/auth'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const auth = await resolveExtensionAuth(request)

  if (!auth.ok) {
    // Still a useful answer: the popup needs to distinguish "reconnect" from
    // "your subscription lapsed" to show the right call to action.
    return NextResponse.json(
      { canCapture: false, error: auth.code },
      { status: auth.status },
    )
  }

  const { ctx, device } = auth
  const session = await getActiveSession(ctx.userId!)

  return NextResponse.json({
    canCapture: true,
    email: ctx.profile?.email ?? null,
    plan: ctx.plan?.name ?? null,
    device: { id: device.id, label: device.label },
    activeSession: session
      ? {
          id: session.id,
          pagesProcessed: session.pages_processed,
          leadsFound: session.leads_found,
          leadsImported: session.leads_imported,
          duplicatesSkipped: session.duplicates_skipped,
          startedAt: session.started_at,
        }
      : null,
  })
}
