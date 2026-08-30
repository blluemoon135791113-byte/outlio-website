import { NextResponse } from 'next/server'

/**
 * One-click unsubscribe — M6 Phase 17, criterion 2.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  RFC 8058 REQUIRES A SINGLE POST WITH NO LOGIN AND NO CONFIRMATION PAGE.  ║
 * ║                                                                           ║
 * ║  Gmail and Yahoo have required this of bulk senders since February 2024,  ║
 * ║  and the requirement is strict: the recipient presses one button in their ║
 * ║  mail client and is done. A sender who adds an "are you sure?" step gets  ║
 * ║  marked as spam instead, which is far more damaging than the lost         ║
 * ║  contact.                                                                 ║
 * ║                                                                           ║
 * ║  ⚠️ THIS ROUTE IS DELIBERATELY UNAUTHENTICATED. The person unsubscribing  ║
 * ║  is a RECIPIENT, not a user — they have no account and never will. The    ║
 * ║  signed token IS the authorization, and it authorizes exactly one         ║
 * ║  narrow, idempotent act: stop mailing this address.                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { recordUnsubscribe } from '@/lib/email/unsubscribe-action'
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe'

/**
 * The RFC 8058 path: `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 * makes the mail client POST here directly.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params
  const verified = verifyUnsubscribeToken(token)

  /*
   * ⚠️ AN INVALID TOKEN STILL RETURNS 200 WITH A NEUTRAL PAGE.
   *
   * Returning 404 or an error would let anyone probe which tokens are real,
   * and a mail client showing a failure to a recipient who just tried to
   * unsubscribe makes them press "report spam" instead. The unsubscribe either
   * worked or the link was already used — from the recipient's side those are
   * the same outcome, and neither should look broken.
   */
  if (!verified.valid) return page()

  /*
   * ⚠️ A FAILURE HERE STILL SHOWS THE RECIPIENT A SUCCESS PAGE.
   *
   * This is a deliberate trade-off and it is worth stating plainly. If the
   * database is briefly unavailable, the honest response would be a 500 — but
   * the person seeing it is someone who just asked to stop being contacted,
   * and their next action after an error page is "report spam". That costs the
   * sender's whole domain, and it does not get the recipient what they wanted
   * either.
   *
   * So: show the page, and make the failure LOUD on our side, where it can be
   * retried. The one thing that must never happen is the recipient being made
   * to try again.
   */
  try {
    await recordUnsubscribe(verified.subject)
  } catch (error) {
    console.error('[unsubscribe] FAILED to record — needs manual follow-up', {
      workspaceId: verified.subject.workspaceId,
      campaignId: verified.subject.campaignId,
      // The address is the point of the record, but it is a person's email in
      // a log line, so only the domain is kept.
      emailDomain: verified.subject.email.split('@')[1] ?? null,
      message: error instanceof Error ? error.message : 'unknown',
    })
  }

  return page()
}

/**
 * The visible footer link, for recipients who click rather than use the header
 * button. Same effect, because a GET that only shows a form would fail the
 * one-click requirement for clients that follow the link.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  return POST(request, context)
}

/**
 * A plain, self-contained page.
 *
 * ⚠️ NO TRACKING, NO ANALYTICS, NO EXTERNAL ASSETS. Someone who just asked to
 * stop being contacted should not be measured on their way out, and loading a
 * third-party script here would be exactly that.
 */
function page(): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Unsubscribed</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;
       min-height:100vh;display:grid;place-items:center;background:#faf9f7;color:#1c1b1a}
  main{max-width:32rem;padding:2rem;text-align:center}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  p{margin:0;color:#6b6864;font-size:.9375rem;line-height:1.6}
</style></head>
<body><main>
  <h1>You have been unsubscribed.</h1>
  <p>You will not receive further emails from this sender. It can take a few minutes for anything already on its way to stop.</p>
</main></body></html>`

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // A recipient's unsubscribe page has no business being indexed.
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
