import type { ReactNode } from 'react'

import { ProductShell } from '@/components/product/ProductShell'
import { requireUser } from '@/lib/auth/access'
import { signedAvatarUrl } from '@/lib/profile/avatar'

/**
 * Authenticated shell.
 *
 * Flat `--paper` background per docs/DESIGN_TOKENS.md §8 — the hero
 * aurora/gradient treatment belongs only on unauthenticated pages.
 * No entrance animations here.
 *
 * This layout guarantees a signed-in user. It does NOT guarantee access —
 * individual pages call requireAccess(), so /dashboard/access can render for
 * users who are pending, expired, or suspended.
 */
export default async function ProductLayout({ children }: { children: ReactNode }) {
  const ctx = await requireUser()
  const avatarUrl = await signedAvatarUrl(ctx.userId!, ctx.profile?.avatar_path)

  return (
    <ProductShell
      email={ctx.email ?? ''}
      fullName={ctx.profile?.full_name ?? null}
      planName={ctx.plan?.name ?? null}
      isAdmin={ctx.isAdmin}
      canUseScraper={ctx.canUseScraper}
      avatarUrl={avatarUrl}
    >
      {children}
    </ProductShell>
  )
}
