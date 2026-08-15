import { NextResponse, type NextRequest } from 'next/server'
import { after } from 'next/server'
import { z } from 'zod'

import { assertAccess } from '@/lib/auth/access'
import { consume } from '@/lib/auth/rate-limit'
import { answerClarifications, claimAndProcessResearchRun } from '@/lib/intelligence/run'
import { toClientError } from '@/lib/errors/catalog'
import { ACTION_LIMITS } from '@/lib/security/action-limits'

/** Answer a run's clarification questions and release it to the queue (spec §7). */
export const maxDuration = 300

const inputSchema = z.object({
  researchRunId: z.string().uuid(),
  answers: z.record(z.string().min(1).max(64), z.string().max(200)),
})

export async function POST(request: NextRequest) {
  let userId: string
  try {
    const ctx = await assertAccess()
    userId = ctx.userId!
  } catch (error) {
    // `toClientError` already returns the full client-safe envelope; wrapping it
    // again would nest `error` inside `error` and break every caller.
    const safe = toClientError(error)
    return NextResponse.json(safe.body, { status: safe.status })
  }

  const limit = await consume(ACTION_LIMITS.research, `user:${userId}`)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: 'ERR_RATE_LIMITED', message: 'Too many research requests. Please wait.' } },
      { status: 429 },
    )
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'ERR_VALIDATION', message: 'Choose an answer to continue.' } },
      { status: 400 },
    )
  }

  const { researchRunId, answers } = parsed.data
  const answered = await answerClarifications(userId, researchRunId, answers)

  if (!answered.ok) {
    return NextResponse.json(
      { error: { code: 'ERR_VALIDATION', message: answered.reason } },
      { status: 409 },
    )
  }

  after(async () => {
    try {
      await claimAndProcessResearchRun(researchRunId, userId, 'vercel-after')
    } catch {
      // Recorded on the run; the reaper retries.
    }
  })

  return NextResponse.json({ status: 'running', researchRunId })
}
