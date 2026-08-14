import { NextResponse, type NextRequest } from 'next/server'

import { consume } from '@/lib/auth/rate-limit'
import {
  isApprovedOutlioAppOrigin,
  revokeSalesforceRefreshToken,
} from '@/lib/integrations/salesforce'
import {
  disconnectSalesforceConnection,
  getSalesforceRevocationCredentials,
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
  const origin = request.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).origin === request.nextUrl.origin && isApprovedOutlioAppOrigin(origin)
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new Response('Forbidden', { status: 403 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/sign-in', request.nextUrl.origin), 303)

  const rateLimit = await consume(ACTION_LIMITS.integration, `user:${user.id}`)
  if (!rateLimit.allowed) {
    return NextResponse.redirect(settingsUrl(request, 'rate_limited'), 303)
  }

  try {
    const credentials = await getSalesforceRevocationCredentials(user.id)
    if (credentials) {
      await revokeSalesforceRefreshToken(credentials.refreshToken, credentials.instanceUrl)
    }
    await disconnectSalesforceConnection(user.id)
    await recordSecurityEvent({
      event: 'integration.disconnected',
      userId: user.id,
      context: { provider: 'salesforce' },
    })
    return NextResponse.redirect(settingsUrl(request, 'disconnected'), 303)
  } catch {
    await recordSecurityEvent({
      event: 'integration.disconnect_failed',
      level: 'warn',
      userId: user.id,
      context: { provider: 'salesforce' },
    })
    return NextResponse.redirect(settingsUrl(request, 'disconnect_failed'), 303)
  }
}
