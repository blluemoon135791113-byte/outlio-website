import type { Metadata } from 'next'

import { ConnectPanel } from '@/components/extension/ConnectPanel'
import { assertUser } from '@/lib/auth/access'
import { decideLimits } from '@/lib/auth/decide'

export const metadata: Metadata = {
  title: 'Connect the browser extension | Outlio',
  robots: { index: false, follow: false },
}

/**
 * The pairing consent screen.
 *
 * The extension opens this with a `state` it generated. Requiring a signed-in
 * session here is what makes the whole flow safe: the extension never sees a
 * password, and a code can only be issued by someone already authenticated in
 * the browser they are pairing.
 *
 * `assertUser` rather than `assertAccess`, so a user without an active plan
 * still reaches a page that explains why, instead of a redirect that looks
 * like the extension is broken.
 */
export default async function ExtensionConnectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await assertUser()
  const params = await searchParams

  const first = (v: string | string[] | undefined): string | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

  const state = first(params.state)
  const browser = first(params.browser)
  const platform = first(params.platform)

  const eligible = decideLimits(ctx.plan?.limits ?? null, ctx.usage).canUseScraper
    && ctx.canUseScraper

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
        Browser extension
      </p>
      <h1 className="mt-3 text-2xl font-semibold tracking-[-0.015em] text-ink">
        Connect this browser
      </h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        Linking lets the extension send pages you capture straight into your dashboard.
      </p>

      <ConnectPanel
        state={state}
        browser={browser}
        platform={platform}
        email={ctx.email ?? ctx.profile?.email ?? null}
        planName={ctx.plan?.name ?? null}
        eligible={eligible}
      />
    </div>
  )
}
