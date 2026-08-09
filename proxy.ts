/**
 * Session refresh + AUTHENTICATION guard.
 *
 * Next.js 16 renamed the `middleware` file convention to `proxy`; the function
 * must be named `proxy` or be the default export.
 *
 * ⚠️ THIS IS NOT AN AUTHORIZATION BOUNDARY.
 *
 * This only answers "is there a signed-in user?" and refreshes the session
 * cookie. Every real access decision — role, plan, expiry, suspension, limits —
 * happens in the route via `lib/auth/access.ts`, on the server.
 *
 * Treating this as the security boundary is the classic Next.js mistake: it can
 * run at the CDN edge, is separate from render code, and does not see the
 * database. Next's own docs call it "a last resort".
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import {
  createTrialDeviceCookie,
  hashTrialDeviceCookie,
  TRIAL_DEVICE_COOKIE,
  TRIAL_DEVICE_COOKIE_MAX_AGE,
} from '@/lib/auth/trial-device'
import {
  createSessionGuard,
  readSessionGuard,
  sessionGuardExpired,
  SESSION_ABSOLUTE_SECONDS,
  SESSION_GUARD_COOKIE,
} from '@/lib/auth/session-guard'

const PROTECTED_PREFIXES = ['/dashboard', '/admin']

/**
 * The product subdomain. `app.outlio.io/` serves the dashboard.
 *
 * ⚠️ AUTH COOKIES ARE PER-HOST, DELIBERATELY.
 *
 * Supabase sets the session cookie for the host that issued it, so a session
 * created on `outlio.io` is NOT readable on `app.outlio.io`. That is the safer
 * arrangement: widening the cookie to `.outlio.io` would send session tokens to
 * the marketing site and every future subdomain along with it.
 *
 * The consequence is that users sign in ON the app subdomain. `/leadengine`
 * links to `/sign-up`, which resolves on whichever host they are already on.
 */
const APP_HOST = process.env.NEXT_PUBLIC_APP_HOST ?? 'app.outlio.io'

/** Paths the app subdomain serves. Everything else there redirects to the app. */
const APP_SUBDOMAIN_PATHS = [
  '/dashboard',
  '/admin',
  '/sign-in',
  '/sign-up',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
  '/mfa',
  '/auth',
  '/api',
]

export async function proxy(request: NextRequest) {
  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase() ?? ''
  const { pathname: rawPath } = request.nextUrl

  let trialDeviceCookie: string | null = null
  if (rawPath === '/sign-up') {
    const existing = request.cookies.get(TRIAL_DEVICE_COOKIE)?.value
    if (!hashTrialDeviceCookie(existing)) {
      try {
        trialDeviceCookie = createTrialDeviceCookie()
      } catch {
        // The server action fails closed if the secret is unavailable. Do not
        // issue an unsigned fallback that an attacker could forge.
      }
    }
  }

  const finish = (result: NextResponse): NextResponse => {
    if (!trialDeviceCookie) return result
    result.cookies.set({
      name: TRIAL_DEVICE_COOKIE,
      value: trialDeviceCookie,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: TRIAL_DEVICE_COOKIE_MAX_AGE,
      ...(host === 'outlio.io' || host.endsWith('.outlio.io')
        ? { domain: '.outlio.io' }
        : {}),
    })
    return result
  }

  if (host === APP_HOST) {
    // Bare subdomain root goes straight to the product.
    if (rawPath === '/') {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }

    // Marketing routes do not belong on the app host — send them to the
    // canonical site rather than serving duplicate content on two domains.
    const isAppPath = APP_SUBDOMAIN_PATHS.some(
      (p) => rawPath === p || rawPath.startsWith(`${p}/`),
    )
    const isAsset = rawPath.startsWith('/_next') || rawPath.includes('.')

    if (!isAppPath && !isAsset) {
      return NextResponse.redirect(new URL(rawPath, 'https://outlio.io'))
    }
  }

  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  // Without configuration we cannot refresh a session; let the route decide.
  if (!url || !key) return finish(response)

  const supabase = createServerClient(url, key, {
    cookieOptions: {
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // Refreshes the session cookie as a side effect. Must be getUser(), not
  // getSession() — getSession does not revalidate the token with the server.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )

  if (isProtected && !user) {
    const signIn = request.nextUrl.clone()
    signIn.pathname = '/sign-in'
    signIn.searchParams.set('next', pathname)
    return finish(NextResponse.redirect(signIn))
  }

  if (user) {
    const rawGuard = request.cookies.get(SESSION_GUARD_COOKIE)?.value
    const guard = readSessionGuard(rawGuard)

    if ((rawGuard && !guard) || (guard && sessionGuardExpired(guard))) {
      const signIn = request.nextUrl.clone()
      signIn.pathname = '/sign-in'
      signIn.search = ''
      signIn.searchParams.set('reason', 'session_expired')
      const expired = NextResponse.redirect(signIn)
      for (const cookie of request.cookies.getAll()) {
        if (cookie.name.startsWith('sb-')) expired.cookies.delete(cookie.name)
      }
      expired.cookies.delete(SESSION_GUARD_COOKIE)
      return finish(expired)
    }

    const refreshedGuard = createSessionGuard(
      Math.floor(Date.now() / 1000),
      guard?.issuedAt,
    )
    if (refreshedGuard) {
      response.cookies.set({
        name: SESSION_GUARD_COOKIE,
        value: refreshedGuard,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_ABSOLUTE_SECONDS,
      })
    }
  } else if (request.cookies.has(SESSION_GUARD_COOKIE)) {
    response.cookies.delete(SESSION_GUARD_COOKIE)
  }

  return finish(response)
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Keeping the matcher
     * narrow matters: this runs on every request.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon.png|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)',
  ],
}
