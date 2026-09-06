import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { consume } from '@/lib/auth/rate-limit'
import { exportSelectedLeadsToGhl } from '@/lib/export/service'
import { ACTION_LIMITS } from '@/lib/security/action-limits'
import { createClient } from '@/lib/supabase/server'

const inputSchema = z.object({ leadIds: z.array(z.string().uuid()).min(1).max(1000).refine((ids) => new Set(ids).size === ids.length) })

export async function POST(request: NextRequest) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required.' } }, { status: 401 })
  const limit = await consume(ACTION_LIMITS.export, `user:${user.id}`)
  if (!limit.allowed) return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many export requests.' } }, { status: 429 })
  const parsed = inputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: { code: 'INVALID_REQUEST', message: 'Select between 1 and 1,000 leads.' } }, { status: 400 })
  try {
    const result = await exportSelectedLeadsToGhl({ userId: user.id, leadIds: parsed.data.leadIds })
    return NextResponse.json({ totalRequested: result.totalRequested, successfullyExported: result.successfulCount, failed: result.failedCount, errors: result.failures })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'GHL_EXPORT_FAILED'
    const status = code === 'GHL_NOT_CONNECTED' ? 409 : code === 'EXPORT_SOURCE_NOT_FOUND' ? 404 : 500
    return NextResponse.json({ error: { code, message: code === 'GHL_NOT_CONNECTED' ? 'Connect HighLevel before exporting leads.' : code === 'EXPORT_SOURCE_NOT_FOUND' ? 'One or more selected leads are unavailable.' : 'The HighLevel export could not be completed.' } }, { status })
  }
}
