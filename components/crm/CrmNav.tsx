'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * CRM section navigation.
 *
 * ⚠️ ONLY SURFACES THAT EXIST ARE LISTED. A nav full of links to nothing
 * teaches people the product is broken. Every route the M9 plan named now
 * exists, so every one is listed.
 *
 * Ordered by how often they are used, not by when they were built: contacts
 * and pipeline are daily, duplicates is occasional housekeeping.
 */
const SECTIONS = [
  { href: '/crm/contacts', label: 'Contacts' },
  { href: '/crm/companies', label: 'Companies' },
  { href: '/crm/pipeline', label: 'Pipeline' },
  { href: '/crm/tasks', label: 'Tasks' },
  { href: '/crm/lists', label: 'Lists' },
  { href: '/crm/import', label: 'Import' },
  { href: '/crm/reports', label: 'Reports' },
  { href: '/crm/reports/dashboards', label: 'Dashboards' },
  { href: '/crm/duplicates', label: 'Duplicates' },
] as const

export function CrmNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="CRM sections" className="flex gap-1 border-b border-border">
      {SECTIONS.map((section) => {
        const active = pathname === section.href || pathname.startsWith(`${section.href}/`)

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
