'use client'

import { usePathname } from 'next/navigation'

/**
 * The CRM layout's page heading. The section is "Pipeline" in the sidebar,
 * but the Accounts pages are named for what they are — the header above and
 * the nav item both say "Accounts", and a heading saying "Pipeline" over the
 * Accounts list was a third name for one screen.
 */
export function CrmHeading() {
  const pathname = usePathname()
  const title = pathname.startsWith('/crm/companies') ? 'Accounts' : 'Pipeline'
  return <h1 className="text-[30px] font-semibold tracking-[-0.035em] text-ink">{title}</h1>
}
