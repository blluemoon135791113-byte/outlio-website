import { NextResponse, type NextRequest } from 'next/server'

import { isAuthorizedCronRequest } from '@/lib/workers/cron-auth'
import { runTick } from '@/lib/workers/tick'

/**
 * The scheduled trigger for every background worker — R10.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS ROUTE SENDS EMAIL. AN OPEN ONE IS AN ABUSE VECTOR.              ║
 * ║                                                                           ║
 * ║  Anyone who can call it can drain a customer's daily send allowance and   ║
 * ║  burn their domain reputation, at whatever rate they can issue requests.  ║
 * ║  It authenticates before doing anything, and it FAILS CLOSED: a missing   ║
 * ║  CRON_SECRET refuses every request rather than waving them through, which ║
 * ║  is the failure that matters in the one environment where the variable    ║
 * ║  was forgotten.                                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

// The tick does real network work — SMTP, IMAP, customer webhook endpoints.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    /*
     * Deliberately says nothing about why. Telling an unauthenticated caller
     * that the secret is merely unconfigured tells them what to wait for.
     */
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const result = await runTick()

  /*
   * ⚠️ 200 WHENEVER THE TICK RAN, even if a job inside it failed. Schedulers
   * retry on a non-2xx, and retrying the whole tick because one workspace's
   * mailbox is misconfigured would re-do the sends that already succeeded.
   * Individual failures are in the body and in the logs; the tick itself
   * succeeded in running.
   */
  return NextResponse.json(result, { status: 200 })
}

/** Some schedulers POST. Same guard, same work. */
export const POST = GET
