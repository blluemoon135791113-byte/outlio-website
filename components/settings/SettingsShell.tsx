'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * Shared chrome for the settings section.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ONE PAGE PER SECTION, NOT SEVEN ANCHORS ON ONE PAGE.                    ║
 * ║                                                                          ║
 * ║  Settings used to be a single route with seven `#anchor` links. Three     ║
 * ║  problems came with that:                                                ║
 * ║                                                                          ║
 * ║  1. The nav had no affordance — seven real links rendered as plain body  ║
 * ║     text, so it did not read as navigation at all.                       ║
 * ║  2. Every visit ran ALL SEVEN data loads — MFA factors, subscription,    ║
 * ║     devices and three integration lookups — even to change a display     ║
 * ║     name. Each page now loads only what it shows.                        ║
 * ║  3. Nothing was linkable. "Open your billing settings" had to mean the   ║
 * ║     whole page and a scroll.                                             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

const SECTIONS = [
  { href: '/dashboard/settings', label: 'Profile' },
  { href: '/dashboard/settings/email', label: 'Email address' },
  { href: '/dashboard/settings/security', label: 'Security' },
  { href: '/dashboard/settings/team', label: 'Team' },
  { href: '/dashboard/settings/billing', label: 'Subscription and billing' },
  { href: '/dashboard/settings/integrations', label: 'Integrations' },
  { href: '/dashboard/settings/extension', label: 'Browser extension' },
  { href: '/dashboard/settings/delete', label: 'Delete account' },
] as const

export function SettingsShell({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  const pathname = usePathname()

  return (
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Settings sections" className="clay h-fit p-2 lg:sticky lg:top-24">
        {SECTIONS.map((section) => {
          /*
           * Exact match for the index, prefix for the rest — otherwise
           * `/dashboard/settings` would mark itself active on every child.
           */
          const active =
            section.href === '/dashboard/settings'
              ? pathname === section.href
              : pathname.startsWith(section.href)

          return (
            <Link
              key={section.href}
              href={section.href}
              aria-current={active ? 'page' : undefined}
              className={`flex h-10 items-center rounded-[var(--radius-md)] px-3 text-sm transition-colors duration-150 ${
                active
                  ? 'hubble-selected-option font-semibold'
                  : 'font-medium text-muted hover:text-ink'
              }`}
            >
              {section.label}
            </Link>
          )
        })}
      </nav>

      <section className="clay p-5 sm:p-6">
        <h2 className="text-lg font-semibold tracking-[-0.02em] text-ink">{title}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
        <div className="mt-6">{children}</div>
      </section>
    </div>
  )
}
