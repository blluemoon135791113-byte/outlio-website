import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { assertHubbleAccess } from '@/lib/auth/access'
import { consume } from '@/lib/auth/rate-limit'
import { mergeRunIntoLeads } from '@/lib/intelligence/merge-store'
import { researchFieldSchema } from '@/lib/intelligence/types'
import { toClientError } from '@/lib/errors/catalog'
import { ACTION_LIMITS } from '@/lib/security/action-limits'

/**
 * Merge a finished run's results onto the leads it covered.
 *
 * Writes nothing external and spends nothing, but it does mutate every lead in
 * scope — so it is rate-limited on the export bucket, and ownership of the run
 * is settled inside `mergeRunIntoLeads` before a row is touched.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const paramsSchema = z.object({ id: z.string().uuid() })

const bodySchema = z.object({
  /** Omitted means every column the run produced. */
  fields: z.array(researchFieldSchema).min(1).max(64).optional(),
  /** Omitted means every lead the run covered. */
  leadIds: z.array(z.string().uuid()).min(1).max(10_000).optional(),
})

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  let userId: string
  try {
    const ctx = await assertHubbleAccess()
    userId = ctx.userId!
  } catch (error) {
    const safe = toClientError(error)
    return NextResponse.json(safe.body, { status: safe.status })
  }

  const params = paramsSchema.safeParse(await context.params)
  if (!params.success) {
    return NextResponse.json(
      { error: { code: 'ERR_NOT_FOUND', message: 'That research run could not be found.' } },
      { status: 404 },
    )
  }

  const limit = await consume(ACTION_LIMITS.export, `user:${userId}`)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: 'ERR_RATE_LIMITED', message: 'Too many merges. Try again shortly.' } },
      { status: 429 },
    )
  }

  let body: z.infer<typeof bodySchema>
  try {
    const raw: unknown = await request.json()
    const parsed = bodySchema.safeParse(raw ?? {})
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'ERR_VALIDATION', message: 'That merge request was not valid.' } },
        { status: 400 },
      )
    }
    body = parsed.data
  } catch {
    // An empty body is the common case: "merge everything from this run".
    body = {}
  }

  const outcome = await mergeRunIntoLeads(userId, params.data.id, body)

  if (!outcome.ok) {
    return NextResponse.json(
      { error: { code: 'ERR_VALIDATION', message: outcome.reason } },
      { status: 400 },
    )
  }

  return NextResponse.json({
    leadsUpdated: outcome.leadsUpdated,
    mergedCells: outcome.mergedCells,
    // Surfaced, not hidden: "42 leads updated, 18 values not found" is the
    // honest report, and the second half is what tells a user to try again.
    unknownCells: outcome.unknownCells,
    fields: outcome.fields,
  })
}
