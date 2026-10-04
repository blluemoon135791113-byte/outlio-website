import type { Metadata } from 'next'

import Link from 'next/link'

import { ImportContacts } from '@/components/crm/ImportContacts'
import { accountAccessIfPermitted, canSeeAccount } from '@/lib/crm/account-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'
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
export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string | string[] }>
}) {
  const ctx = await workspaceContextIfPermitted('crm.contact.view')
  // The layout renders the reason; this only stops the page computing and
  // serialising its result into the RSC payload.
  if (!ctx) return null

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

  const account = await accountFor((await searchParams).company)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">
          {account ? `Import leads into ${account.name}` : 'Import contacts'}
        </h2>
        <p className="mt-0.5 text-sm text-muted">
          {account ? (
            <>
              Rows without a company of their own are added to this account. Rows that name a
              company keep it.{' '}
              <Link href={`/crm/companies/${account.id}`} className="underline underline-offset-2 hover:text-ink">
                Back to the account
              </Link>
            </>
          ) : (
            'A CSV from another CRM, a spreadsheet, or anywhere else.'
          )}
        </p>
      </div>

      <ImportContacts account={account ?? undefined} />
    </div>
  )
}

/**
 * The account an import was opened from, if the viewer may see it. An id they
 * cannot see is simply ignored here — the page falls back to a plain import —
 * and refused again by `commitImport` if it is posted anyway.
 */
async function accountFor(raw: string | string[] | undefined): Promise<{ id: string; name: string } | null> {
  const id = Array.isArray(raw) ? raw[0] : raw
  if (!id) return null
  const access = await accountAccessIfPermitted()
  if (!access || !(await canSeeAccount(access, id))) return null
  const { data } = await createAdminClient()
    .from('crm_companies')
    .select('name')
    .eq('workspace_id', access.ctx.workspace.id)
    .eq('id', id)
    .maybeSingle()
  return { id, name: data?.name ?? 'this account' }
}
