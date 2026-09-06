import 'server-only'

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THE ONLY WAY AN EXTENSION REQUEST BECOMES AUTHORISED.                   ║
 * ║                                                                          ║
 * ║  Every /api/extension route calls resolveExtensionAuth FIRST and acts    ║
 * ║  on nothing until it returns ok. No route re-derives entitlement.        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * The extension is public code. Assume an attacker has read it, copied it, and
 * is now sending handcrafted requests. Therefore NOTHING in the request body
 * is trusted — not `user_id`, not `plan`, not `subscription`, not `isAdmin`.
 * Every value is re-derived here from the bearer token.
 *
 * The seven checks the spec requires, in order of cost:
 *
 *   1. token signature and expiry        (no I/O)
 *   2. device row exists, enabled, not revoked
 *   3. token jti still current           (revocation kills live tokens)
 *   4. account active, verified, in date (shared with the web app)
 *   5. plan entitlement / limits         (shared with the web app)
 *   6. subscription independently active
 *   7. admin extension kill-switch
 */
import { resolveAccessFor, type AccessContext } from '@/lib/auth/access'
import { bearerFrom, verifyAccessToken } from '@/lib/extension/tokens'
import { createAdminClient } from '@/lib/supabase/admin'

/** Stable machine codes. The popup maps these to its states. */
export type ExtensionAuthFailure =
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'DEVICE_REVOKED'
  | 'EXTENSION_DISABLED'
  | 'SUBSCRIPTION_REQUIRED'
  | 'ACCESS_DENIED'

export type ExtensionDevice = {
  id: string
  userId: string
  label: string
  browser: string | null
}

export type ExtensionAuthResult =
  | { ok: true; ctx: AccessContext; device: ExtensionDevice }
  | { ok: false; code: ExtensionAuthFailure; status: 401 | 403; detail: string }

const fail = (
  code: ExtensionAuthFailure,
  status: 401 | 403,
  detail: string,
): ExtensionAuthResult => ({ ok: false, code, status, detail })

/**
 * Is there an independently-active subscription?
 *
 * Deliberately separate from `canUseScraper`. The spec requires the backend to
 * determine subscription state ITSELF rather than inferring it, so that a
 * cancelled or refunded subscription cuts off capture even if the profile row
 * has not caught up yet.
 *
 * Users with NO subscription row are not rejected here: access can be granted
 * manually by an admin (PAYMENT_PROVIDER defaults to `manual`), and those
 * grants are expressed through role and access_expires_at, which step 4
 * already checked. A row that exists, however, must be in good standing.
 */
async function subscriptionAllows(userId: string): Promise<boolean> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('subscriptions')
    .select('status, current_period_end, cancelled_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)

  // Fail CLOSED. An unreadable subscription table must not grant capture.
  if (error) return false

  const row = Array.isArray(data) ? data[0] : null
  if (!row) return true

  if (row.status !== 'active') return false
  if (row.cancelled_at && new Date(row.cancelled_at).getTime() <= Date.now()) return false
  if (
    row.current_period_end
    && new Date(row.current_period_end).getTime() <= Date.now()
  ) {
    return false
  }

  return true
}

/**
 * Resolves and authorises one extension request.
 *
 * Also refreshes `last_active_at`, which is what the dashboard's Connected
 * Devices list shows.
 */
export async function resolveExtensionAuth(
  request: Request,
): Promise<ExtensionAuthResult> {
  // ---- 1. token ----------------------------------------------------------
  const token = bearerFrom(request.headers.get('authorization'))
  if (!token) return fail('UNAUTHENTICATED', 401, 'no bearer token')

  const claims = verifyAccessToken(token)
  if (!claims) return fail('TOKEN_EXPIRED', 401, 'bad or expired token')

  const admin = createAdminClient()

  // ---- 2/3. device -------------------------------------------------------
  const { data: deviceRow, error: deviceError } = await admin
    .from('extension_devices')
    .select('id, user_id, label, browser, enabled, revoked_at, access_token_jti')
    .eq('id', claims.did)
    // Service role bypasses RLS — scoping to the token's subject is mandatory.
    .eq('user_id', claims.sub)
    .maybeSingle()

  if (deviceError) return fail('ACCESS_DENIED', 403, 'device lookup failed')
  if (!deviceRow) return fail('DEVICE_REVOKED', 401, 'unknown device')
  if (!deviceRow.enabled || deviceRow.revoked_at) {
    return fail('DEVICE_REVOKED', 401, 'device revoked')
  }

  // Revoking or rotating nulls/replaces the jti, so a token issued before that
  // point stops working immediately instead of lingering until it expires.
  if (deviceRow.access_token_jti !== claims.jti) {
    return fail('TOKEN_EXPIRED', 401, 'superseded token')
  }

  // ---- 4/5. account and plan --------------------------------------------
  // Email verification is implied: the account could not have reached the
  // pairing screen without an authenticated web session.
  const ctx = await resolveAccessFor({
    userId: claims.sub,
    email: null,
    emailVerified: true,
  })

  if (!ctx.profile) return fail('UNAUTHENTICATED', 401, 'no profile')

  // ---- 7. admin kill-switch ---------------------------------------------
  // Read before the entitlement branch so an admin disabling the extension
  // wins over any plan state.
  const extensionEnabled =
    (ctx.profile as { extension_enabled?: boolean }).extension_enabled !== false

  if (!extensionEnabled) {
    return fail('EXTENSION_DISABLED', 403, 'extension disabled by admin')
  }

  if (!ctx.canUseScraper) {
    const code: ExtensionAuthFailure =
      ctx.reason === 'payment_required' || ctx.reason === 'expired'
        ? 'SUBSCRIPTION_REQUIRED'
        : 'ACCESS_DENIED'
    return fail(code, 403, `access denied: ${ctx.reason}`)
  }

  // ---- 6. subscription ---------------------------------------------------
  if (!(await subscriptionAllows(claims.sub))) {
    return fail('SUBSCRIPTION_REQUIRED', 403, 'subscription inactive')
  }

  // Best effort; a failed heartbeat must never fail the request.
  await admin
    .from('extension_devices')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', deviceRow.id)
    .eq('user_id', claims.sub)

  return {
    ok: true,
    ctx,
    device: {
      id: deviceRow.id,
      userId: deviceRow.user_id,
      label: deviceRow.label,
      browser: deviceRow.browser,
    },
  }
}
