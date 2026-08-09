import type { ReactNode } from 'react'

import { ProductShell } from '@/components/product/ProductShell'
import { requireAdmin } from '@/lib/auth/access'
import { signedAvatarUrl } from '@/lib/profile/avatar'

/**
 * Admin shell.
 *
 * `requireAdmin()` here guards the whole segment, but every page and action
 * below ALSO calls it. A layout is not an authorization boundary — Next can
 * render a route without re-running a parent layout in some navigation paths,
 * and Server Actions do not pass through layouts at all.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAdmin()
  const avatarUrl = await signedAvatarUrl(ctx.userId!, ctx.profile?.avatar_path)

  return (
    <ProductShell
      email={ctx.email ?? ''}
      fullName={ctx.profile?.full_name ?? null}
      planName={ctx.plan?.name ?? null}
      isAdmin
      canUseScraper={ctx.canUseScraper}
      avatarUrl={avatarUrl}
    >
      {children}
    </ProductShell>
  )
}
