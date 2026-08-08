import { NextResponse, type NextRequest } from 'next/server'

import { appOrigin, safeRedirectPath } from '@/lib/auth/redirects'
import { createClient } from '@/lib/supabase/server'

/**
 * Completes email verification and password-reset links.
 *
 * Supabase redirects here with a one-time `code` which is exchanged for a
 * session. The `next` parameter is constrained to same-origin relative paths so
 * this cannot be used as an open redirect.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const origin = appOrigin(request.nextUrl.origin)
  const code = searchParams.get('code')
  const next = safeRedirectPath(searchParams.get('next'))

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in?error=missing_code`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(`${origin}/sign-in?error=invalid_code`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
