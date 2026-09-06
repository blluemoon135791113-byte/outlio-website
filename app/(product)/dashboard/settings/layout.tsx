import type { ReactNode } from 'react'

/**
 * Shared header for every settings page.
 *
 * The per-section nav lives in `SettingsShell` because it needs `usePathname`
 * to mark the active link; this layout stays a Server Component so it adds no
 * client JavaScript of its own.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Account</p>
        <h1 className="mt-1.5 text-[30px] font-semibold tracking-[-0.035em] text-ink">Settings</h1>
      </header>
      {children}
    </div>
  )
}
