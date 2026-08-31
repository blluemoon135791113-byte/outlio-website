import type { Metadata } from 'next'
import Link from 'next/link'

import { createAdminClient } from '@/lib/supabase/admin'
import { requireWorkspace } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Lists | Outlio',
  robots: { index: false, follow: false },
}

/**
 * Lists — M9 screens over M2 Phase 3's schema.
 *
 * ⚠️ A LIST IS AN ASSOCIATION, NEVER A COPY. `crm_list_members` points at the
 * canonical contact, so someone on four lists is still one person and a merge
 * carries their memberships across. Duplicating contacts per list is the
 * mistake the whole canonical-contact rule exists to prevent.
 */
export default async function ListsPage() {
  const ctx = await requireWorkspace()
  const policy = { role: ctx.role, modules: ctx.modules }

  if (!can(policy, 'crm.contact.view')) {
    return (
      <div className="clay p-10 text-center">
        <p className="text-sm font-medium text-ink">You do not have access to lists</p>
      </div>
    )
  }

  const db = createAdminClient()

  // Scoped by workspace in code — the service role bypasses RLS.
  const { data: lists } = await db
    .from('crm_lists')
    .select('id, name, description, created_at')
    .eq('workspace_id', ctx.workspace.id)
    .is('deleted_at', null)
    .order('name')
    .limit(100)

  const rows = lists ?? []
  const counts = new Map<string, number>()

  if (rows.length > 0) {
    // One batched membership read rather than a count per list.
    const { data: members } = await db
      .from('crm_list_members')
      .select('list_id')
      .eq('workspace_id', ctx.workspace.id)
      .in('list_id', rows.map((r) => r.id))

    for (const m of members ?? []) {
      counts.set(m.list_id, (counts.get(m.list_id) ?? 0) + 1)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">Lists</h2>
        <p className="mt-0.5 text-sm text-muted">
          Groups of contacts for campaigns and flows. A contact can be on many lists and is
          still one person.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="clay p-10 text-center">
          <p className="text-sm font-medium text-ink">No lists yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
            Lists are created when you assign contacts to one during an import or from the
            contacts screen.
          </p>
          <Link
            href="/crm/contacts"
            className="mt-3 inline-block rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90"
          >
            Go to contacts
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map((list) => (
            <li key={list.id} className="clay p-4">
              <p className="text-sm font-semibold text-ink">{list.name}</p>
              {list.description ? (
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{list.description}</p>
              ) : null}
              <p className="mt-2 text-xs text-muted">
                {counts.get(list.id) ?? 0}{' '}
                {(counts.get(list.id) ?? 0) === 1 ? 'contact' : 'contacts'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
