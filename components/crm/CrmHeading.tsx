'use client'

import { usePathname } from 'next/navigation'

// Matches the sidebar: each top-level CRM page is named for itself.
const TITLES: Array<[string, string]> = [
  ['/crm/companies', 'Organizations'],
  ['/crm/contacts', 'People'],
  ['/crm/pipeline', 'Opportunities'],
]

export function CrmHeading() {
  const pathname = usePathname()
  const title = TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'Pipeline'
  return <h1 className="text-[30px] font-semibold tracking-[-0.035em] text-ink">{title}</h1>
}
