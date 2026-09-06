import { NextResponse, type NextRequest } from 'next/server'

import { consume } from '@/lib/auth/rate-limit'
import { buildGoogleAuthorizationUrl, GOOGLE_OAUTH_COOKIE, GOOGLE_OAUTH_COOKIE_MAX_AGE, googleRedirectUri, isApprovedGoogleReturnOrigin } from '@/lib/integrations/google'
import { createGoogleOAuthBrowserBinding, createGoogleOAuthTransaction } from '@/lib/integrations/google-repository'
import { ACTION_LIMITS } from '@/lib/security/action-limits'
import { recordSecurityEvent } from '@/lib/security/events'
import { createClient } from '@/lib/supabase/server'

function settingsUrl(request: NextRequest, result: string) {
  const url = new URL('/dashboard/settings', request.nextUrl.origin)
  url.searchParams.set('google', result)
  url.hash = 'integrations'
  return url
}

async function connect(request: NextRequest) {
  const source = request.headers.get('origin') ?? request.headers.get('referer')
  if (!source) return new Response('Forbidden', { status: 403 })
  let origin: string
  try {
    origin = new URL(source).origin
  } catch {
    return new Response('Forbidden', { status: 403 })
  }
  if (origin !== request.nextUrl.origin || !isApprovedGoogleReturnOrigin(origin)) return new Response('Forbidden', { status: 403 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/sign-in?next=/dashboard/settings%23integrations', request.nextUrl.origin), 303)
  const limit = await consume(ACTION_LIMITS.integration, `user:${user.id}`)
  if (!limit.allowed) return NextResponse.redirect(settingsUrl(request, 'rate_limited'), 303)

  try {
    const redirectUri = googleRedirectUri()
    const state = await createGoogleOAuthTransaction(user.id, redirectUri)
    const response = NextResponse.redirect(buildGoogleAuthorizationUrl(state), 303)
    response.cookies.set({
      name: GOOGLE_OAUTH_COOKIE,
      value: createGoogleOAuthBrowserBinding({ userId: user.id, state, returnOrigin: new URL(origin).origin }),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/integrations/google/callback',
      maxAge: GOOGLE_OAUTH_COOKIE_MAX_AGE,
      ...(process.env.NODE_ENV === 'production' ? { domain: '.outlio.io' } : {}),
    })
    await recordSecurityEvent({ event: 'integration.oauth_started', userId: user.id, context: { provider: 'google' } })
    return response
  } catch (error) {
    await recordSecurityEvent({
      event: 'integration.connection_failed',
      level: 'warn',
      userId: user.id,
      context: { provider: 'google', reason: error instanceof Error ? error.message : 'oauth_start_failed' },
    })
    return NextResponse.redirect(settingsUrl(request, 'configuration_error'), 303)
  }
}

export const GET = connect
export const POST = connect
