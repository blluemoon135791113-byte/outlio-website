'use server'

/**
 * Admin controls for the browser extension.
 *
 * EVERY action calls assertAdmin() first, matching `lib/admin/actions.ts`, and
 * every state change writes an admin_audit_logs row. Extension access is a
 * capability that can be taken away without touching billing, so the record of
 * who removed it and when has to exist.
 */
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { assertAdmin } from '@/lib/auth/access'
import type { Json } from '@/types/database'
import { ACTION_LIMITS } from '@/lib/security/action-limits'
import { consume } from '@/lib/auth/rate-limit'
import { revokeAllDevices, revokeDevice } from '@/lib/extension/devices'
import { createAdminClient } from '@/lib/supabase/admin'

export type AdminActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string }

const uuid = z.string().uuid()

async function audit(input: {
  adminId: string | null
  action: string
  targetUserId: string
  targetId?: string | null
  before?: Json | null
  after?: Json | null
  reason?: string
}): Promise<void> {
  await createAdminClient().from('admin_audit_logs').insert({
    admin_id: input.adminId,
    action: input.action,
    target_type: 'extension',
    target_id: input.targetId ?? null,
    target_user_id: input.targetUserId,
    before_state: input.before ?? null,
    after_state: input.after ?? null,
    reason: input.reason ?? null,
  })
}

/**
 * Enables or disables extension access for one user.
 *
 * Independent of subscription on purpose: abuse should be stoppable without
 * cancelling someone's billing, and billing should lapse without an admin
 * having to remember to also flip this.
 */
export async function setExtensionAccessAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await assertAdmin()

  const userId = uuid.safeParse(formData.get('user_id'))
  if (!userId.success) return { status: 'error', message: 'Invalid user.' }

  const enabled = String(formData.get('enabled') ?? '') === 'true'

  const limit = await consume(ACTION_LIMITS.adminMutation, `admin:${admin.userId}`)
  if (!limit.allowed) {
    return { status: 'error', message: 'Too many admin changes. Please wait and try again.' }
  }

  const db = createAdminClient()

  const { data: before } = await db
    .from('profiles')
    .select('extension_enabled')
    .eq('id', userId.data)
    .maybeSingle()

  if (!before) return { status: 'error', message: 'That account could not be found.' }

  const { error } = await db
    .from('profiles')
    .update({ extension_enabled: enabled })
    .eq('id', userId.data)

  if (error) return { status: 'error', message: 'Could not update extension access.' }

  // Disabling should take effect now, not whenever the token happens to
  // expire, so connected browsers are cut off in the same operation.
  let revoked = 0
  if (!enabled) {
    revoked = await revokeAllDevices(userId.data, admin.userId)
  }

  await audit({
    adminId: admin.userId,
    action: enabled ? 'extension.enabled' : 'extension.disabled',
    targetUserId: userId.data,
    before: { extension_enabled: before.extension_enabled },
    after: { extension_enabled: enabled, devices_revoked: revoked },
  })

  revalidatePath('/admin')

  return {
    status: 'success',
    message: enabled
      ? 'Extension access enabled.'
      : `Extension access disabled${revoked > 0 ? ` and ${revoked} browser${revoked === 1 ? '' : 's'} disconnected` : ''}.`,
  }
}

export async function adminRevokeDeviceAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await assertAdmin()

  const userId = uuid.safeParse(formData.get('user_id'))
  const deviceId = uuid.safeParse(formData.get('device_id'))
  if (!userId.success || !deviceId.success) {
    return { status: 'error', message: 'Invalid device.' }
  }

  const limit = await consume(ACTION_LIMITS.adminMutation, `admin:${admin.userId}`)
  if (!limit.allowed) {
    return { status: 'error', message: 'Too many admin changes. Please wait and try again.' }
  }

  const revoked = await revokeDevice(userId.data, deviceId.data, admin.userId)
  if (!revoked) return { status: 'error', message: 'That browser was already disconnected.' }

  await audit({
    adminId: admin.userId,
    action: 'device.revoked',
    targetUserId: userId.data,
    targetId: deviceId.data,
    after: { by: 'admin' },
  })

  revalidatePath('/admin')
  return { status: 'success', message: 'Browser disconnected.' }
}

export async function adminRevokeAllDevicesAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await assertAdmin()

  const userId = uuid.safeParse(formData.get('user_id'))
  if (!userId.success) return { status: 'error', message: 'Invalid user.' }

  const limit = await consume(ACTION_LIMITS.adminMutation, `admin:${admin.userId}`)
  if (!limit.allowed) {
    return { status: 'error', message: 'Too many admin changes. Please wait and try again.' }
  }

  const count = await revokeAllDevices(userId.data, admin.userId)

  await audit({
    adminId: admin.userId,
    action: 'device.revoked',
    targetUserId: userId.data,
    after: { by: 'admin', scope: 'all', count },
  })

  revalidatePath('/admin')
  return {
    status: 'success',
    message: count === 0 ? 'No connected browsers.' : `Disconnected ${count} browser${count === 1 ? '' : 's'}.`,
  }
}

export type ExtensionUsage = {
  devices: number
  sessions: number
  pagesProcessed: number
  leadsImported: number
  lastActiveAt: string | null
}

/** Read-only summary for the admin table. Still admin-gated. */
export async function getExtensionUsage(userId: string): Promise<ExtensionUsage> {
  await assertAdmin()

  const db = createAdminClient()

  const [{ count: devices }, { data: sessions }, { data: device }] = await Promise.all([
    db
      .from('extension_devices')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('enabled', true)
      .is('revoked_at', null),
    db
      .from('capture_sessions')
      .select('pages_processed, leads_imported')
      .eq('user_id', userId),
    db
      .from('extension_devices')
      .select('last_active_at')
      .eq('user_id', userId)
      .order('last_active_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ])

  const rows = sessions ?? []

  return {
    devices: devices ?? 0,
    sessions: rows.length,
    pagesProcessed: rows.reduce((sum, r) => sum + (r.pages_processed ?? 0), 0),
    leadsImported: rows.reduce((sum, r) => sum + (r.leads_imported ?? 0), 0),
    lastActiveAt: device?.last_active_at ?? null,
  }
}
