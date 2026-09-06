'use client'

import { useActionState } from 'react'

import { FormFeedback } from '@/components/auth/FormFeedback'
import { SubmitButton } from '@/components/auth/SubmitButton'
import {
  changeMemberRoleAction,
  inviteMemberAction,
  leaveWorkspaceAction,
  removeMemberAction,
  revokeInvitationAction,
  switchWorkspaceAction,
  type WorkspaceActionState,
} from '@/lib/workspaces/actions'
import type { WorkspaceRole } from '@/lib/workspaces/permissions'
import type { PendingInvitation, TeamMember } from '@/lib/workspaces/roster'

const INITIAL: WorkspaceActionState = { status: 'idle' }

const inputClass =
  'w-full field px-3 py-2.5 text-base text-ink placeholder:text-muted focus:outline-none'

const ghostButton =
  'rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-semibold text-muted transition-[background-color,color,transform] duration-150 hover:bg-surface-muted hover:text-ink active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60'

const dangerButton =
  'rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-semibold text-muted transition-[background-color,color,transform] duration-150 hover:bg-danger-soft hover:text-danger active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60'

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  setter: 'Setter',
  viewer: 'Viewer',
}

const ROLE_HINT: Record<WorkspaceRole, string> = {
  owner: 'Billing, workspace deletion, everything below.',
  admin: 'Members, settings and integrations. No billing.',
  manager: 'All team data, reports, flows and campaigns.',
  setter: 'Only records assigned to them. No exports.',
  viewer: 'Read-only, assigned records.',
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Shown only when the user belongs to more than one workspace. A switcher with
 * a single option is noise.
 */
export function WorkspaceSwitcher({
  workspaces,
  activeId,
}: {
  workspaces: { id: string; name: string; role: WorkspaceRole }[]
  activeId: string
}) {
  const [state, action] = useActionState(switchWorkspaceAction, INITIAL)
  if (workspaces.length < 2) return null

  return (
    <form action={action} className="space-y-3">
      <FormFeedback state={state} />
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-ink">Active workspace</span>
        <select className={inputClass} name="workspace_id" defaultValue={activeId}>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name} · {ROLE_LABEL[workspace.role]}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={ghostButton}>
        Switch workspace
      </button>
    </form>
  )
}

export function InviteMemberForm({
  assignableRoles,
  seatsLeft,
}: {
  assignableRoles: WorkspaceRole[]
  /** `null` means unlimited. */
  seatsLeft: number | null
}) {
  const [state, action] = useActionState(inviteMemberAction, INITIAL)

  if (assignableRoles.length === 0) return null

  return (
    <form action={action} className="space-y-4">
      <FormFeedback state={state} />

      {/*
        The link is returned ONCE and never stored — the database holds only its
        SHA-256. Invitation email delivery arrives with the email module
        (Ledger DR2); until then the inviter sends it themselves.
      */}
      {state.status === 'success' && state.inviteLink ? (
        <div className="rounded-[var(--radius-md)] bg-surface-muted p-3">
          <p className="text-xs font-medium text-muted">
            Copy this link now — it is not shown again.
          </p>
          <code className="mt-1.5 block break-all text-xs text-ink">{state.inviteLink}</code>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink">Email address</span>
          <input
            className={inputClass}
            name="email"
            type="email"
            required
            maxLength={254}
            placeholder="colleague@company.com"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink">Role</span>
          <select className={inputClass} name="role" defaultValue={assignableRoles.at(-1)}>
            {assignableRoles.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="space-y-1 text-xs text-muted">
        {assignableRoles.map((role) => (
          <li key={role}>
            <span className="font-semibold text-ink">{ROLE_LABEL[role]}</span> — {ROLE_HINT[role]}
          </li>
        ))}
      </ul>

      {seatsLeft !== null ? (
        <p className="text-xs text-muted">
          {seatsLeft > 0
            ? `${seatsLeft} ${seatsLeft === 1 ? 'seat' : 'seats'} available on your plan.`
            : 'No seats available on your plan.'}
        </p>
      ) : null}

      <SubmitButton>Create invitation</SubmitButton>
    </form>
  )
}

function MemberRow({
  member,
  canManage,
  assignableRoles,
  isSelf,
}: {
  member: TeamMember
  canManage: boolean
  assignableRoles: WorkspaceRole[]
  isSelf: boolean
}) {
  const [roleState, roleAction] = useActionState(changeMemberRoleAction, INITIAL)
  const [removeState, removeAction] = useActionState(removeMemberAction, INITIAL)

  // A member may only be acted on by someone strictly above them. The server
  // re-checks this in `canManageRole` — this only decides what to render.
  const actionable = canManage && !isSelf && assignableRoles.includes(member.role)

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink">
          {member.fullName?.trim() || member.email || 'Pending member'}
          {isSelf ? <span className="ml-1.5 text-xs font-medium text-muted">(you)</span> : null}
        </p>
        <p className="truncate text-xs text-muted">
          {member.email} · joined {formatDate(member.joinedAt)}
        </p>
        {roleState.status === 'error' ? (
          <p className="mt-1 text-xs text-danger">{roleState.message}</p>
        ) : null}
        {removeState.status === 'error' ? (
          <p className="mt-1 text-xs text-danger">{removeState.message}</p>
        ) : null}
      </div>

      {actionable ? (
        <div className="flex items-center gap-2">
          <form action={roleAction} className="flex items-center gap-2">
            <input type="hidden" name="membership_id" value={member.membershipId} />
            <select
              name="role"
              defaultValue={member.role}
              aria-label={`Role for ${member.email ?? 'member'}`}
              className="field px-2 py-1.5 text-xs text-ink focus:outline-none [color-scheme:light]"
            >
              {assignableRoles.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
            <button type="submit" className={ghostButton}>
              Save
            </button>
          </form>

          <form action={removeAction}>
            <input type="hidden" name="membership_id" value={member.membershipId} />
            <button type="submit" className={dangerButton}>
              Remove
            </button>
          </form>
        </div>
      ) : (
        <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-muted">
          {ROLE_LABEL[member.role]}
        </span>
      )}
    </li>
  )
}

export function MemberList({
  members,
  canManage,
  assignableRoles,
  currentUserId,
}: {
  members: TeamMember[]
  canManage: boolean
  assignableRoles: WorkspaceRole[]
  currentUserId: string
}) {
  if (members.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nobody here yet. Invite a teammate to get started.
      </p>
    )
  }

  return (
    <ul>
      {members.map((member) => (
        <MemberRow
          key={member.membershipId}
          member={member}
          canManage={canManage}
          assignableRoles={assignableRoles}
          isSelf={member.userId === currentUserId}
        />
      ))}
    </ul>
  )
}

function InvitationRow({ invitation }: { invitation: PendingInvitation }) {
  const [state, action] = useActionState(revokeInvitationAction, INITIAL)

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink">{invitation.email}</p>
        <p className="truncate text-xs text-muted">
          {ROLE_LABEL[invitation.role]} · expires {formatDate(invitation.expiresAt)}
        </p>
        {state.status === 'error' ? (
          <p role="status" aria-live="polite" className="mt-1 text-xs text-danger">{state.message}</p>
        ) : null}
      </div>
      <form action={action}>
        <input type="hidden" name="invitation_id" value={invitation.id} />
        <button type="submit" className={dangerButton}>
          Revoke
        </button>
      </form>
    </li>
  )
}

export function InvitationList({ invitations }: { invitations: PendingInvitation[] }) {
  if (invitations.length === 0) {
    return <p className="text-sm text-muted">No invitations are waiting to be accepted.</p>
  }

  return (
    <ul>
      {invitations.map((invitation) => (
        <InvitationRow key={invitation.id} invitation={invitation} />
      ))}
    </ul>
  )
}

export function LeaveWorkspace({ workspaceName }: { workspaceName: string }) {
  const [state, action] = useActionState(leaveWorkspaceAction, INITIAL)

  return (
    <form action={action} className="space-y-3">
      <FormFeedback state={state} />
      <p className="text-sm text-muted">
        You will lose access to everything in {workspaceName}. An owner must promote
        someone else before the last owner can leave.
      </p>
      <button type="submit" className={dangerButton}>
        Leave workspace
      </button>
    </form>
  )
}
