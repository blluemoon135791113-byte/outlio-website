import type { Metadata } from 'next'

import { ImportContacts } from '@/components/crm/ImportContacts'
import { requireWorkspace } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Import contacts | Outlio',
  robots: { index: false, follow: false },
}

/**
 * CSV import — R1.
 *
 * The engine behind this was built and tested in M2 and had no caller, so a
 * customer arriving with an existing contact list had no way into the product
 * at all. The only route in was the browser extension.
 */
export default async function ImportPage() {
  const ctx = await requireWorkspace()

  if (!can({ role: ctx.role, modules: ctx.modules }, 'crm.import')) {
    return (
      <div className="clay p-10 text-center">
        <p className="text-sm font-medium text-ink">You do not have access to imports</p>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
          Importing writes to everyone&rsquo;s CRM, so it is a manager&rsquo;s job.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">Import contacts</h2>
        <p className="mt-0.5 text-sm text-muted">
          A CSV from another CRM, a spreadsheet, or anywhere else.
        </p>
      </div>

      <ImportContacts />
    </div>
  )
}
