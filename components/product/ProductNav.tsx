'use client'

import Link from 'next/link'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import type { ComponentProps, ReactNode } from 'react'

type IconName =
  | 'admin'
  | 'board'
  | 'crm'
  | 'dashboard'
  | 'email'
  | 'flows'
  | 'extract'
  | 'gift'
  | 'history'
  | 'intelligence'
  | 'lock'
  | 'organization'
  | 'people'
  | 'settings'
  | 'website'

type NavLink = { href: string; label: string; exact?: boolean; icon: IconName }

/*
 * Revised 2026-10-15 (owner): one "Find leads" screen uploads AND tracks runs —
 * the old "Lead sources" page is now its lower half. "Hubble Intelligence" is
 * "Leads": the people you extracted, enriched automatically.
 */
const PRODUCT_LINKS: NavLink[] = [
  { href: '/dashboard', label: 'Overview', exact: true, icon: 'dashboard' },
  { href: '/dashboard/jobs', label: 'Find leads', icon: 'extract' },
  { href: '/dashboard/intelligence', label: 'Leads', icon: 'intelligence' },
]

/*
 * The CRM records people work with every day, promoted out of the Pipeline
 * section so each is one click away. Routes are unchanged so existing links
 * keep working.
 */
const CRM_LINKS: NavLink[] = [
  { href: '/crm/companies', label: 'Organizations', icon: 'organization' },
  { href: '/crm/contacts', label: 'People', icon: 'people' },
  { href: '/crm/pipeline', label: 'Opportunities', icon: 'board' },
]

const ACCESS_LINK: NavLink = {
  href: '/dashboard/access',
  label: 'Access status',
  icon: 'lock',
}

const SETTINGS_LINK: NavLink = {
  href: '/dashboard/settings',
  label: 'Settings',
  icon: 'settings',
}

/**
 * A SECTION, NOT A LINK: the parent navigates, the chevron expands.
 */
type NavSection = {
  href: string
  label: string
  icon: IconName
  children: { href: string; label: string }[]
}

// People, Organizations and Opportunities moved to the top level (above).
const CRM_SECTION: NavSection = {
  href: '/crm/my-work',
  label: 'Pipeline',
  icon: 'crm',
  children: [
    { href: '/crm/my-work', label: 'My Work' },
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
  label: 'Email',
  icon: 'email',
  children: [
    { href: '/email', label: 'Mailboxes' },
    { href: '/email/campaigns', label: 'Campaigns' },
    { href: '/email/inbox', label: 'Inbox' },
    { href: '/email/analytics', label: 'Analytics' },
  ],
}

const FLOWS_SECTION: NavSection = {
  href: '/flows',
  label: 'Automations',
  icon: 'flows',
  children: [{ href: '/flows', label: 'All automations' }],
}

const LINK_CLASS = {
  active:
    'group relative flex h-9 items-center gap-3 rounded-lg bg-surface-muted px-3 text-[13px] font-semibold text-ink shadow-[var(--clay-shadow-inset)]',
  idle:
    'group relative flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-muted transition-[background-color,color,transform] duration-150 ease-out hover:bg-surface-muted hover:text-ink active:scale-[0.98]',
}

function isActive(pathname: string, link: NavLink) {
  return link.exact
    ? pathname === link.href
    : pathname === link.href || pathname.startsWith(`${link.href}/`)
}

function NavItem({
  link,
  pathname,
  onNavigate,
}: {
  link: NavLink
  pathname: string
  onNavigate?: () => void
}) {
  const active = isActive(pathname, link)
  return (
    <Link
      href={link.href}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={active ? LINK_CLASS.active : LINK_CLASS.idle}
    >
      <ProductIcon name={link.icon} className="h-[17px] w-[17px] shrink-0" />
      <span>{link.label}</span>
    </Link>
  )
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
   * Module entitlements, resolved on the server. Hiding a link is not access
   * control — each route refuses independently (CLAUDE.md rule 8).
   */
  showCrm?: boolean
  showEmail?: boolean
  showFlows?: boolean
  onNavigate?: () => void
}) {
  const pathname = usePathname()

  const links: NavLink[] = [
    ...(canUseScraper ? PRODUCT_LINKS : [ACCESS_LINK]),
    ...(showCrm ? CRM_LINKS : []),
  ]

  const sections: NavSection[] = [
    ...(showCrm ? [CRM_SECTION] : []),
    ...(showEmail ? [EMAIL_SECTION] : []),
    ...(showFlows ? [FLOWS_SECTION] : []),
  ]

  const tail: NavLink[] = isAdmin
    ? [SETTINGS_LINK, { href: '/admin', label: 'User admin', icon: 'admin' }]
    : [SETTINGS_LINK]

  return (
    <nav aria-label="Product" className="space-y-0.5">
      {links.map((link) => (
        <NavItem key={link.href} link={link} pathname={pathname} onNavigate={onNavigate} />
      ))}

      {sections.map((section) => (
        <NavSectionGroup
          key={section.href}
          section={section}
          pathname={pathname}
          onNavigate={onNavigate}
        />
      ))}

      {tail.map((link) => (
        <NavItem key={link.href} link={link} pathname={pathname} onNavigate={onNavigate} />
      ))}
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
          className={`${inSection ? LINK_CLASS.active : LINK_CLASS.idle} flex-1`}
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
    organization: (
      <>
        <rect x="4" y="3" width="11" height="18" rx="1.5" />
        <path d="M15 9h4a1 1 0 0 1 1 1v11h-5" />
        <path d="M8 7h3M8 11h3M8 15h3" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M3 20a6 6 0 0 1 12 0" />
        <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
        <path d="M18 14.5a6 6 0 0 1 3 5.5" />
      </>
    ),
    board: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16M15 4v16" />
        <path d="M5.5 8h1.5M11.5 8h1.5M17.5 8h1.5M11.5 11h1.5" />
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
