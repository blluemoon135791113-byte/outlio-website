'use client'

import Link from 'next/link'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import type { ComponentProps, ReactNode } from 'react'

import { HubbleLogo } from '@/components/brand/HubbleLogo'

type IconName =
  | 'admin'
  | 'crm'
  | 'dashboard'
  | 'email'
  | 'flows'
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
  { href: '/dashboard/extract/new', label: 'Find leads', icon: 'extract' },
  { href: '/dashboard/jobs', label: 'Lead sources', icon: 'history' },
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

/**
 * ⚠️ A SECTION, NOT A LINK. Every feature inside CRM used to live behind one
 * nav entry and a row of tabs on the page — which meant the sidebar told you
 * nothing about what the product could do, and finding Duplicates required
 * knowing it was a tab on a page you had to open first.
 *
 * Expanding here puts the whole surface in view. The parent is still a link:
 * clicking "Pipeline" should go to the pipeline, not merely toggle a menu.
 */
type NavSection = {
  href: string
  label: string
  icon: IconName
  children: { href: string; label: string }[]
}

/*
 * "CRM" is what the software is; "Pipeline" is what the customer is doing.
 * The label people scan for is the job, not the category.
 */
const CRM_SECTION: NavSection = {
  href: '/crm/contacts',
  label: 'Pipeline',
  icon: 'crm',
  children: [
    { href: '/crm/contacts', label: 'People' },
    { href: '/crm/companies', label: 'Companies' },
    { href: '/crm/pipeline', label: 'Deals' },
    { href: '/crm/tasks', label: 'Tasks' },
    { href: '/crm/lists', label: 'Lists' },
    { href: '/crm/import', label: 'Import' },
    { href: '/crm/duplicates', label: 'Duplicates' },
    { href: '/crm/reports', label: 'Reports' },
    { href: '/crm/reports/dashboards', label: 'Dashboards' },
  ],
}

const EMAIL_SECTION: NavSection = {
  href: '/email',
  label: 'Outreach',
  icon: 'email',
  children: [
    { href: '/email', label: 'Mailboxes' },
    { href: '/email/campaigns', label: 'Campaigns' },
    { href: '/email/inbox', label: 'Inbox' },
    { href: '/email/analytics', label: 'Analytics' },
  ],
}

// "Flows" is jargon until you have used one. "Automations" says what it is.
const FLOWS_SECTION: NavSection = {
  href: '/flows',
  label: 'Automations',
  icon: 'flows',
  children: [{ href: '/flows', label: 'All automations' }],
}

export function ProductNav({
  isAdmin,
  canUseScraper,
  showCrm = false,
  showEmail = false,
  showFlows = false,
  onNavigate,
}: {
  isAdmin: boolean
  canUseScraper: boolean
  /**
   * Entitlement, resolved on the server. A workspace whose plan does not
   * include CRM never sees the link — and the routes refuse it anyway, because
   * hiding a nav item is not access control (CLAUDE.md rule 8).
   */
  showCrm?: boolean
  /**
   * Same rule as `showCrm`: a workspace whose plan excludes email never sees
   * the link, and `/email` refuses it anyway — hiding a nav item is not access
   * control (CLAUDE.md rule 8).
   */
  showEmail?: boolean
  /** Same module gate again; `/flows` refuses independently. */
  showFlows?: boolean
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const base = canUseScraper ? PRODUCT_LINKS : [ACCESS_LINK]

  const sections: NavSection[] = [
    ...(showCrm ? [CRM_SECTION] : []),
    ...(showEmail ? [EMAIL_SECTION] : []),
    ...(showFlows ? [FLOWS_SECTION] : []),
  ]

  const tail = isAdmin
    ? [SETTINGS_LINK, { href: '/admin', label: 'User admin', icon: 'admin' as const }]
    : [SETTINGS_LINK]

  return (
    <nav aria-label="Product" className="space-y-0.5">
      {base.map((link) => {
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

      {sections.map((section) => (
        <NavSectionGroup
          key={section.href}
          section={section}
          pathname={pathname}
          onNavigate={onNavigate}
        />
      ))}

      {tail.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`)

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
            <ProductIcon name={link.icon} className="h-[17px] w-[17px] shrink-0" />
            <span>{link.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

/**
 * One expandable section.
 *
 * ⚠️ OPEN BECAUSE YOU ARE IN IT, NOT BECAUSE YOU CLICKED. The section holding
 * the current page expands on arrival, so landing on a deep link never leaves
 * someone looking at a collapsed menu wondering where they are. Everything
 * else stays shut, which is the point — the sidebar should be scannable.
 */
function NavSectionGroup({
  section,
  pathname,
  onNavigate,
}: {
  section: NavSection
  pathname: string
  onNavigate?: () => void
}) {
  const inSection = section.children.some(
    (child) => pathname === child.href || pathname.startsWith(`${child.href}/`),
  )
  /*
   * ⚠️ DERIVED DURING RENDER, NOT IN AN EFFECT.
   *
   * The obvious version is `useEffect(() => { if (inSection) setOpen(true) })`,
   * which ESLint rejects — a synchronous setState inside an effect schedules a
   * second render of the whole nav on every route change. React's documented
   * pattern for "reset state when a prop changes" is to adjust it during
   * render, which settles before anything paints.
   *
   * `override` is the person's own click; it is cleared whenever the route
   * moves in or out of this section, so a deliberate collapse survives until
   * navigation makes it stale rather than being undone immediately.
   */
  const [override, setOverride] = useState<boolean | null>(null)
  const [wasInSection, setWasInSection] = useState(inSection)

  if (wasInSection !== inSection) {
    setWasInSection(inSection)
    setOverride(null)
  }

  const open = override ?? inSection
  const setOpen = (next: boolean) => setOverride(next)

  return (
    <div>
      <div className="flex items-center">
        <Link
          href={section.href}
          onClick={onNavigate}
          aria-current={inSection ? 'page' : undefined}
          className={
            inSection
              ? 'group relative flex h-9 flex-1 items-center gap-3 rounded-lg bg-surface-muted px-3 text-[13px] font-semibold text-ink shadow-[var(--clay-shadow-inset)]'
              : 'group relative flex h-9 flex-1 items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-muted transition-[background-color,color,transform] duration-150 ease-out hover:bg-surface-muted hover:text-ink active:scale-[0.98]'
          }
        >
          <ProductIcon name={section.icon} className="h-[17px] w-[17px] shrink-0" />
          <span>{section.label}</span>
        </Link>

        {/*
          ⚠️ A SEPARATE CONTROL FROM THE LINK. Merging them would mean you
          cannot open the section without navigating, and cannot navigate
          without opening — one gesture doing two things is how people end up
          somewhere they did not ask to be.
        */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${section.label}`}
          className="ml-0.5 flex h-9 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink"
        >
          <svg
            viewBox="0 0 12 12"
            aria-hidden
            className={`h-3 w-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m4.5 2.5 4 3.5-4 3.5" />
          </svg>
        </button>
      </div>

      {open ? (
        <div className="mt-0.5 space-y-0.5 border-l border-line pl-3 ml-[18px]">
          {section.children.map((child) => {
            /*
             * Longest match wins, so `/crm/reports/dashboards` lights only
             * Dashboards and not Reports as well — the same bug the CRM tab
             * strip had.
             */
            const best = section.children
              .filter((c) => pathname === c.href || pathname.startsWith(`${c.href}/`))
              .sort((a, b) => b.href.length - a.href.length)[0]

            const active = best?.href === child.href

            return (
              <Link
                key={child.href}
                href={child.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'flex h-8 items-center rounded-lg px-3 text-[13px] font-semibold text-ink'
                    : 'flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-muted transition-colors duration-150 hover:text-ink'
                }
              >
                {child.label}
              </Link>
            )
          })}
        </div>
      ) : null}
    </div>
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
    flows: (
      <>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="12" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <path d="M8.5 6h3a2 2 0 0 1 2 2v2M8.5 18h3a2 2 0 0 0 2-2v-2" />
      </>
    ),
    email: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </>
    ),
    crm: (
      <>
        <rect x="3" y="4" width="5" height="16" rx="1.5" />
        <rect x="10" y="4" width="5" height="10" rx="1.5" />
        <rect x="17" y="4" width="4" height="7" rx="1.5" />
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
