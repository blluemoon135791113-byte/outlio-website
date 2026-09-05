import { NextResponse, type NextRequest } from 'next/server'

import { appOrigin } from '@/lib/auth/redirects'
import { exchangeGoogleAuthorizationCode, GOOGLE_OAUTH_COOKIE, googleRedirectUri, isApprovedGoogleReturnOrigin, revokeGoogleToken } from '@/lib/integrations/google'
import { consumeGoogleOAuthTransaction, getGoogleRefreshToken, readGoogleOAuthBrowserBinding, saveGoogleConnection } from '@/lib/integrations/google-repository'
import { recordSecurityEvent } from '@/lib/security/events'
import { createClient } from '@/lib/supabase/server'

function callbackRedirect(origin: string, result: string) {
  const url = new URL('/dashboard/settings', origin)
  url.searchParams.set('google', result)
  url.hash = 'integrations'
  const response = NextResponse.redirect(url, 303)
  response.cookies.set({
    name: GOOGLE_OAUTH_COOKIE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/integrations/google/callback',
    maxAge: 0,
    ...(process.env.NODE_ENV === 'production' ? { domain: '.outlio.io' } : {}),
  })
  return response
}

export async function GET(request: NextRequest) {
  const binding = readGoogleOAuthBrowserBinding(request.cookies.get(GOOGLE_OAUTH_COOKIE)?.value)
  const fallback = appOrigin(request.nextUrl.origin)
  const returnOrigin = binding && isApprovedGoogleReturnOrigin(binding.returnOrigin) ? binding.returnOrigin : fallback
  const state = request.nextUrl.searchParams.get('state')
  if (!state || state.length !== 43 || !binding || binding.state !== state) return callbackRedirect(returnOrigin, 'invalid_state')
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (user && user.id !== binding.userId) return callbackRedirect(returnOrigin, 'invalid_state')
  const transaction = await consumeGoogleOAuthTransaction(binding.userId, state)
  if (!transaction) return callbackRedirect(returnOrigin, 'invalid_state')
  if (request.nextUrl.searchParams.has('error')) return callbackRedirect(returnOrigin, 'authorization_denied')
  const code = request.nextUrl.searchParams.get('code')
  if (!code || code.length > 4096) return callbackRedirect(returnOrigin, 'missing_code')

  try {
    if (transaction.redirect_uri !== googleRedirectUri()) throw new Error('Google callback URI changed.')
    const previous = await getGoogleRefreshToken(binding.userId)
    const tokens = await exchangeGoogleAuthorizationCode(code)
    await saveGoogleConnection(binding.userId, tokens)
    if (previous && previous !== tokens.refreshToken) await revokeGoogleToken(previous).catch(() => undefined)
    await recordSecurityEvent({ event: 'integration.connected', userId: binding.userId, context: { provider: 'google' } })
    return callbackRedirect(returnOrigin, 'connected')
  } catch (error) {
    await recordSecurityEvent({
      event: 'integration.connection_failed',
      level: 'warn',
      userId: binding.userId,
      context: { provider: 'google', reason: error instanceof Error ? error.message : 'oauth_callback_failed' },
    })
    return callbackRedirect(returnOrigin, 'callback_failed')
  }
}
