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
import { isAppHost } from '@/lib/site'

/*
 * `/join` is protected so the proxy redirects with `?next=/join/<token>`,
 * carrying the invitee back to the invitation after they sign in. Letting the
 * page redirect instead would drop the token and strand them on the dashboard.
 */
const PROTECTED_PREFIXES = ['/dashboard', '/admin', '/join', '/crm']

/**
 * ⚠️ AUTH COOKIES ARE PER-HOST, DELIBERATELY.
 *
 * Supabase sets the session cookie for the host that issued it, so a session
 * created on `outlio.io` is NOT readable on `app.outlio.io`. That is the safer
 * arrangement: widening the cookie to `.outlio.io` would send session tokens to
 * the marketing site and every future subdomain along with it.
 *
 * The consequence is that users sign in ON the app subdomain. The Lead Engine
 * surface links to `/sign-up`, which resolves on whichever host they are on.
 */

/**
 * `app.outlio.io` IS the Lead Engine product, and its supporting pages sit
 * directly beneath it. Two of those paths — `/` and `/terms` — are already
 * taken on this deployment by the agency site, which cannot be moved. The
 * proxy therefore serves them from internal-only routes.
 *
 * ⚠️ These are REWRITES, not redirects. The address bar keeps the public URL.
 * A direct request for an internal path is 308'd to the public one below, so
 * `/app-home` and `/app-terms` never appear in a link, a sitemap or a crawl.
 */
const APP_HOST_REWRITES: Record<string, string> = {
  '/': '/app-home',
  '/terms': '/app-terms',
}

/** Reverse of APP_HOST_REWRITES: internal path → the URL visitors should use. */
const INTERNAL_PATHS: Record<string, string> = Object.fromEntries(
  Object.entries(APP_HOST_REWRITES).map(([publicPath, internal]) => [internal, publicPath]),
)

/**
 * The complete surface of the software domain.
 *
 * ⚠️ ANYTHING ELSE ON THIS HOST IS A 404, NOT A REDIRECT TO outlio.io.
 *
 * Bouncing a visitor from app.outlio.io to the agency domain is exactly what a
 * card-payment reviewer must never see — the software domain has to stand on
 * its own. Keeping agency marketing off it still matters, so unknown paths are
 * refused rather than forwarded.
 */
const APP_SUBDOMAIN_PATHS = [
  '/',
  '/pricing',
  '/how-it-works',
  '/product',
  '/terms',
  '/privacy-policy',
  '/refund-policy',
  '/dashboard',
  '/admin',
  '/welcome',
  // Workspace invitation links. Omitting this would 404 every invitation on
  // the software domain, which is the only host they are ever issued for.
  '/join',
  '/crm',
  '/extension',
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
    // Preserve content negotiation without a second deprecated middleware
    // file. One Next 16 Proxy is the only supported project-level boundary.
    result.headers.set('Vary', 'Accept, Accept-Encoding')
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

  const isAsset = rawPath.startsWith('/_next') || rawPath.includes('.')

  /*
   * The internal rewrite targets are never a public address. Anyone who types
   * one — on either host — is sent to the URL it is served under, permanently,
   * so search engines and crawlers only ever record the clean path.
   */
  const publicPathForInternal = INTERNAL_PATHS[rawPath]
  if (publicPathForInternal) {
    const url = request.nextUrl.clone()
    url.pathname = publicPathForInternal
    return finish(NextResponse.redirect(url, 308))
  }

  /** Set when the app host serves a public path from an internal route. */
  let rewriteTo: URL | null = null

  if (isAppHost(host)) {
    if (rawPath === '/privacy') {
      const privacy = request.nextUrl.clone()
      privacy.pathname = '/privacy-policy'
      return finish(NextResponse.redirect(privacy, 308))
    }

    // The bare app domain IS the software storefront. It explains the product,
    // pricing and legal terms before asking anyone to sign in.
    const internal = APP_HOST_REWRITES[rawPath]
    if (internal) {
      rewriteTo = request.nextUrl.clone()
      rewriteTo.pathname = internal
    } else {
      // '/' must match exactly; as a prefix it would swallow every path.
      const isAppPath = APP_SUBDOMAIN_PATHS.some(
        (p) => rawPath === p || (p !== '/' && rawPath.startsWith(`${p}/`)),
      )

      // Agency marketing does not belong on the software domain. Refuse it
      // here rather than forwarding to outlio.io — see APP_SUBDOMAIN_PATHS.
      if (!isAppPath && !isAsset) {
        rewriteTo = request.nextUrl.clone()
        rewriteTo.pathname = '/not-found'
      }
    }
  }

  /*
   * Every response below must carry the pending rewrite. Building it in one
   * place is what keeps the session-refresh path from silently dropping it and
   * serving the agency homepage on app.outlio.io.
   */
  const baseResponse = () =>
    rewriteTo
      ? NextResponse.rewrite(rewriteTo, { request })
      : NextResponse.next({ request })

  let response = baseResponse()

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
        response = baseResponse()
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
      guard ?? undefined,
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
