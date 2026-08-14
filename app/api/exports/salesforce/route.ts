import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { assertAccess } from '@/lib/auth/access'
import { consume } from '@/lib/auth/rate-limit'
import { toClientError } from '@/lib/errors/catalog'
import { exportSelectedLeadsToSalesforce } from '@/lib/export/service'
import { isApprovedOutlioAppOrigin } from '@/lib/integrations/salesforce'
import { ACTION_LIMITS } from '@/lib/security/action-limits'

const requestSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(1_000)
    .refine((values) => new Set(values).size === values.length),
})

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin')
    if (
      !origin ||
      !isApprovedOutlioAppOrigin(origin) ||
      new URL(origin).origin !== request.nextUrl.origin
    ) {
      return NextResponse.json(
        { error: { code: 'ERR_FORBIDDEN', message: "You don't have permission to do that." } },
        { status: 403 },
      )
    }
    const ctx = await assertAccess()
    const userId = ctx.userId!
    const rateLimit = await consume(ACTION_LIMITS.export, `user:${userId}`)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: { code: 'ERR_RATE_LIMITED', message: 'Too many export requests. Please wait and try again.' } },
        { status: 429 },
      )
    }
    const body = requestSchema.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json(
        { error: { code: 'ERR_VALIDATION', message: 'Select between 1 and 1,000 leads to export.' } },
        { status: 400 },
      )
    }
    const result = await exportSelectedLeadsToSalesforce({
      userId,
      leadIds: body.data.leadIds,
    })
    return NextResponse.json({
      exportJobId: result.exportJobId,
      status: result.status,
      totalRequested: result.totalRequested,
      successfullyExported: result.successfulCount,
      failed: result.failedCount,
      errors: result.failures,
    }, { status: 200 })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'SALESFORCE_NOT_CONNECTED') {
      return NextResponse.json(
        { error: { code, message: 'Connect Salesforce before exporting leads.' } },
        { status: 409 },
      )
    }
    if (code === 'EXPORT_SOURCE_NOT_FOUND') {
      return NextResponse.json(
        { error: { code, message: 'One or more selected leads are no longer available.' } },
        { status: 404 },
      )
    }
    const clientError = toClientError(error)
    return NextResponse.json(clientError.body, { status: clientError.status })
  }
}
