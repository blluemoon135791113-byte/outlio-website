import { NextResponse, type NextRequest } from 'next/server'

import { consume } from '@/lib/auth/rate-limit'
import { ACTION_LIMITS } from '@/lib/security/action-limits'
import {
  buildHubSpotAuthorizationUrl,
  HUBSPOT_OAUTH_COOKIE,
  HUBSPOT_OAUTH_COOKIE_MAX_AGE,
  hubSpotRedirectUri,
  isApprovedOutlioAppOrigin,
} from '@/lib/integrations/hubspot'
import {
  createHubSpotOAuthBrowserBinding,
  createHubSpotOAuthTransaction,
} from '@/lib/integrations/hubspot-repository'
import { recordSecurityEvent } from '@/lib/security/events'
import { createClient } from '@/lib/supabase/server'

function settingsUrl(request: NextRequest, result: string): URL {
  const url = new URL('/dashboard/settings', request.nextUrl.origin)
  url.searchParams.set('hubspot', result)
  url.hash = 'integrations'
  return url
}

function isSameOrigin(request: NextRequest): boolean {
  const source = request.headers.get('origin') ?? request.headers.get('referer')
  if (!source) return false
  try {
    const origin = new URL(source).origin
    return origin === request.nextUrl.origin && isApprovedOutlioAppOrigin(origin)
  } catch {
    return false
  }
}

async function connect(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return new Response('Forbidden', { status: 403 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(
      new URL('/sign-in?next=/dashboard/settings%23integrations', request.nextUrl.origin),
      303,
    )
  }

  const rateLimit = await consume(ACTION_LIMITS.integration, `user:${user.id}`)
  if (!rateLimit.allowed) {
    return NextResponse.redirect(settingsUrl(request, 'rate_limited'), 303)
  }

  try {
    const redirectUri = hubSpotRedirectUri()
    const state = await createHubSpotOAuthTransaction(user.id, redirectUri)
    const authorizationUrl = buildHubSpotAuthorizationUrl(state)
    await recordSecurityEvent({
      event: 'integration.oauth_started',
      userId: user.id,
      context: { provider: 'hubspot' },
    })
    const response = NextResponse.redirect(authorizationUrl, 303)
    response.cookies.set({
      name: HUBSPOT_OAUTH_COOKIE,
      value: createHubSpotOAuthBrowserBinding({
        userId: user.id,
        state,
        returnOrigin: request.nextUrl.origin,
      }),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/integrations/hubspot/callback',
      maxAge: HUBSPOT_OAUTH_COOKIE_MAX_AGE,
      ...(process.env.NODE_ENV === 'production' ? { domain: '.outlio.io' } : {}),
    })
    return response
  } catch (error) {
    await recordSecurityEvent({
      event: 'integration.connection_failed',
      level: 'warn',
      userId: user.id,
      context: { provider: 'hubspot', reason: error instanceof Error ? error.message : 'oauth_start_failed' },
    })
    return NextResponse.redirect(settingsUrl(request, 'configuration_error'), 303)
  }
}

export const GET = connect
export const POST = connect
