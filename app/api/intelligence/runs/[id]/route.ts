import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { assertHubbleAccess } from '@/lib/auth/access'
import { getRunResults } from '@/lib/intelligence/results'
import { toClientError } from '@/lib/errors/catalog'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Poll a run's status and results.
 *
 * Deliberately not rate-limited like the write routes: this is what the open
 * results screen calls every couple of seconds, and throttling it would make a
 * long research job look broken.
 */
export const dynamic = 'force-dynamic'

const paramsSchema = z.object({ id: z.string().uuid() })

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  let userId: string
  try {
    const ctx = await assertHubbleAccess()
    userId = ctx.userId!
  } catch (error) {
    // `toClientError` already returns the full client-safe envelope; wrapping it
    // again would nest `error` inside `error` and break every caller.
    const safe = toClientError(error)
    return NextResponse.json(safe.body, { status: safe.status })
  }

  const parsed = paramsSchema.safeParse(await context.params)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'ERR_NOT_FOUND', message: 'That research run could not be found.' } },
      { status: 404 },
    )
  }

  /*
   * Recover runs abandoned by a cut-short `after()` before reporting status.
   * Cheap, idempotent, and non-fatal — the same pattern the jobs page uses.
   * Without it a stalled run would show "running" forever with no worker.
   */
  try {
    await createAdminClient().rpc('reap_stale_research_runs', { p_timeout_seconds: 900 })
  } catch {
    // The last known state is still worth showing if the sweep fails.
  }

  const results = await getRunResults(userId, parsed.data.id)

  // Same answer for "not yours" as "does not exist", so a run id cannot be
  // probed for existence.
  if (!results) {
    return NextResponse.json(
      { error: { code: 'ERR_NOT_FOUND', message: 'That research run could not be found.' } },
      { status: 404 },
    )
  }

  return NextResponse.json(results)
}
