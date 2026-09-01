'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Email section navigation.
 *
 * ⚠️ ONLY SURFACES THAT EXIST ARE LISTED. A nav full of links to nothing
 * teaches people the product is broken — the same rule the CRM nav follows.
 */
const SECTIONS = [
  { href: '/email', label: 'Mailboxes', exact: true },
  { href: '/email/campaigns', label: 'Campaigns', exact: false },
  { href: '/email/inbox', label: 'Inbox', exact: false },
  { href: '/email/analytics', label: 'Analytics', exact: false },
] as const

export function EmailNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Email sections" className="flex gap-1 border-b border-border">
      {SECTIONS.map((section) => {
        const active = section.exact
          ? pathname === section.href
          : pathname === section.href || pathname.startsWith(`${section.href}/`)

        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'relative -mb-px border-b-2 border-accent px-3 py-2 text-sm font-semibold text-ink'
                : 'relative -mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted transition-colors duration-150 hover:text-ink'
            }
          >
            {section.label}
          </Link>
        )
      })}
    </nav>
  )
}
