import { NextResponse, type NextRequest } from 'next/server'

import { appOrigin } from '@/lib/auth/redirects'
import {
  exchangeHubSpotAuthorizationCode,
  HUBSPOT_OAUTH_COOKIE,
  hubSpotRedirectUri,
  isApprovedOutlioAppOrigin,
  revokeHubSpotRefreshToken,
} from '@/lib/integrations/hubspot'
import {
  consumeHubSpotOAuthTransaction,
  getHubSpotRefreshToken,
  readHubSpotOAuthBrowserBinding,
  saveHubSpotConnection,
} from '@/lib/integrations/hubspot-repository'
import { recordSecurityEvent } from '@/lib/security/events'
import { createClient } from '@/lib/supabase/server'

function settingsUrl(returnOrigin: string, result: string): URL {
  const url = new URL('/dashboard/settings', returnOrigin)
  url.searchParams.set('hubspot', result)
  url.hash = 'integrations'
  return url
}

function callbackRedirect(returnOrigin: string, result: string): NextResponse {
  const response = NextResponse.redirect(settingsUrl(returnOrigin, result), 303)
  response.cookies.set({
    name: HUBSPOT_OAUTH_COOKIE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/integrations/hubspot/callback',
    maxAge: 0,
    ...(process.env.NODE_ENV === 'production' ? { domain: '.outlio.io' } : {}),
  })
  return response
}

function validState(value: string | null): value is string {
  return Boolean(value && value.length === 43 && /^[A-Za-z0-9_-]+$/.test(value))
}

export async function GET(request: NextRequest) {
  const binding = readHubSpotOAuthBrowserBinding(
    request.cookies.get(HUBSPOT_OAUTH_COOKIE)?.value,
  )
  const fallbackOrigin = appOrigin(request.nextUrl.origin)
  const returnOrigin = binding && isApprovedOutlioAppOrigin(binding.returnOrigin)
    ? binding.returnOrigin
    : fallbackOrigin

  const state = request.nextUrl.searchParams.get('state')
  if (!validState(state) || !binding || binding.state !== state) {
    return callbackRedirect(returnOrigin, 'invalid_state')
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user && user.id !== binding.userId) {
    return callbackRedirect(returnOrigin, 'invalid_state')
  }

  const userId = binding.userId
  const transaction = await consumeHubSpotOAuthTransaction(userId, state)
  if (!transaction) {
    await recordSecurityEvent({
      event: 'integration.oauth_state_rejected',
      level: 'warn',
      userId,
      context: { provider: 'hubspot' },
    })
    return callbackRedirect(returnOrigin, 'invalid_state')
  }

  if (request.nextUrl.searchParams.has('error')) {
    return callbackRedirect(returnOrigin, 'authorization_denied')
  }

  const code = request.nextUrl.searchParams.get('code')
  if (!code || code.length > 4096) {
    return callbackRedirect(returnOrigin, 'missing_code')
  }

  try {
    if (transaction.redirect_uri !== hubSpotRedirectUri()) {
      throw new Error('HubSpot callback URI no longer matches the OAuth transaction.')
    }

    const previousRefreshToken = await getHubSpotRefreshToken(userId)
    const tokens = await exchangeHubSpotAuthorizationCode(code)
    await saveHubSpotConnection(userId, tokens)

    if (previousRefreshToken && previousRefreshToken !== tokens.refreshToken) {
      await revokeHubSpotRefreshToken(previousRefreshToken).catch(async () => {
        await recordSecurityEvent({
          event: 'integration.oauth_old_token_revoke_failed',
          level: 'warn',
          userId,
          context: { provider: 'hubspot' },
        })
      })
    }

    await recordSecurityEvent({
      event: 'integration.connected',
      userId,
      context: { provider: 'hubspot' },
    })
    return callbackRedirect(returnOrigin, 'connected')
  } catch {
    await recordSecurityEvent({
      event: 'integration.connection_failed',
      level: 'warn',
      userId,
      context: { provider: 'hubspot', reason: 'oauth_callback_failed' },
    })
    return callbackRedirect(returnOrigin, 'callback_failed')
  }
}
