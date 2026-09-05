import type { Metadata } from 'next'

import { SettingsShell } from '@/components/settings/SettingsShell'
import {
  InvitationList,
  InviteMemberForm,
  LeaveWorkspace,
  MemberList,
  WorkspaceSwitcher,
} from '@/components/settings/TeamSettings'
import { requireWorkspace } from '@/lib/workspaces/context'
import { assignableRoles, can } from '@/lib/workspaces/permissions'
import { listMembers, listPendingInvitations } from '@/lib/workspaces/roster'

export const metadata: Metadata = {
  title: 'Team settings | Outlio',
  robots: { index: false, follow: false },
}

/**
 * Workspace MEMBERSHIP administration.
 *
 * Distinct from the CRM's `/crm/team` surface, which reports on team
 * PERFORMANCE and arrives with reporting. Membership is an account setting and
 * belongs beside billing and security; see Ledger D9.
 */
export default async function TeamSettingsPage() {
  const ctx = await requireWorkspace()

  const policy = { role: ctx.role, modules: ctx.modules }
  const canView = can(policy, 'workspace.member.view')
  const canManage = can(policy, 'workspace.member.manage')

  // A setter can reach this page — it is where they leave a workspace and see
  // which one they are in — but they must not enumerate the roster.
  const [members, invitations] = await Promise.all([
    canView ? listMembers(ctx.workspace.id) : Promise.resolve([]),
    canManage ? listPendingInvitations(ctx.workspace.id) : Promise.resolve([]),
  ])

  const seatsLeft =
    ctx.memberLimit === null
      ? null
      : Math.max(0, ctx.memberLimit - ctx.memberCount - invitations.length)

  return (
    <SettingsShell
      title="Team"
      description="The people who share this workspace, and what each of them can do."
    >
      <div className="space-y-8">
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">{ctx.workspace.name}</h3>
            <p className="mt-0.5 text-xs text-muted">
              You are {ctx.role === 'admin' || ctx.role === 'owner' ? 'an' : 'a'} {ctx.role}
              {ctx.memberLimit === null
                ? ' · unlimited seats'
                : ` · ${ctx.memberCount} of ${ctx.memberLimit} ${
                    ctx.memberLimit === 1 ? 'seat' : 'seats'
                  } used`}
            </p>
          </div>
          <WorkspaceSwitcher workspaces={ctx.memberships} activeId={ctx.workspace.id} />
        </section>

        {canManage ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">Invite someone</h3>
            <InviteMemberForm
              assignableRoles={assignableRoles(ctx.role)}
              seatsLeft={seatsLeft}
            />
          </section>
        ) : null}

        {canView ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">Members</h3>
            <MemberList
              members={members}
              canManage={canManage}
              assignableRoles={assignableRoles(ctx.role)}
              currentUserId={ctx.userId}
            />
          </section>
        ) : null}

        {canManage ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">Pending invitations</h3>
            <InvitationList invitations={invitations} />
          </section>
        ) : null}

        {/*
          An owner cannot leave while they are the only owner — the trigger in
          migration 0070 is the authority on that, not this condition.
        */}
        {ctx.memberships.length > 1 || ctx.role !== 'owner' ? (
          <section className="space-y-3 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-ink">Leave</h3>
            <LeaveWorkspace workspaceName={ctx.workspace.name} />
          </section>
        ) : null}
      </div>
    </SettingsShell>
  )
}
