export type AdminGateContext = {
  userId: string | null
  isAdmin: boolean
  mfaCurrentLevel: string | null
  mfaNextLevel: string | null
}

/**
 * Pure admin-route decision used by the server-side access layer.
 *
 * Admin privileges are never inferred from the URL or the client. A caller
 * must have the database-backed admin role, an enrolled TOTP factor, and an
 * AAL2 session before the admin route is allowed to render.
 */
export function adminGateRedirect(ctx: AdminGateContext): string | null {
  if (!ctx.userId) return '/sign-in'
  if (!ctx.isAdmin) return '/dashboard'
  if (ctx.mfaNextLevel !== 'aal2') {
    return '/dashboard/settings?required_mfa=1#security'
  }
  if (ctx.mfaCurrentLevel !== 'aal2') return '/mfa?next=%2Fadmin'
  return null
}

export function hasAdminAssurance(ctx: AdminGateContext): boolean {
  return (
    Boolean(ctx.userId) &&
    ctx.isAdmin &&
    ctx.mfaNextLevel === 'aal2' &&
    ctx.mfaCurrentLevel === 'aal2'
  )
}
