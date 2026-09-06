import type { Metadata } from 'next'
import Link from 'next/link'

import { CreateFlow } from '@/components/flows/CreateFlow'
import { createAdminClient } from '@/lib/supabase/admin'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Flows | Outlio',
  robots: { index: false, follow: false },
}

/**
 * ⚠️ `flow.view` IS MANAGER-ONLY, AND THIS PAGE DID NOT ASK. It called
 * `requireWorkspace()` and used `flow.manage` purely to decide which controls
 * rendered — so a `setter` loaded it and read every flow's name, description,
 * status and run counts. A flow name describes what a company is doing to whom;
 * the policy table already says that is not a setter's business.
 *
 * Measured on staging, alongside the same shape on the developer settings page.
 * `flow.view` and `flow.manage` are both `manager`, so gating on `flow.view`
 * changes nothing for anyone who could already act here.
 */
export default async function FlowsPage() {
  const ctx = await workspaceContextIfPermitted('flow.view')
  // The layout renders the reason; this only stops the page computing.
  if (!ctx) return null
  const canManage = can({ role: ctx.role, modules: ctx.modules }, 'flow.manage')
  const db = createAdminClient()

  const { data: flows } = await db
    .from('flows')
    .select('id, name, description, status, published_version_id, created_at')
    .eq('workspace_id', ctx.workspace.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  // Run counts, so a flow that has never fired is visible as such.
  const runCounts = new Map<string, { total: number; halted: number }>()
  for (const flow of flows ?? []) {
    const [{ count: total }, { count: halted }] = await Promise.all([
      db.from('flow_runs').select('id', { count: 'exact', head: true }).eq('flow_id', flow.id),
      db.from('flow_runs').select('id', { count: 'exact', head: true })
        .eq('flow_id', flow.id).eq('status', 'halted'),
    ])
    runCounts.set(flow.id, { total: total ?? 0, halted: halted ?? 0 })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">Flows</h2>
          <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-muted">
            Automation shared by the CRM and email. Every step is free except AI steps, which are
            badged and priced before you publish.
          </p>
        </div>
        {canManage ? <CreateFlow /> : null}
      </div>

      {(flows ?? []).length === 0 ? (
        <div className="clay p-8 text-center">
          <h3 className="text-sm font-semibold text-ink">No flows yet</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
            A flow reacts to something happening — a contact created, a reply arriving, a deal
            won — and then assigns, tasks, tags or emails. Nothing runs until you publish it.
          </p>
        </div>
      ) : (
        <div className="clay overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted">
                <th scope="col" className="px-4 py-3 font-semibold">Flow</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                <th scope="col" className="px-4 py-3 font-semibold">Runs</th>
              </tr>
            </thead>
            <tbody>
              {(flows ?? []).map((flow) => {
                const counts = runCounts.get(flow.id) ?? { total: 0, halted: 0 }
                return (
                  <tr key={flow.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/flows/${flow.id}`}
                        className="font-semibold text-ink underline-offset-2 hover:underline"
                      >
                        {flow.name}
                      </Link>
                      {flow.description ? (
                        <span className="block text-xs text-muted">{flow.description}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill
                        status={flow.status}
                        neverPublished={!flow.published_version_id}
                      />
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {counts.total}
                      {/*
                        ⚠️ HALTED RUNS ARE SURFACED IN THE LIST. A flow quietly
                        halting on loop protection is exactly the thing nobody
                        notices until they ask why automation stopped.
                      */}
                      {counts.halted > 0 ? (
                        <span className="ml-2 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                          {counts.halted} halted
                        </span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatusPill({ status, neverPublished }: { status: string; neverPublished: boolean }) {
  // "Draft" is accurate but incomplete: a never-published flow triggers
  // nothing at all, and that is the fact people need.
  const label = neverPublished ? 'Never published' : status
  const tone: Record<string, string> = {
    published: 'bg-success-soft text-success',
    paused: 'bg-warning-soft text-warning',
    draft: 'bg-surface-muted text-muted',
    archived: 'bg-surface-muted text-muted',
  }

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        neverPublished ? 'bg-surface-muted text-muted' : tone[status] ?? 'bg-surface-muted text-muted'
      }`}
    >
      {label}
    </span>
  )
}
