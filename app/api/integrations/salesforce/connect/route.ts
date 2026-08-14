import { NextResponse, type NextRequest } from 'next/server'

import { consume } from '@/lib/auth/rate-limit'
import {
  buildSalesforceAuthorizationUrl,
  createSalesforcePkce,
  isApprovedOutlioAppOrigin,
  SALESFORCE_OAUTH_COOKIE,
  SALESFORCE_OAUTH_COOKIE_MAX_AGE,
  salesforceRedirectUri,
} from '@/lib/integrations/salesforce'
import {
  createSalesforceOAuthBrowserBinding,
  createSalesforceOAuthTransaction,
} from '@/lib/integrations/salesforce-repository'
import { ACTION_LIMITS } from '@/lib/security/action-limits'
import { recordSecurityEvent } from '@/lib/security/events'
import { createClient } from '@/lib/supabase/server'

function settingsUrl(request: NextRequest, result: string): URL {
  const url = new URL('/dashboard/settings', request.nextUrl.origin)
  url.searchParams.set('salesforce', result)
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
  if (!isSameOrigin(request)) return new Response('Forbidden', { status: 403 })

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
    const redirectUri = salesforceRedirectUri()
    const pkce = createSalesforcePkce()
    const state = await createSalesforceOAuthTransaction(user.id, redirectUri, pkce.verifier)
    const response = NextResponse.redirect(
      buildSalesforceAuthorizationUrl(state, pkce.challenge),
      303,
    )
    response.cookies.set({
      name: SALESFORCE_OAUTH_COOKIE,
      value: createSalesforceOAuthBrowserBinding({
        userId: user.id,
        state,
        returnOrigin: request.nextUrl.origin,
      }),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/integrations/salesforce/callback',
      maxAge: SALESFORCE_OAUTH_COOKIE_MAX_AGE,
      ...(process.env.NODE_ENV === 'production' ? { domain: '.outlio.io' } : {}),
    })
    await recordSecurityEvent({
      event: 'integration.oauth_started',
      userId: user.id,
      context: { provider: 'salesforce' },
    })
    return response
  } catch (error) {
    await recordSecurityEvent({
      event: 'integration.connection_failed',
      level: 'warn',
      userId: user.id,
      context: { provider: 'salesforce', reason: error instanceof Error ? error.message : 'oauth_start_failed' },
    })
    return NextResponse.redirect(settingsUrl(request, 'configuration_error'), 303)
  }
}

export const GET = connect
export const POST = connect
