import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { consume } from '@/lib/auth/rate-limit'
import { testGhlCredentials, validateGhlCredentials } from '@/lib/integrations/ghl'
import { getGhlCredentials, updateGhlConnectionTest } from '@/lib/integrations/ghl-repository'
import { isApprovedOutlioAppOrigin } from '@/lib/integrations/origin'
import { ACTION_LIMITS } from '@/lib/security/action-limits'
import { createClient } from '@/lib/supabase/server'

const inputSchema = z.object({ token: z.string().max(4096).optional(), locationId: z.string().max(128).optional() })

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (!origin || !isApprovedOutlioAppOrigin(origin)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const limit = await consume(ACTION_LIMITS.integration, `user:${user.id}`)
  if (!limit.allowed) return NextResponse.json({ error: 'Too many requests. Please wait and try again.' }, { status: 429 })
  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid connection details.' }, { status: 400 })
  const submitted = parsed.data.token && parsed.data.locationId ? validateGhlCredentials({ token: parsed.data.token, locationId: parsed.data.locationId }) : null
  const stored = submitted ? null : await getGhlCredentials(user.id)
  const credentials = submitted ?? stored?.credentials
  if (!credentials) return NextResponse.json({ error: 'Enter a valid token and Location ID.' }, { status: 400 })
  const result = await testGhlCredentials(credentials)
  if (stored) await updateGhlConnectionTest(user.id, result)
  return result.ok
    ? NextResponse.json({ ok: true, accountName: result.accountName ?? null })
    : NextResponse.json({ ok: false, error: result.message }, { status: result.reconnectRequired ? 401 : 400 })
}
