import type { Metadata } from 'next'

import { NewTaskButton } from '@/components/crm/NewTask'
import Link from 'next/link'

import { TaskList, type TaskRow } from '@/components/crm/TaskList'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireWorkspace } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Tasks | Outlio',
  robots: { index: false, follow: false },
}

const VIEWS = [
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'mine', label: 'Mine' },
  { value: 'completed', label: 'Completed' },
] as const

type View = (typeof VIEWS)[number]['value']

/**
 * Tasks — M9 screens over M2 Phase 5's schema.
 *
 * ⚠️ A SETTER SEES ONLY THEIR OWN, the constitution's "only assigned data"
 * rule. `crm.task.view` lets them in; seeing everyone's is a manager's.
 */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const params = await searchParams
  const ctx = await requireWorkspace()
  const policy = { role: ctx.role, modules: ctx.modules }

  if (!can(policy, 'crm.task.view')) {
    return (
      <div className="clay p-10 text-center">
        <p className="text-sm font-medium text-ink">You do not have access to tasks</p>
      </div>
    )
  }

  const view: View =
    VIEWS.some((v) => v.value === params.view) ? (params.view as View) : 'open'

  // Managers and above see the workspace; everyone else sees their own.
  const seesAll = can(policy, 'crm.contact.assign')

  const db = createAdminClient()
  let query = db
    .from('crm_tasks')
    .select('id, title, body, due_at, status, contact_id, assigned_to_user_id')
    .eq('workspace_id', ctx.workspace.id)
    .is('deleted_at', null)
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(50)

  if (!seesAll) query = query.eq('assigned_to_user_id', ctx.userId)

  if (view === 'completed') query = query.eq('status', 'completed')
  else query = query.eq('status', 'open')

  if (view === 'mine') query = query.eq('assigned_to_user_id', ctx.userId)
  // Overdue is a due date in the past, so a task with no due date is never
  // overdue — it is simply undated, which is a different thing.
  if (view === 'overdue') query = query.lt('due_at', new Date().toISOString())

  const { data } = await query
  const tasks = data ?? []

  const contactIds = [...new Set(tasks.map((t) => t.contact_id).filter(Boolean))] as string[]
  const names = new Map<string, string>()

  if (contactIds.length > 0) {
    const { data: contacts } = await db
      .from('crm_contacts')
      .select('id, full_name')
      .eq('workspace_id', ctx.workspace.id)
      .in('id', contactIds)
    for (const c of contacts ?? []) names.set(c.id, c.full_name ?? 'Unnamed contact')
  }

  const rows: TaskRow[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    body: t.body,
    dueAt: t.due_at,
    done: t.status === 'completed',
    contactId: t.contact_id,
    contactName: t.contact_id ? names.get(t.contact_id) ?? null : null,
  }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">Tasks</h2>
          <p className="mt-0.5 text-sm text-muted">
            {seesAll ? 'Everything open across the workspace.' : 'The tasks assigned to you.'}
          </p>
        </div>

        {/* ⚠️ Until R2 a task could only arrive from a flow, so this queue was
            empty for anyone who had not built an automation first. */}
        <NewTaskButton />
      </div>

      <nav aria-label="Task views" className="flex flex-wrap gap-1 border-b border-border">
        {VIEWS.map((v) => (
          <Link
            key={v.value}
            href={`/crm/tasks?view=${v.value}`}
            aria-current={v.value === view ? 'page' : undefined}
            className={
              v.value === view
                ? '-mb-px border-b-2 border-accent px-3 py-2 text-sm font-semibold text-ink'
                : '-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted transition-colors duration-150 hover:text-ink'
            }
          >
            {v.label}
          </Link>
        ))}
      </nav>

      <TaskList rows={rows} view={view} canManage={can(policy, 'crm.task.manage')} />
    </div>
  )
}
