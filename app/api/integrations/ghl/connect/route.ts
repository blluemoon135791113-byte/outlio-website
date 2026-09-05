import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { consume } from '@/lib/auth/rate-limit'
import { testGhlCredentials, validateGhlCredentials } from '@/lib/integrations/ghl'
import { saveGhlConnection } from '@/lib/integrations/ghl-repository'
import { isApprovedOutlioAppOrigin } from '@/lib/integrations/origin'
import { ACTION_LIMITS } from '@/lib/security/action-limits'
import { recordSecurityEvent } from '@/lib/security/events'
import { createClient } from '@/lib/supabase/server'

const inputSchema = z.object({ token: z.string().min(1).max(4096), locationId: z.string().min(1).max(128) })

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (!origin || !isApprovedOutlioAppOrigin(origin)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const limit = await consume(ACTION_LIMITS.integration, `user:${user.id}`)
  if (!limit.allowed) return NextResponse.json({ error: 'Too many requests. Please wait and try again.' }, { status: 429 })
  const parsed = inputSchema.safeParse(await request.json().catch(() => null))
  const credentials = parsed.success ? validateGhlCredentials(parsed.data) : null
  if (!credentials) return NextResponse.json({ error: 'Enter a valid token and Location ID.' }, { status: 400 })
  const test = await testGhlCredentials(credentials)
  if (!test.ok) return NextResponse.json({ error: test.message }, { status: test.reconnectRequired ? 401 : 400 })
  try {
    await saveGhlConnection(user.id, credentials, test.accountName ?? null)
    await recordSecurityEvent({ event: 'integration.connected', userId: user.id, context: { provider: 'ghl' } })
    return NextResponse.json({ ok: true, status: 'connected', accountName: test.accountName ?? null })
  } catch {
    return NextResponse.json({ error: 'HighLevel connection could not be saved.' }, { status: 500 })
  }
}
