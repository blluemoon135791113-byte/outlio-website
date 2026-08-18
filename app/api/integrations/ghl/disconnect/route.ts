import { NextResponse, type NextRequest } from 'next/server'

import { consume } from '@/lib/auth/rate-limit'
import { disconnectGhlConnection } from '@/lib/integrations/ghl-repository'
import { isApprovedOutlioAppOrigin } from '@/lib/integrations/origin'
import { ACTION_LIMITS } from '@/lib/security/action-limits'
import { recordSecurityEvent } from '@/lib/security/events'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (!origin || !isApprovedOutlioAppOrigin(origin)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const limit = await consume(ACTION_LIMITS.integration, `user:${user.id}`)
  if (!limit.allowed) return NextResponse.json({ error: 'Too many requests. Please wait and try again.' }, { status: 429 })
  await disconnectGhlConnection(user.id)
  await recordSecurityEvent({ event: 'integration.disconnected', userId: user.id, context: { provider: 'ghl' } })
  return NextResponse.json({ ok: true, status: 'disconnected' })
}
