import type { Metadata } from 'next'

import { InboxList, InboxTabs } from '@/components/email/InboxList'
import { isInboxView, listThreads, seesAllThreads, viewCounts } from '@/lib/email/inbox'
import { createAdminClient } from '@/lib/supabase/admin'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Inbox | Outlio',
  robots: { index: false, follow: false },
}

/**
 * The unified inbox — M8 Phase 26, criterion 5.
 *
 * ⚠️ THE PAGE DECIDES NOTHING. Permission scoping and pagination both live in
 * `lib/email/inbox.ts`, so the rule that a setter sees only their own threads
 * cannot be lost by someone adding a second route that reads the table
 * directly.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; cursor?: string }>
}) {
  const params = await searchParams
  const ctx = await workspaceContextIfPermitted('email.campaign.view')
  // The layout renders the reason; this only stops the page computing and
  // serialising its result into the RSC payload.
  if (!ctx) return null
  const policy = { role: ctx.role, modules: ctx.modules }

  if (!can(policy, 'email.inbox.view')) {
    return (
      <div className="clay p-10 text-center">
        <p className="text-sm font-medium text-ink">You do not have access to the inbox</p>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
          Ask a workspace admin if you need to see replies.
        </p>
      </div>
    )
  }

  const view = params.view && isInboxView(params.view) ? params.view : 'all'

  const [page, counts] = await Promise.all([
    listThreads({
      workspaceId: ctx.workspace.id,
      userId: ctx.userId,
      policy,
      view,
      cursor: params.cursor ?? null,
    }),
    viewCounts({ workspaceId: ctx.workspace.id, userId: ctx.userId, policy }),
  ])

  /*
   * The assignee picker only appears for someone who may reassign, so the
   * member list is only fetched for them — a setter has no use for it and no
   * business seeing the roster through this route.
   */
  const canManage = can(policy, 'email.inbox.manage')
  const members = canManage ? await workspaceMembers(ctx.workspace.id) : []

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Inbox</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {seesAllThreads(policy)
            ? 'Every reply to your workspace’s campaigns, in one place.'
            : 'Replies on the conversations assigned to you.'}
        </p>
      </div>

      <InboxTabs active={view} counts={counts} />

      <InboxList
        threads={page.threads}
        members={members}
        canManage={canManage}
        nextCursor={page.nextCursor}
        view={view}
      />
    </div>
  )
}

/** Names for the assignee picker. */
async function workspaceMembers(workspaceId: string): Promise<{ id: string; name: string }[]> {
  const db = createAdminClient()

  const { data: memberships } = await db
    .from('workspace_memberships')
    .select('user_id')
    .eq('workspace_id', workspaceId)

  const ids = (memberships ?? []).map((m) => m.user_id)
  if (ids.length === 0) return []

  const { data: profiles } = await db
    .from('profiles')
    .select('id, full_name')
    .in('id', ids)

  return (profiles ?? []).map((p) => ({
    id: p.id,
    // A member with no name set still needs to be pickable.
    name: p.full_name ?? 'Unnamed member',
  }))
}
