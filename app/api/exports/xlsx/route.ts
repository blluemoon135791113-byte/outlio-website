import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { assertAccess } from '@/lib/auth/access'
import { consume } from '@/lib/auth/rate-limit'
import { isAppError } from '@/lib/errors/catalog'
import { buildJobWorkbook } from '@/lib/export/job-workbook'
import { ACTION_LIMITS } from '@/lib/security/action-limits'

// exceljs needs Node streams and Buffer; the edge runtime has neither.
export const runtime = 'nodejs'
// A download reflects the rows as they are now, never a cached copy.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store, private' }

/** The only messages a client ever sees from this route. */
const REFUSALS = {
  invalid: { status: 400, message: 'Missing job.' },
  not_found: { status: 404, message: 'That export is not available.' },
  not_ready: { status: 409, message: 'That export is not ready yet.' },
  empty: { status: 404, message: 'This extraction has no rows to export.' },
  too_large: {
    status: 413,
    message: 'This extraction is too large to build as an Excel file. Use Download CSV instead.',
  },
  unavailable: { status: 503, message: "We couldn't build your export. Please try again." },
} as const

function refuse(reason: keyof typeof REFUSALS) {
  const { status, message } = REFUSALS[reason]
  return NextResponse.json({ error: { code: reason, message } }, { status, headers: NO_STORE })
}

/**
 * Downloads one extraction as an Excel workbook whose URL cells are clickable.
 *
 * ⚠️ THE SAME GATE AS THE CSV DOWNLOAD, not a weaker one. `getDownloadUrlAction`
 * uses `assertAccess()`, so an expired or suspended account cannot download a
 * CSV; this uses it too, or the workbook would be a way around that. A signed-in
 * session alone is not enough — that is what some older export routes check,
 * and it is the weaker test.
 *
 * GET, because it only reads the caller's own rows and is safe to repeat.
 */
export async function GET(request: NextRequest) {
  let userId: string
  try {
    const ctx = await assertAccess()
    userId = ctx.userId!
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json(error.toResponseBody(), { status: error.status, headers: NO_STORE })
    }
    return refuse('unavailable')
  }

  // Its own bucket, not `export`: this is the one O(rows) operation among them.
  const limit = await consume(ACTION_LIMITS.workbook, `user:${userId}`)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many requests. Please wait and try again.' } },
      { status: 429, headers: NO_STORE },
    )
  }

  const jobId = z.string().uuid().safeParse(request.nextUrl.searchParams.get('job'))
  if (!jobId.success) return refuse('invalid')

  let result
  try {
    result = await buildJobWorkbook(userId, jobId.data)
  } catch {
    // Logged without the job's contents — lead data never reaches a log line.
    console.error('[exports/xlsx] workbook build failed')
    return refuse('unavailable')
  }
  if (!result.ok) return refuse(result.reason)

  return new NextResponse(Buffer.from(result.bytes), {
    status: 200,
    headers: {
      ...NO_STORE,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // Server-generated from the job id; nothing user-supplied reaches it.
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
