'use server'

import { markNotificationsRead } from '@/lib/crm/activities'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission, type WorkspaceContext } from '@/lib/workspaces/context'

export type BellItem = {
  id: string
  title: string
  createdAt: string
  read: boolean
  href: string | null
}

export type BellState = { unread: number; items: BellItem[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Where a notification leads. Only ids we generated; never a stored URL. */
function hrefFor(refs: unknown): string | null {
  if (!refs || typeof refs !== 'object') return null
  const r = refs as Record<string, unknown>
  const id = (key: string) => (typeof r[key] === 'string' && UUID.test(r[key] as string) ? (r[key] as string) : null)
  const contact = id('contact_id')
  if (id('opportunity_id')) return '/crm/pipeline'
  if (contact) return `/crm/contacts/${contact}`
  if (id('task_id')) return '/crm/tasks'
  return null
}

/** Any member may read their own notifications; signed-out callers get none. */
async function caller(): Promise<WorkspaceContext | null> {
  try {
    return await assertWorkspacePermission('workspace.view')
  } catch {
    return null
  }
}

/**
 * The caller's own notifications in their active workspace. Scoped by
 * workspace AND user in code — the service role bypasses RLS.
 */
export async function loadMyNotifications(): Promise<BellState> {
  const ctx = await caller()
  if (!ctx) return { unread: 0, items: [] }

  const db = createAdminClient()
  const [list, unread] = await Promise.all([
    db
      .from('crm_notifications')
      .select('id, title, created_at, read_at, refs')
      .eq('workspace_id', ctx.workspace.id)
      .eq('user_id', ctx.userId)
      .order('created_at', { ascending: false })
      .limit(15),
    db
      .from('crm_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', ctx.workspace.id)
      .eq('user_id', ctx.userId)
      .is('read_at', null),
  ])

  return {
    unread: unread.count ?? 0,
    items: (list.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      read: row.read_at !== null,
      href: hrefFor(row.refs),
    })),
  }
}

export async function markMyNotificationsRead(): Promise<void> {
  const ctx = await caller()
  if (!ctx) return
  await markNotificationsRead(ctx.workspace.id, ctx.userId)
}
