'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import {
  approveUserAction,
  revokeUserAction,
  suspendUserAction,
  type AdminActionState,
} from '@/lib/admin/actions'
import type { UserRole } from '@/types/database'

const INITIAL: AdminActionState = { status: 'idle' }

export type AdminUser = {
  id: string
  email: string | null
  fullName: string | null
  phone: string | null
  linkedinUrl: string | null
  role: UserRole
  planName: string | null
  accessExpiresAt: string | null
  suspendedAt: string | null
  createdAt: string
  pendingRequest: { type: string; message: string | null; createdAt: string } | null
}

function Btn({
  label,
  busy,
  tone = 'default',
}: {
  label: string
  busy: string
  tone?: 'default' | 'primary' | 'danger'
}) {
  const { pending } = useFormStatus()
  const cls =
    tone === 'primary'
      ? 'bg-accent text-cream hover:bg-accent-deep border-transparent'
      : tone === 'danger'
        ? 'border-danger/30 text-danger hover:bg-danger-soft'
        : 'border-border text-ink hover:border-border-strong'

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`rounded-[var(--radius-md)] border px-3 py-1.5 text-sm font-medium transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 ${cls}`}
    >
      {pending ? busy : label}
    </button>
  )
}

function Feedback({ state }: { state: AdminActionState }) {
  if (state.status === 'idle') return null
  return (
    <p
      role="alert"
      className={
        state.status === 'error'
          ? 'mt-2 text-sm text-danger'
          : 'mt-2 text-sm text-success'
      }
    >
      {state.message}
    </p>
  )
}

export function UserRow({
  user,
  plans,
  isSelf,
}: {
  user: AdminUser
  plans: { id: string; name: string }[]
  isSelf: boolean
}) {
  const [approve, approveAction] = useActionState(approveUserAction, INITIAL)
  const [revoke, revokeAction] = useActionState(revokeUserAction, INITIAL)
  const [suspend, suspendAction] = useActionState(suspendUserAction, INITIAL)

  /*
   * PRESENTATION ONLY — these are not access decisions.
   *
   * They choose which badge and which buttons to render. Every action they
   * gate is independently authorized server-side by assertAdmin() in
   * lib/admin/actions.ts, and the real access decision lives in
   * lib/auth/decide.ts. Hiding a button is not access control; forging this
   * form would still be rejected.
   */
  const hasAccess = ['approved_user', 'subscriber', 'admin'].includes(user.role)
  const isSuspended = Boolean(user.suspendedAt) || user.role === 'suspended_user'
  const isProtectedAdmin = user.role === 'admin'

  return (
    <li className="rounded-[var(--radius-lg)] border border-border bg-surface-muted/25 p-4 transition-colors duration-150 hover:bg-surface-muted/55">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{user.fullName ?? 'Not provided'}</span>
            <RoleBadge role={user.role} suspended={isSuspended} />
            {isSelf ? (
              <span className="text-xs font-medium text-muted">(you)</span>
            ) : null}
          </div>

          <p className="text-sm text-muted">{user.email}</p>

          <p className="text-sm text-muted">
            {user.phone ?? 'no phone'}
            {user.linkedinUrl ? (
              <>
                {' | '}
                <a
                  href={user.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-accent hover:underline"
                >
                  LinkedIn
                </a>
              </>
            ) : null}
          </p>

          {user.planName ? (
            <p className="text-sm text-muted">
              {user.planName}
              {user.accessExpiresAt
                ? ` | expires ${new Date(user.accessExpiresAt).toLocaleDateString('en-GB')}`
                : ' | no expiry'}
            </p>
          ) : null}

          {user.pendingRequest ? (
            <div className="mt-2 rounded-[var(--radius-md)] border border-info/25 bg-info-soft px-3 py-2">
              <p className="text-sm font-medium text-info">
                Requested: {user.pendingRequest.type.replace(/_/g, ' ')}
              </p>
              {user.pendingRequest.message ? (
                <p className="mt-1 text-sm text-ink">{user.pendingRequest.message}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          {!hasAccess && !isSuspended ? (
            <form action={approveAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="user_id" value={user.id} />
              <label htmlFor={`plan-${user.id}`} className="sr-only">
                Plan
              </label>
              <select
                id={`plan-${user.id}`}
                name="plan_id"
                required
                defaultValue=""
                className="rounded-[var(--radius-md)] border border-border bg-paper px-2.5 py-1.5 text-sm text-ink"
              >
                <option value="" disabled>
                  Plan…
                </option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <label htmlFor={`days-${user.id}`} className="sr-only">
                Days (blank = no expiry)
              </label>
              <input
                id={`days-${user.id}`}
                name="duration_days"
                type="number"
                min={1}
                placeholder="days"
                className="w-20 rounded-[var(--radius-md)] border border-border bg-paper px-2.5 py-1.5 text-sm text-ink"
              />
              <Btn label="Approve" busy="Granting…" tone="primary" />
            </form>
          ) : null}

          {hasAccess && !isSelf && !isProtectedAdmin ? (
            <form action={revokeAction}>
              <input type="hidden" name="user_id" value={user.id} />
              <Btn label="Revoke access" busy="Revoking…" />
            </form>
          ) : null}

          {!isSelf && !isProtectedAdmin ? (
            <form action={suspendAction}>
              <input type="hidden" name="user_id" value={user.id} />
              <input type="hidden" name="suspend" value={isSuspended ? 'false' : 'true'} />
              <Btn
                label={isSuspended ? 'Restore account' : 'Suspend'}
                busy="Working…"
                tone={isSuspended ? 'default' : 'danger'}
              />
            </form>
          ) : null}

          <Feedback state={approve} />
          <Feedback state={revoke} />
          <Feedback state={suspend} />
        </div>
      </div>
    </li>
  )
}

function RoleBadge({ role, suspended }: { role: UserRole; suspended: boolean }) {
  if (suspended) {
    return (
      <span className="rounded-full border border-danger/25 bg-danger-soft px-2.5 py-0.5 text-xs font-semibold text-danger">
        Suspended
      </span>
    )
  }

  const map: Partial<Record<UserRole, { label: string; cls: string }>> = {
    admin: { label: 'Admin', cls: 'border-accent/30 bg-accent-soft text-accent' },
    subscriber: { label: 'Active', cls: 'border-success/25 bg-success-soft text-success' },
    approved_user: { label: 'Active', cls: 'border-success/25 bg-success-soft text-success' },
    pending_user: { label: 'Pending', cls: 'border-info/25 bg-info-soft text-info' },
    registered_user: { label: 'No access', cls: 'border-border bg-paper text-muted' },
  }
  const entry = map[role] ?? { label: role, cls: 'border-border bg-paper text-muted' }

  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${entry.cls}`}>
      {entry.label}
    </span>
  )
}
