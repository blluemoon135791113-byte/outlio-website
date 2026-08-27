import 'server-only'

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THE SINGLE SOURCE OF ACCESS TRUTH.                                      ║
 * ║                                                                          ║
 * ║  Every protected page, Server Action, and Route Handler calls one of      ║
 * ║  getAccessContext / requireAccess / requireAdmin.                        ║
 * ║                                                                          ║
 * ║  No route re-derives access logic. No client component decides access.   ║
 * ║  A grep for role comparisons outside this file is a bug.                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { redirect } from 'next/navigation'
import { cache } from 'react'

import {
  NEEDS_LIMITS,
  decideLimits,
  precheckAccess,
  type AccessReason,
} from '@/lib/auth/decide'
import { adminGateRedirect, hasAdminAssurance } from '@/lib/auth/admin-gate'
import { AppError } from '@/lib/errors/catalog'
import { getPlanById, type Plan } from '@/lib/limits/plans'
import { getUsageSnapshot, type UsageSnapshot } from '@/lib/limits/usage'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { ProfileRow, UserRole } from '@/types/database'

export type { AccessReason } from '@/lib/auth/decide'

export type AccessContext = {
  userId: string | null
  email: string | null
  role: UserRole | null
  canUseScraper: boolean
  reason: AccessReason
  isAdmin: boolean
  plan: Plan | null
  usage: UsageSnapshot | null
  accessExpiresAt: string | null
  profile: ProfileRow | null
  mfaCurrentLevel: string | null
  mfaNextLevel: string | null
}

const UNAUTHENTICATED: AccessContext = {
  userId: null,
  email: null,
  role: null,
  canUseScraper: false,
  reason: 'unauthenticated',
  isAdmin: false,
  plan: null,
  usage: null,
  accessExpiresAt: null,
  profile: null,
  mfaCurrentLevel: null,
  mfaNextLevel: null,
}

/**
 * Resolve the caller's full access context.
 *
 * Never throws for an ordinary "no access" outcome — it returns a context with
 * `canUseScraper: false` and a specific `reason`. Callers that need to block
 * should use `requireAccess` / `requireAdmin`.
 */
export const getAccessContext = cache(async function getAccessContext(): Promise<AccessContext> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return UNAUTHENTICATED

  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

  return resolveAccessFor({
    userId: user.id,
    email: user.email ?? null,
    emailVerified: Boolean(user.email_confirmed_at),
    mfaCurrentLevel: assurance?.currentLevel ?? null,
    mfaNextLevel: assurance?.nextLevel ?? null,
  })
})

/**
 * The identity-agnostic half of the access decision.
 *
 * Split out so a caller that authenticated by something OTHER than a session
 * cookie — currently the browser extension's bearer token — reaches the exact
 * same verdict through the exact same code. Duplicating this logic for a
 * second transport is how the two drift apart and one of them gets it wrong.
 *
 * ⚠️ `userId` must come from a VERIFIED credential. Never from a request body.
 */
export async function resolveAccessFor(identity: {
  userId: string
  email: string | null
  emailVerified: boolean
  mfaCurrentLevel?: string | null
  mfaNextLevel?: string | null
}): Promise<AccessContext> {
  const { userId, email, emailVerified } = identity
  const mfaCurrentLevel = identity.mfaCurrentLevel ?? null
  const mfaNextLevel = identity.mfaNextLevel ?? null

  // Service role: RLS is bypassed, so scoping by id here is mandatory.
  const admin = createAdminClient()
  const { data: profileRow, error } = await admin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw new Error(`getAccessContext: profile lookup failed: ${error.message}`)
  }

  const profile = (profileRow as ProfileRow | null) ?? null

  if (!profile || profile.deleted_at) {
    return {
      ...UNAUTHENTICATED,
      userId,
      email,
      mfaCurrentLevel,
      mfaNextLevel,
    }
  }

  const isAdmin = profile.role === 'admin'

  const base = (
    plan: Plan | null,
    usage: UsageSnapshot | null,
  ): Omit<AccessContext, 'canUseScraper' | 'reason'> => ({
    userId,
    email,
    role: profile.role,
    isAdmin,
    plan,
    usage,
    accessExpiresAt: profile.access_expires_at,
    profile,
    mfaCurrentLevel,
    mfaNextLevel,
  })

  // The decision itself lives in lib/auth/decide.ts as a pure function, so
  // every branch is unit-tested without a request context. This function only
  // gathers the inputs.
  //
  // Pre-checks run FIRST and need no plan or usage. That saves two round trips
  // for users who are going to be denied anyway, and — more importantly — means
  // an outage in the usage tables cannot take down sign-in or verify-email.
  const pre = precheckAccess({ profile, emailVerified })
  if (pre !== NEEDS_LIMITS) {
    return { ...base(null, null), ...pre }
  }

  const plan = profile.plan_id ? await getPlanById(profile.plan_id) : null
  const usage = await getUsageSnapshot(userId)

  return { ...base(plan, usage), ...decideLimits(plan?.limits ?? null, usage) }
}

/** Maps a denial reason onto the catalog error a route should return. */
export function reasonToError(reason: AccessReason): AppError {
  switch (reason) {
    case 'unauthenticated':
      return new AppError('ERR_UNAUTHENTICATED')
    case 'email_unverified':
      return new AppError('ERR_EMAIL_UNVERIFIED')
    case 'pending':
      return new AppError('ERR_ACCESS_PENDING')
    case 'rejected':
      return new AppError('ERR_ACCESS_REJECTED')
    case 'expired':
      return new AppError('ERR_ACCESS_EXPIRED')
    case 'suspended':
      return new AppError('ERR_ACCOUNT_SUSPENDED')
    case 'limit_reached':
      return new AppError('ERR_LIMIT_REACHED')
    case 'payment_required':
      return new AppError('ERR_PAYMENT_REQUIRED')
    case 'no_request':
      return new AppError('ERR_NO_ACCESS')
    case 'ok':
      return new AppError('ERR_INTERNAL', 'reasonToError called with reason=ok')
  }
}

/**
 * For Server Components and pages. Redirects rather than throwing, so the user
 * lands somewhere useful instead of on an error boundary.
 */
export async function requireAccess(): Promise<AccessContext> {
  const ctx = await getAccessContext()
  if (ctx.userId && ctx.mfaNextLevel === 'aal2' && ctx.mfaCurrentLevel !== 'aal2') {
    redirect('/mfa?next=/dashboard')
  }
  if (ctx.canUseScraper) return ctx

  if (ctx.reason === 'unauthenticated') redirect('/sign-in')
  if (ctx.reason === 'email_unverified') redirect('/verify-email')
  redirect(`/dashboard/access?reason=${ctx.reason}`)
}

/**
 * For Server Components and pages that require an authenticated user but not
 * necessarily extraction access (e.g. the access-request page itself).
 */
export async function requireUser(): Promise<AccessContext> {
  const ctx = await getAccessContext()
  if (!ctx.userId) redirect('/sign-in')
  if (ctx.mfaNextLevel === 'aal2' && ctx.mfaCurrentLevel !== 'aal2') {
    redirect('/mfa?next=/dashboard')
  }
  return ctx
}

async function hasHubbleEntitlement(ctx: AccessContext): Promise<boolean> {
  if (ctx.isAdmin || ctx.plan?.key === 'custom') return true
  if (!ctx.userId) return false

  // A Pro + Hubble trial intentionally uses the generic 10-credit trial plan,
  // so the originating Paddle tier remains the source for feature access.
  const { data, error } = await createAdminClient()
    .from('paddle_subscriptions')
    .select('subscription_id')
    .eq('user_id', ctx.userId)
    .eq('plan_key', 'custom')
    .in('status', ['active', 'trialing'])
    .limit(1)

  if (error) throw new Error(`Hubble entitlement lookup failed: ${error.message}`)
  return Boolean(data?.length)
}

/** Page guard for the Pro + Hubble feature boundary. */
export async function requireHubbleAccess(): Promise<AccessContext> {
  const ctx = await requireAccess()
  if (await hasHubbleEntitlement(ctx)) return ctx
  redirect('/leadengine/pricing?upgrade=hubble')
}

/** For admin pages. Admin status comes from `profiles.role`, never a claim. */
export async function requireAdmin(): Promise<AccessContext> {
  const ctx = await getAccessContext()
  const destination = adminGateRedirect(ctx)
  if (destination) redirect(destination)
  return ctx
}

/**
 * For Route Handlers and Server Actions, where redirecting is wrong.
 * Throws a typed AppError the caller converts with `toClientError`.
 */
export async function assertAccess(): Promise<AccessContext> {
  const ctx = await getAccessContext()
  if (ctx.mfaNextLevel === 'aal2' && ctx.mfaCurrentLevel !== 'aal2') {
    throw new AppError('ERR_FORBIDDEN', 'Action requires an AAL2 session')
  }
  if (!ctx.canUseScraper) throw reasonToError(ctx.reason)
  return ctx
}

export async function assertUser(): Promise<AccessContext> {
  const ctx = await getAccessContext()
  if (!ctx.userId) throw new AppError('ERR_UNAUTHENTICATED')
  if (ctx.mfaNextLevel === 'aal2' && ctx.mfaCurrentLevel !== 'aal2') {
    throw new AppError('ERR_FORBIDDEN', 'Action requires an AAL2 session')
  }
  return ctx
}

/** Route/action guard for the Pro + Hubble feature boundary. */
export async function assertHubbleAccess(): Promise<AccessContext> {
  const ctx = await assertAccess()
  if (await hasHubbleEntitlement(ctx)) return ctx
  throw new AppError('ERR_FORBIDDEN', 'Hubble is available on the Pro + Hubble plan')
}

export async function assertAdmin(): Promise<AccessContext> {
  const ctx = await getAccessContext()
  if (!ctx.userId) throw new AppError('ERR_UNAUTHENTICATED')
  if (!ctx.isAdmin) throw new AppError('ERR_FORBIDDEN')
  if (!hasAdminAssurance(ctx)) {
    throw new AppError('ERR_FORBIDDEN', 'Admin action requires an AAL2 session')
  }
  return ctx
}
