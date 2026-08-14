import { NextResponse, type NextRequest } from 'next/server'

import { appOrigin } from '@/lib/auth/redirects'
import {
  classifySalesforceAuthorizationError,
  exchangeSalesforceAuthorizationCode,
  isApprovedOutlioAppOrigin,
  revokeSalesforceRefreshToken,
  SALESFORCE_OAUTH_COOKIE,
  salesforceRedirectUri,
} from '@/lib/integrations/salesforce'
import {
  consumeSalesforceOAuthTransaction,
  getSalesforceRevocationCredentials,
  readSalesforceOAuthBrowserBinding,
  saveSalesforceConnection,
} from '@/lib/integrations/salesforce-repository'
import { recordSecurityEvent } from '@/lib/security/events'
import { createClient } from '@/lib/supabase/server'

function callbackRedirect(returnOrigin: string, result: string): NextResponse {
  const url = new URL('/dashboard/settings', returnOrigin)
  url.searchParams.set('salesforce', result)
  url.hash = 'integrations'
  const response = NextResponse.redirect(url, 303)
  response.cookies.set({
    name: SALESFORCE_OAUTH_COOKIE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/integrations/salesforce/callback',
    maxAge: 0,
    ...(process.env.NODE_ENV === 'production' ? { domain: '.outlio.io' } : {}),
  })
  return response
}

function validState(value: string | null): value is string {
  return Boolean(value && value.length === 43 && /^[A-Za-z0-9_-]+$/.test(value))
}

export async function GET(request: NextRequest) {
  const binding = readSalesforceOAuthBrowserBinding(
    request.cookies.get(SALESFORCE_OAUTH_COOKIE)?.value,
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
  const transaction = await consumeSalesforceOAuthTransaction(userId, state)
  if (!transaction) {
    await recordSecurityEvent({
      event: 'integration.oauth_state_rejected',
      level: 'warn',
      userId,
      context: { provider: 'salesforce' },
    })
    return callbackRedirect(returnOrigin, 'invalid_state')
  }
  const providerError = request.nextUrl.searchParams.get('error')
  if (providerError) {
    const result = classifySalesforceAuthorizationError(
      providerError,
      request.nextUrl.searchParams.get('error_description'),
    )
    const safeProviderError = /^[A-Za-z0-9_.-]{1,64}$/.test(providerError)
      ? providerError
      : 'invalid_error_code'
    await recordSecurityEvent({
      event: 'integration.oauth_authorization_rejected',
      level: 'warn',
      userId,
      context: {
        provider: 'salesforce',
        provider_error: safeProviderError,
        classification: result,
      },
    })
    return callbackRedirect(returnOrigin, result)
  }

  const code = request.nextUrl.searchParams.get('code')
  if (!code || code.length > 4096) return callbackRedirect(returnOrigin, 'missing_code')

  try {
    if (transaction.redirect_uri !== salesforceRedirectUri()) {
      throw new Error('Salesforce callback URI no longer matches the OAuth transaction.')
    }
    const previous = await getSalesforceRevocationCredentials(userId)
    const tokens = await exchangeSalesforceAuthorizationCode(code, transaction.codeVerifier)
    await saveSalesforceConnection(userId, tokens)

    if (previous && previous.refreshToken !== tokens.refreshToken) {
      await revokeSalesforceRefreshToken(
        previous.refreshToken,
        previous.instanceUrl,
      ).catch(async () => {
        await recordSecurityEvent({
          event: 'integration.oauth_old_token_revoke_failed',
          level: 'warn',
          userId,
          context: { provider: 'salesforce' },
        })
      })
    }

    await recordSecurityEvent({
      event: 'integration.connected',
      userId,
      context: { provider: 'salesforce' },
    })
    return callbackRedirect(returnOrigin, 'connected')
  } catch {
    await recordSecurityEvent({
      event: 'integration.connection_failed',
      level: 'warn',
      userId,
      context: { provider: 'salesforce', reason: 'oauth_callback_failed' },
    })
    return callbackRedirect(returnOrigin, 'callback_failed')
  }
}
