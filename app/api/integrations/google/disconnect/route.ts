import { NextResponse, type NextRequest } from 'next/server'

import { consume } from '@/lib/auth/rate-limit'
import { isApprovedGoogleReturnOrigin, revokeGoogleToken } from '@/lib/integrations/google'
import { disconnectGoogleConnection, getGoogleRefreshToken } from '@/lib/integrations/google-repository'
import { ACTION_LIMITS } from '@/lib/security/action-limits'
import { recordSecurityEvent } from '@/lib/security/events'
import { createClient } from '@/lib/supabase/server'

function settingsUrl(request: NextRequest, result: string) {
  const url = new URL('/dashboard/settings', request.nextUrl.origin)
  url.searchParams.set('google', result)
  url.hash = 'integrations'
  return url
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (!origin || !isApprovedGoogleReturnOrigin(origin)) return new Response('Forbidden', { status: 403 })
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/sign-in', request.nextUrl.origin), 303)
  const limit = await consume(ACTION_LIMITS.integration, `user:${user.id}`)
  if (!limit.allowed) return NextResponse.redirect(settingsUrl(request, 'rate_limited'), 303)
  try {
    const token = await getGoogleRefreshToken(user.id)
    if (token) await revokeGoogleToken(token)
    await disconnectGoogleConnection(user.id)
    await recordSecurityEvent({ event: 'integration.disconnected', userId: user.id, context: { provider: 'google' } })
    return NextResponse.redirect(settingsUrl(request, 'disconnected'), 303)
  } catch {
    return NextResponse.redirect(settingsUrl(request, 'disconnect_failed'), 303)
  }
}
