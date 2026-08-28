'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ComponentProps, ReactNode } from 'react'

import { HubbleLogo } from '@/components/brand/HubbleLogo'

type IconName =
  | 'admin'
  | 'dashboard'
  | 'extract'
  | 'gift'
  | 'history'
  | 'intelligence'
  | 'lock'
  | 'settings'
  | 'website'

const PRODUCT_LINKS: Array<{
  href: string
  label: string
  exact?: boolean
  icon: IconName
}> = [
  { href: '/dashboard', label: 'Overview', exact: true, icon: 'dashboard' },
  { href: '/dashboard/extract/new', label: 'New extraction', icon: 'extract' },
  { href: '/dashboard/jobs', label: 'Extractions', icon: 'history' },
  { href: '/dashboard/intelligence', label: 'Hubble Intelligence', icon: 'intelligence' },
]

const ACCESS_LINK = {
  href: '/dashboard/access',
  label: 'Access status',
  icon: 'lock' as const,
}

const SETTINGS_LINK = {
  href: '/dashboard/settings',
  label: 'Settings',
  icon: 'settings' as const,
}

export function ProductNav({
  isAdmin,
  canUseScraper,
  onNavigate,
}: {
  isAdmin: boolean
  canUseScraper: boolean
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const links = canUseScraper ? PRODUCT_LINKS : [ACCESS_LINK]
  const allLinks = isAdmin
    ? [...links, SETTINGS_LINK, { href: '/admin', label: 'User admin', icon: 'admin' as const }]
    : [...links, SETTINGS_LINK]

  return (
    <nav aria-label="Product" className="space-y-0.5">
      {allLinks.map((link) => {
        const active = 'exact' in link && link.exact
          ? pathname === link.href
          : pathname === link.href || pathname.startsWith(`${link.href}/`)

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
            className={
              active
                ? 'group relative flex h-9 items-center gap-3 rounded-lg bg-surface-muted px-3 text-[13px] font-semibold text-ink shadow-[var(--clay-shadow-inset)]'
                : 'group relative flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-muted transition-[background-color,color,transform] duration-150 ease-out hover:bg-surface-muted hover:text-ink active:scale-[0.98]'
            }
          >
            {link.icon === 'intelligence' ? (
              <HubbleLogo size="nav" />
            ) : (
              <ProductIcon name={link.icon} className="h-[17px] w-[17px] shrink-0" />
            )}
            <span>{link.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export function ProductIcon({
  name,
  ...props
}: { name: IconName } & Omit<ComponentProps<'svg'>, 'children'>) {
  const paths: Record<IconName, ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    extract: (
      <>
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </>
    ),
    intelligence: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
        <path d="M11 8v6" />
        <path d="M8 11h6" />
      </>
    ),
    history: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    lock: (
      <>
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    admin: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M19 8v6" />
        <path d="M22 11h-6" />
      </>
    ),
    gift: (
      <>
        <rect x="3" y="9" width="18" height="12" rx="2" />
        <path d="M3 13h18" />
        <path d="M12 9v12" />
        <path d="M12 9S9.5 9 8.2 7.8A2.4 2.4 0 0 1 11.6 4.4C12.8 5.6 12 9 12 9Z" />
        <path d="M12 9s2.5 0 3.8-1.2a2.4 2.4 0 0 0-3.4-3.4C11.2 5.6 12 9 12 9Z" />
      </>
    ),
    website: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a15 15 0 0 1 0 18" />
        <path d="M12 3a15 15 0 0 0 0 18" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.55V20.3h-3v-.09a1.7 1.7 0 0 0-1.03-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7 15a1.7 1.7 0 0 0-1.55-1.03H5.3v-3h.15A1.7 1.7 0 0 0 7 9.94a1.7 1.7 0 0 0-.34-1.88L6.6 8l2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.7 4.7V4.6h3v.1a1.7 1.7 0 0 0 1.03 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06L19.8 8l-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.55 1.03h.15v3h-.15A1.7 1.7 0 0 0 19.4 15Z" />
      </>
    ),
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
