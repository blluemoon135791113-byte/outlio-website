'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * CRM section navigation.
 *
 * ⚠️ ONLY SURFACES THAT EXIST ARE LISTED. The M9 route plan also names
 * /crm/contacts, /crm/companies, /crm/tasks, /crm/lists, /crm/duplicates and
 * /crm/reports; each appears here as its phase lands. A nav full of links to
 * nothing teaches people the product is broken.
 */
const SECTIONS = [{ href: '/crm/pipeline', label: 'Pipeline' }] as const

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
