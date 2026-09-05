'use server'

/**
 * Workspace team management.
 *
 * EVERY action here follows the same three steps, in this order:
 *
 *   1. `assertWorkspacePermission(...)` — role AND module entitlement, at the
 *      API level. Never a UI check.
 *   2. `canManageRole(actor, target)` — you may only act on someone strictly
 *      beneath you.
 *   3. a service-role write scoped by `workspace_id` in code, because the
 *      service role bypasses RLS.
 *
 * Skipping step 3's scoping is a cross-tenant breach, not a bug — see the
 * banner in `lib/supabase/admin.ts`.
 */
import { cookies, headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { RULES, enforce, subjectFor } from '@/lib/auth/rate-limit'
import { appOrigin } from '@/lib/auth/redirects'
import { clientIp } from '@/lib/auth/signup-gate'
import { isAppError } from '@/lib/errors/catalog'
import {
  ACTIVE_WORKSPACE_COOKIE,
  assertWorkspacePermission,
  listMemberships,
} from '@/lib/workspaces/context'
import { createAdminClient } from '@/lib/supabase/admin'
import { handoverTotal, reassignMemberRecords } from '@/lib/workspaces/handover'
import { getWorkspaceEntitlements } from '@/lib/workspaces/entitlements'
import { canManageRole, WORKSPACE_ROLES, type WorkspaceRole } from '@/lib/workspaces/permissions'
import {
  createInvitationToken,
  hashInvitationToken,
  invitationExpiresAt,
  isInvitationTokenShape,
  normalizeInviteEmail,
} from '@/lib/workspaces/tokens'
import { assertUser } from '@/lib/auth/access'

const TEAM_PATH = '/dashboard/settings/team'

/**
 * `inviteLink` exists because invitation email delivery is deferred until an
 * `EmailProvider` exists (Ledger DR2). The inviter copies the link and sends it
 * themselves. It is returned ONCE and never stored — the database holds only
 * the token's SHA-256.
 */
export type WorkspaceActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string; inviteLink?: string }

const ok = (message: string, inviteLink?: string): WorkspaceActionState => ({
  status: 'success',
  message,
  ...(inviteLink ? { inviteLink } : {}),
})
const fail = (message: string): WorkspaceActionState => ({ status: 'error', message })

/** Generic, so a failed action never reveals internals. */
const GENERIC_ERROR = 'That did not work. Please try again.'

/**
 * One message for "no such invitation", "already used", "revoked" and
 * "expired". Distinguishing them would turn `/join/<token>` into an oracle for
 * probing which links were ever real. The distinction is logged, not shown.
 */
const INVALID_INVITATION =
  'This invitation link is not valid any more. Ask for a new one.'

const roleSchema = z.enum(
  WORKSPACE_ROLES as unknown as [WorkspaceRole, ...WorkspaceRole[]],
)
const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address.')
const uuidSchema = z.string().uuid()

/**
 * Every action funnels its failures through here so a thrown `AppError` becomes
 * the catalog's user-facing copy and anything else becomes one generic string.
 * A stack trace, a SQL error or a storage path must never reach the client.
 */
function toState(error: unknown): WorkspaceActionState {
  if (isAppError(error)) return fail(error.userMessage)
  return fail(GENERIC_ERROR)
}

// ---------------------------------------------------------------------------
// Invite
// ---------------------------------------------------------------------------

export async function inviteMemberAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  try {
    const ctx = await assertWorkspacePermission('workspace.member.manage')

    // Rate limited per INVITER, after the permission check: an unauthorised
    // caller must not be able to consume someone else's budget.
    await enforce(RULES.workspaceInvite, subjectFor(await clientIp(), ctx.email))

    const emailResult = emailSchema.safeParse(formData.get('email'))
    if (!emailResult.success) {
      return fail(emailResult.error.issues[0]?.message ?? 'Enter a valid email address.')
    }
    const email = normalizeInviteEmail(emailResult.data)

    const roleResult = roleSchema.safeParse(formData.get('role'))
    if (!roleResult.success) return fail('Choose a role for this member.')
    const role = roleResult.data

    if (!canManageRole(ctx.role, role)) {
      return fail('You cannot invite someone at that level.')
    }

    if (email === ctx.email?.toLowerCase()) {
      return fail('You are already a member of this workspace.')
    }

    const db = createAdminClient()

    // Seats are counted as members PLUS outstanding invitations. Counting only
    // members would let an admin issue fifty invitations against two seats and
    // discover the problem only when the forty-eighth person is turned away.
    if (ctx.memberLimit !== null) {
      const { count, error } = await db
        .from('workspace_invitations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ctx.workspace.id)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())

      if (error) throw new Error(error.message)

      if (ctx.memberCount + (count ?? 0) >= ctx.memberLimit) {
        return fail(
          `Your plan includes ${ctx.memberLimit} ${
            ctx.memberLimit === 1 ? 'seat' : 'seats'
          }. Remove a member or an outstanding invitation first.`,
        )
      }
    }

    const { token, tokenHash } = createInvitationToken()

    const { error: insertError } = await db.from('workspace_invitations').insert({
      workspace_id: ctx.workspace.id,
      email,
      role,
      token_hash: tokenHash,
      invited_by: ctx.userId,
      expires_at: invitationExpiresAt().toISOString(),
    })

    if (insertError) {
      // 23505 is the partial unique index on (workspace_id, email) for
      // invitations that are still outstanding.
      if (insertError.code === '23505') {
        return fail('That person already has an invitation waiting.')
      }
      throw new Error(insertError.message)
    }

    const requestHeaders = await headers()
    const host = requestHeaders.get('host')
    const origin = appOrigin(host ? `http://${host}` : undefined)

    revalidatePath(TEAM_PATH)
    return ok(
      `Invitation ready for ${email}. Send them this link — it is shown once.`,
      `${origin}/join/${token}`,
    )
  } catch (error) {
    return toState(error)
  }
}

// ---------------------------------------------------------------------------
// Revoke an outstanding invitation
// ---------------------------------------------------------------------------

export async function revokeInvitationAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  try {
    const ctx = await assertWorkspacePermission('workspace.member.manage')

    const idResult = uuidSchema.safeParse(formData.get('invitation_id'))
    if (!idResult.success) return fail(GENERIC_ERROR)

    // Scoped by workspace_id: the service role would otherwise happily revoke
    // another tenant's invitation given its id.
    const { error } = await createAdminClient()
      .from('workspace_invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', idResult.data)
      .eq('workspace_id', ctx.workspace.id)
      .is('accepted_at', null)
      .is('revoked_at', null)

    if (error) throw new Error(error.message)

    revalidatePath(TEAM_PATH)
    return ok('Invitation revoked.')
  } catch (error) {
    return toState(error)
  }
}

// ---------------------------------------------------------------------------
// Change a member's role
// ---------------------------------------------------------------------------

export async function changeMemberRoleAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  try {
    const ctx = await assertWorkspacePermission('workspace.member.manage')

    const idResult = uuidSchema.safeParse(formData.get('membership_id'))
    const roleResult = roleSchema.safeParse(formData.get('role'))
    if (!idResult.success || !roleResult.success) return fail(GENERIC_ERROR)

    const db = createAdminClient()
    const { data: membership, error: readError } = await db
      .from('workspace_memberships')
      .select('id, user_id, role')
      .eq('id', idResult.data)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle()

    if (readError) throw new Error(readError.message)
    if (!membership) return fail('That member is no longer in this workspace.')

    if (membership.user_id === ctx.userId) {
      return fail('You cannot change your own role.')
    }

    // BOTH ends are checked. Checking only the target role would let an admin
    // demote an owner; checking only the current role would let them promote a
    // setter straight past themselves.
    if (!canManageRole(ctx.role, membership.role) || !canManageRole(ctx.role, roleResult.data)) {
      return fail('You cannot change that member’s role.')
    }

    const { error } = await db
      .from('workspace_memberships')
      .update({ role: roleResult.data })
      .eq('id', membership.id)
      .eq('workspace_id', ctx.workspace.id)

    if (error) throw new Error(error.message)

    revalidatePath(TEAM_PATH)
    return ok('Role updated.')
  } catch (error) {
    return toState(error)
  }
}

// ---------------------------------------------------------------------------
// Remove a member
// ---------------------------------------------------------------------------

export async function removeMemberAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  try {
    const ctx = await assertWorkspacePermission('workspace.member.manage')

    const idResult = uuidSchema.safeParse(formData.get('membership_id'))
    if (!idResult.success) return fail(GENERIC_ERROR)

    const db = createAdminClient()
    const { data: membership, error: readError } = await db
      .from('workspace_memberships')
      .select('id, user_id, role')
      .eq('id', idResult.data)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle()

    if (readError) throw new Error(readError.message)
    if (!membership) return ok('That member has already been removed.')

    if (membership.user_id === ctx.userId) {
      return fail('Use “Leave workspace” to remove yourself.')
    }

    if (!canManageRole(ctx.role, membership.role)) {
      return fail('You cannot remove that member.')
    }

    /*
     * ⚠️ HAND THE WORK OVER BEFORE DELETING THE MEMBERSHIP.
     *
     * This used to delete the row and stop. Everything the person owned kept
     * pointing at a user who was no longer in the workspace, so those records
     * appeared in nobody's "assigned to me", the owner filter listed someone
     * who was not there, and the work quietly stopped being done.
     *
     * Reassignment happens FIRST: if it fails, the member is still here and
     * their book is intact, which is the recoverable order. Deleting first and
     * failing to reassign would leave orphans with no owner to find them by.
     */
    const reassignTo = formData.get('reassign_to')
    const newOwnerId =
      typeof reassignTo === 'string' && reassignTo && reassignTo !== 'none'
        ? reassignTo
        : null

    let handover
    try {
      handover = await reassignMemberRecords(ctx.workspace.id, membership.user_id, newOwnerId)
    } catch {
      return fail('Could not reassign their records, so nothing was changed.')
    }

    const { error } = await db
      .from('workspace_memberships')
      .delete()
      .eq('id', membership.id)
      .eq('workspace_id', ctx.workspace.id)

    if (error) throw new Error(error.message)

    revalidatePath(TEAM_PATH)

    /*
     * Says what moved. "Member removed" alone leaves an admin wondering what
     * happened to that person's pipeline — which is the first thing they will
     * ask.
     */
    const moved = handoverTotal(handover)
    if (moved === 0) return ok('Member removed. They owned no records.')

    return ok(
      newOwnerId
        ? `Member removed. ${moved} record${moved === 1 ? '' : 's'} reassigned.`
        : `Member removed. ${moved} record${moved === 1 ? '' : 's'} left unassigned.`,
    )
  } catch (error) {
    return toState(error)
  }
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

export async function leaveWorkspaceAction(
  _prev: WorkspaceActionState,
  _formData: FormData,
): Promise<WorkspaceActionState> {
  try {
    // Leaving needs no management permission — only membership.
    const ctx = await assertWorkspacePermission('workspace.view')

    const { error } = await createAdminClient()
      .from('workspace_memberships')
      .delete()
      .eq('workspace_id', ctx.workspace.id)
      .eq('user_id', ctx.userId)

    if (error) {
      // The last-owner trigger (migration 0070) raises check_violation. It is
      // the authority on this rule, not the application: the service role
      // bypasses RLS, so a guard in code alone would be advisory.
      if (error.code === '23514' || /at least one owner/i.test(error.message)) {
        return fail('Promote another owner before you leave this workspace.')
      }
      throw new Error(error.message)
    }

    const jar = await cookies()
    jar.delete(ACTIVE_WORKSPACE_COOKIE)

    revalidatePath(TEAM_PATH)
    return ok('You have left the workspace.')
  } catch (error) {
    return toState(error)
  }
}

// ---------------------------------------------------------------------------
// Accept an invitation
// ---------------------------------------------------------------------------

/**
 * Deliberately an ACTION, not a page render.
 *
 * Redeeming on GET would mean a link preview, a prefetch or an antivirus
 * scanner silently burning the invitation before the person ever saw it. The
 * page reads the invitation; this mutates it, once the user confirms.
 */
export async function acceptInvitationAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  try {
    const auth = await assertUser()
    if (!auth.userId) return fail(GENERIC_ERROR)

    await enforce(RULES.workspaceJoin, subjectFor(await clientIp(), auth.email))

    const token = String(formData.get('token') ?? '')
    if (!isInvitationTokenShape(token)) return fail(INVALID_INVITATION)

    const tokenHash = hashInvitationToken(token)
    const db = createAdminClient()

    // Read the target workspace first, only to learn its seat allowance. The
    // count that actually enforces the limit is re-taken inside the function's
    // row lock, so this cannot be raced.
    const { data: invitation, error: readError } = await db
      .from('workspace_invitations')
      .select('workspace_id')
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (readError) throw new Error(readError.message)
    if (!invitation) return fail(INVALID_INVITATION)

    const { memberLimit } = await getWorkspaceEntitlements(invitation.workspace_id)

    // UNLIMITED IS EXPRESSED BY OMITTING THE ARGUMENT, not by passing null.
    // The function defaults `p_member_limit` to null and skips the seat check
    // when it is null, so leaving it out is the same statement — and it is the
    // only form the generated signature (`p_member_limit?: number`) accepts.
    const { data: status, error } = await db.rpc('redeem_workspace_invitation', {
      p_token_hash: tokenHash,
      p_user_id: auth.userId,
      ...(memberLimit === null ? {} : { p_member_limit: memberLimit }),
    })

    if (error) throw new Error(error.message)

    switch (status) {
      case 'ok':
      case 'already_member': {
        const jar = await cookies()
        jar.set(ACTIVE_WORKSPACE_COOKIE, invitation.workspace_id, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
          maxAge: 60 * 60 * 24 * 365,
        })
        revalidatePath('/dashboard')
        return ok(
          status === 'ok'
            ? 'You have joined the workspace.'
            : 'You are already a member of this workspace.',
        )
      }
      case 'wrong_email':
        return fail(
          'This invitation was sent to a different email address. Sign in with that address to accept it.',
        )
      case 'seat_limit':
        return fail(
          'This workspace has no seats available. Ask an admin to free one up.',
        )
      default:
        return fail(INVALID_INVITATION)
    }
  } catch (error) {
    return toState(error)
  }
}

// ---------------------------------------------------------------------------
// Switch the active workspace
// ---------------------------------------------------------------------------

export async function switchWorkspaceAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  try {
    const auth = await assertUser()
    if (!auth.userId) return fail(GENERIC_ERROR)

    const idResult = uuidSchema.safeParse(formData.get('workspace_id'))
    if (!idResult.success) return fail(GENERIC_ERROR)

    // The cookie is a preference, but it is still only ever written to a value
    // the user provably belongs to. Trusting the form field would let anyone
    // point their session at any workspace id — the reads would still be
    // scoped, but every "which workspace am I in?" answer would be a lie.
    const memberships = await listMemberships(auth.userId)
    if (!memberships.some((m) => m.id === idResult.data)) {
      return fail(GENERIC_ERROR)
    }

    const jar = await cookies()
    jar.set(ACTIVE_WORKSPACE_COOKIE, idResult.data, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })

    revalidatePath('/dashboard')
    return ok('Workspace switched.')
  } catch (error) {
    return toState(error)
  }
}
