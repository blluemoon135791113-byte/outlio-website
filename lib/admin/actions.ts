'use server'

/**
 * Admin actions.
 *
 * EVERY action calls assertAdmin() — including ones that only read. Admin
 * status comes from `profiles.role` via the access module, never from a claim
 * or a hidden form field.
 *
 * All state changes go through grantEntitlement/revokeEntitlement, which write
 * their audit row in the SAME TRANSACTION as the change.
 */
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import {
  backfillCompaniesForUser,
  listUsersWithUnlinkedLeads,
} from '@/lib/companies/backfill'
import { assertAdmin } from '@/lib/auth/access'
import { consume } from '@/lib/auth/rate-limit'
import { grantEntitlement, revokeEntitlement } from '@/lib/payments/grant'
import { ACTION_LIMITS } from '@/lib/security/action-limits'
import { createAdminClient } from '@/lib/supabase/admin'

export type AdminActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string }

const uuid = z.string().uuid()

async function protectAdminMutation(
  adminId: string,
  targetUserId: string,
): Promise<AdminActionState | null> {
  const limit = await consume(ACTION_LIMITS.adminMutation, `admin:${adminId}`)
  if (!limit.allowed) {
    return { status: 'error', message: 'Too many admin changes. Please wait and try again.' }
  }

  const { data: target, error } = await createAdminClient()
    .from('profiles')
    .select('role')
    .eq('id', targetUserId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error || !target) return { status: 'error', message: 'That account could not be found.' }
  if (target.role === 'admin') {
    return { status: 'error', message: 'Admin accounts are protected from user-management actions.' }
  }
  return null
}

export async function approveUserAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await assertAdmin()

  const userId = uuid.safeParse(formData.get('user_id'))
  const planId = uuid.safeParse(formData.get('plan_id'))
  if (!userId.success) return { status: 'error', message: 'Invalid user.' }
  if (!planId.success) return { status: 'error', message: 'Choose a plan.' }
  const protection = await protectAdminMutation(admin.userId!, userId.data)
  if (protection) return protection

  const rawDays = String(formData.get('duration_days') ?? '').trim()
  const durationDays = rawDays === '' ? null : Number.parseInt(rawDays, 10)
  if (durationDays !== null && (!Number.isFinite(durationDays) || durationDays <= 0)) {
    return { status: 'error', message: 'Duration must be a positive number of days, or blank for no expiry.' }
  }

  try {
    await grantEntitlement({
      userId: userId.data,
      planId: planId.data,
      durationDays,
      grantedBy: admin.userId,
      provider: 'manual',
      reason: 'Approved by admin',
    })
  } catch {
    return { status: 'error', message: 'Could not grant access. Please try again.' }
  }

  revalidatePath('/admin')
  return { status: 'success', message: 'Access granted.' }
}

export async function revokeUserAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await assertAdmin()

  const userId = uuid.safeParse(formData.get('user_id'))
  if (!userId.success) return { status: 'error', message: 'Invalid user.' }

  // An admin removing their own access would lock them out of this page.
  if (userId.data === admin.userId) {
    return { status: 'error', message: 'You cannot revoke your own access.' }
  }
  const protection = await protectAdminMutation(admin.userId!, userId.data)
  if (protection) return protection

  try {
    await revokeEntitlement(userId.data, admin.userId, 'Revoked by admin')
  } catch {
    return { status: 'error', message: 'Could not revoke access. Please try again.' }
  }

  revalidatePath('/admin')
  return { status: 'success', message: 'Access revoked.' }
}

/**
 * Links leads that carry no company yet.
 *
 * Maintenance, not user management: it changes no one's access, so it does not
 * go through `protectAdminMutation`. It is idempotent and safe to run
 * repeatedly — leads that already have a company are never selected.
 *
 * Bounded per invocation so it cannot outlive a function timeout. Run it again
 * while the result still reports remaining work.
 */
export async function backfillCompaniesAction(
  _prev: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const admin = await assertAdmin()

  const limit = await consume(ACTION_LIMITS.adminMutation, `admin:${admin.userId}`)
  if (!limit.allowed) {
    return { status: 'error', message: 'Too many admin changes. Please wait and try again.' }
  }

  let leadsLinked = 0
  let leadsUnidentified = 0
  let usersProcessed = 0
  let hasMore = false

  try {
    const scan = await listUsersWithUnlinkedLeads()

    // A truncated scan means accounts exist that were never enumerated. Saying
    // "finished" here is how a backfill silently skips whole accounts.
    hasMore = scan.truncated

    for (const userId of scan.userIds) {
      const result = await backfillCompaniesForUser(userId)
      leadsLinked += result.leadsLinked
      leadsUnidentified += result.leadsUnidentified
      usersProcessed += 1
      hasMore = hasMore || result.hasMore
    }
  } catch {
    return { status: 'error', message: 'Could not finish the backfill. Please try again.' }
  }

  await createAdminClient()
    .from('admin_audit_logs')
    .insert({
      admin_id: admin.userId,
      action: 'companies.backfill',
      target_type: 'companies',
      after_state: { usersProcessed, leadsLinked, leadsUnidentified, hasMore },
      reason: 'Company backfill run from the admin panel',
    })

  revalidatePath('/admin')
  return {
    status: 'success',
    message: hasMore
      ? `Linked ${leadsLinked} leads across ${usersProcessed} accounts. More remain — run it again.`
      : `Linked ${leadsLinked} leads across ${usersProcessed} accounts. ` +
        `${leadsUnidentified} carried no company to match.`,
  }
}

export async function suspendUserAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await assertAdmin()

  const userId = uuid.safeParse(formData.get('user_id'))
  if (!userId.success) return { status: 'error', message: 'Invalid user.' }
  if (userId.data === admin.userId) {
    return { status: 'error', message: 'You cannot suspend yourself.' }
  }
  const protection = await protectAdminMutation(admin.userId!, userId.data)
  if (protection) return protection

  const suspend = formData.get('suspend') === 'true'
  const supabase = createAdminClient()

  const { error } = await supabase.rpc('set_user_suspension', {
    p_user_id: userId.data,
    p_admin_id: admin.userId!,
    p_suspend: suspend,
  })

  if (error) return { status: 'error', message: 'Could not update that account.' }

  revalidatePath('/admin')
  return { status: 'success', message: suspend ? 'Account suspended.' : 'Account restored.' }
}
