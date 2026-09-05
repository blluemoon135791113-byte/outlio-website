import type { Metadata } from 'next'
import Link from 'next/link'

import { DuplicateList, type DuplicateRow } from '@/components/crm/DuplicateCenter'
import { listDuplicateCandidates, type DuplicateCenterTab } from '@/lib/crm/duplicates'
import { createAdminClient } from '@/lib/supabase/admin'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Duplicates | Outlio',
  robots: { index: false, follow: false },
}

const TABS: { value: DuplicateCenterTab; label: string }[] = [
  { value: 'exact', label: 'Exact' },
  { value: 'possible', label: 'Possible' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'ignored', label: 'Ignored' },
]

function isTab(value: string | undefined): value is DuplicateCenterTab {
  return TABS.some((t) => t.value === value)
}

/**
 * The Duplicate Center — the screens for M2 Phase 4's engine (Ledger DR14).
 *
 * ⚠️ NEVER SILENTLY MERGES. Everything here is a proposal with its reasons
 * shown; a person decides, and decides which record survives. That is the
 * brief's rule and it is the whole reason this screen exists rather than a
 * background job that quietly tidies up.
 */
export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const params = await searchParams
  const ctx = await workspaceContextIfPermitted('crm.contact.view')
  // The layout renders the reason; this only stops the page computing and
  // serialising its result into the RSC payload.
  if (!ctx) return null
  const policy = { role: ctx.role, modules: ctx.modules }

  if (!can(policy, 'crm.duplicate.resolve')) {
    return (
      <div className="clay p-10 text-center">
        <p className="text-sm font-medium text-ink">You do not have access to duplicates</p>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
          Merging rewrites who is credited for past activity, so it is a manager’s job.
        </p>
      </div>
    )
  }

  const tab: DuplicateCenterTab = isTab(params.tab) ? params.tab : 'exact'
  const candidates = await listDuplicateCandidates(ctx.workspace.id, tab)

  /*
   * Names in ONE batched lookup rather than two per row. A 50-pair page would
   * otherwise be 100 round trips — the same rule the contacts list follows.
   */
  const ids = [...new Set(candidates.flatMap((c) => [c.recordAId, c.recordBId]))]
  const names = new Map<string, string>()

  if (ids.length > 0) {
    const { data } = await createAdminClient()
      .from('crm_contacts')
      .select('id, full_name')
      .eq('workspace_id', ctx.workspace.id)
      .in('id', ids)

    for (const row of data ?? []) names.set(row.id, row.full_name ?? 'Unnamed contact')
  }

  const rows: DuplicateRow[] = candidates.map((c) => ({
    id: c.id,
    recordAId: c.recordAId,
    recordBId: c.recordBId,
    // A merged-away record still has a name worth showing on the Resolved tab.
    nameA: names.get(c.recordAId) ?? 'Removed contact',
    nameB: names.get(c.recordBId) ?? 'Removed contact',
    score: c.score,
    confidence: c.confidence,
    summary: c.summary,
    signals: c.signals,
    detectedAt: c.detectedAt,
    resolved: tab === 'resolved' || tab === 'ignored',
  }))

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">Duplicates</h2>
        <p className="mt-0.5 text-sm text-muted">
          Outlio never merges two people on its own. Each pair below is a suggestion with its
          reasons; you decide, and you choose which record is kept.
        </p>
      </div>

      <nav aria-label="Duplicate views" className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.value}
            href={`/crm/duplicates?tab=${t.value}`}
            aria-current={t.value === tab ? 'page' : undefined}
            className={
              t.value === tab
                ? '-mb-px border-b-2 border-accent px-3 py-2 text-sm font-semibold text-ink'
                : '-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted transition-colors duration-150 hover:text-ink'
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <DuplicateList rows={rows} canMerge={can(policy, 'crm.contact.merge')} tab={tab} />
    </div>
  )
}
