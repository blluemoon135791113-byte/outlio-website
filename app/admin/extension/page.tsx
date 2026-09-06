import type { Metadata } from 'next'
import Link from 'next/link'

import { ExtensionControls } from '@/components/admin/ExtensionControls'
import { getExtensionUsage } from '@/lib/admin/extension-actions'
import { requireAdmin } from '@/lib/auth/access'
import { listDevices } from '@/lib/extension/devices'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = {
  title: 'Extension | Admin | Outlio',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

/**
 * Browser-extension administration.
 *
 * ⚠️ ITS OWN PAGE RATHER THAN A COLUMN ON `/admin`, FOR A MEASURABLE REASON.
 * That page lists up to 200 accounts, and both `getExtensionUsage` and
 * `listDevices` are several queries each. Rendering them per row is 200 × N
 * round trips to answer a question about the handful of people who actually
 * use the extension.
 *
 * ⚠️ `requireAdmin()` IS CALLED HERE, NOT INHERITED FROM THE LAYOUT. Next can
 * render a route without re-running a parent layout, and the page would then
 * serialise every account's device history into the RSC payload. See
 * `tests/unit/admin-page-guard.test.ts`, which fails if this call goes missing.
 */
export default async function AdminExtensionPage() {
  await requireAdmin()
  const db = createAdminClient()

  /*
   * ⚠️ TWO POPULATIONS, AND THE SECOND IS EASY TO FORGET. Anyone with a
   * connected browser, plus anyone whose access was DISABLED — otherwise the
   * act of disabling someone removes them from the only screen that could
   * enable them again, which is a trap rather than a control.
   */
  const [{ data: deviceRows }, { data: disabled }] = await Promise.all([
    db
      .from('extension_devices')
      .select('user_id')
      .eq('enabled', true)
      .is('revoked_at', null),
    db.from('profiles').select('id').eq('extension_enabled', false).is('deleted_at', null),
  ])

  const userIds = [
    ...new Set([
      ...(deviceRows ?? []).map((r) => r.user_id),
      ...(disabled ?? []).map((r) => r.id),
    ]),
  ]

  const { data: profiles } = userIds.length
    ? await db
        .from('profiles')
        .select('id, email, full_name, extension_enabled')
        .in('id', userIds)
        .is('deleted_at', null)
        .order('email')
    : { data: [] }

  const accounts = await Promise.all(
    (profiles ?? []).map(async (p) => ({
      id: p.id,
      email: p.email,
      fullName: p.full_name,
      // The column is nullable and null means allowed — the same reading
      // `resolveExtensionAuth` uses, so the screen agrees with the gate.
      enabled: p.extension_enabled !== false,
      usage: await getExtensionUsage(p.id),
      devices: (await listDevices(p.id)).map((d) => ({
        id: d.id,
        label: d.label,
        browser: d.browser,
        platform: d.platform,
        lastActiveAt: d.lastActiveAt,
      })),
    })),
  )

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href="/admin"
          className="text-xs font-semibold text-accent transition-opacity duration-150 hover:opacity-80"
        >
          ← Admin
        </Link>
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-[30px]">
          Browser extension
        </h1>
        <p className="text-sm text-muted">
          Accounts with a connected browser, and any whose access has been turned
          off. Disconnecting a browser takes effect immediately — the next request
          it makes is refused.
        </p>
      </header>

      {accounts.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-border bg-surface-muted/40 p-8 text-center text-sm text-muted">
          Nobody has connected a browser yet, and no account has had its access
          turned off.
        </p>
      ) : (
        <ul className="space-y-4">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="space-y-3 rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-sm)]"
            >
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">
                  {account.fullName ?? account.email ?? 'Unnamed account'}
                </h2>
                {account.fullName && account.email ? (
                  <span className="text-sm text-muted">{account.email}</span>
                ) : null}
              </div>

              <ExtensionControls
                userId={account.id}
                enabled={account.enabled}
                usage={account.usage}
                devices={account.devices}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
