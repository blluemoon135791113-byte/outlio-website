'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ComponentProps, ReactNode } from 'react'

type IconName =
  | 'admin'
  | 'dashboard'
  | 'extract'
  | 'history'
  | 'lock'
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
]

const ACCESS_LINK = {
  href: '/dashboard/access',
  label: 'Access status',
  icon: 'lock' as const,
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
    ? [...links, { href: '/admin', label: 'User admin', icon: 'admin' as const }]
    : links

  return (
    <nav aria-label="Product" className="space-y-1">
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
                ? 'group relative flex h-10 items-center gap-3 rounded-[var(--radius-md)] bg-accent-soft px-3 text-sm font-semibold text-accent'
                : 'group relative flex h-10 items-center gap-3 rounded-[var(--radius-md)] px-3 text-sm font-medium text-muted transition-[background-color,color,transform] duration-150 ease-out hover:bg-surface-muted hover:text-ink active:scale-[0.98]'
            }
          >
            {active ? (
              <span
                aria-hidden
                className="absolute -left-[13px] h-5 w-[3px] rounded-r-full bg-accent"
              />
            ) : null}
            <ProductIcon name={link.icon} className="h-[18px] w-[18px] shrink-0" />
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
    website: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a15 15 0 0 1 0 18" />
        <path d="M12 3a15 15 0 0 0 0 18" />
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
