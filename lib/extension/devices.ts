import 'server-only'

/**
 * Connected device queries for the dashboard and admin panel.
 *
 * Revocation is the user-facing security control for this whole feature: if a
 * laptop is lost or an install is no longer wanted, this is how access stops.
 * It must therefore be immediate rather than eventual — `revoke_extension_device`
 * nulls the access-token jti as well as the refresh hash, so a token already in
 * flight dies on its next request instead of lasting out its 15 minutes.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import type { CaptureSessionRow } from '@/types/database'

export type ConnectedDevice = {
  id: string
  label: string
  browser: string | null
  platform: string | null
  connectedAt: string
  lastActiveAt: string | null
}

export async function listDevices(userId: string): Promise<ConnectedDevice[]> {
  const admin = createAdminClient()

  const { data } = await admin
    .from('extension_devices')
    .select('id, label, browser, platform, created_at, last_active_at')
    // Service role bypasses RLS — scoping by user_id is mandatory.
    .eq('user_id', userId)
    .eq('enabled', true)
    .is('revoked_at', null)
    .order('last_active_at', { ascending: false, nullsFirst: false })

  return (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    browser: row.browser,
    platform: row.platform,
    connectedAt: row.created_at,
    lastActiveAt: row.last_active_at,
  }))
}

export async function countDevices(userId: string): Promise<number> {
  const admin = createAdminClient()
  const { count } = await admin
    .from('extension_devices')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('enabled', true)
    .is('revoked_at', null)

  return count ?? 0
}

/** Revokes one device. Returns false when it was already gone. */
export async function revokeDevice(
  userId: string,
  deviceId: string,
  actorId: string | null = null,
): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('revoke_extension_device', {
    p_device_id: deviceId,
    p_user_id: userId,
    p_actor_id: actorId,
  })

  if (error) return false
  return data === true
}

export async function revokeAllDevices(
  userId: string,
  actorId: string | null = null,
): Promise<number> {
  const devices = await listDevices(userId)
  let revoked = 0

  for (const device of devices) {
    if (await revokeDevice(userId, device.id, actorId)) revoked += 1
  }

  return revoked
}

export type CaptureHistoryEntry = CaptureSessionRow

/** Recent capture sessions, newest first, for the dashboard history list. */
export async function listCaptureSessions(
  userId: string,
  limit = 10,
): Promise<CaptureHistoryEntry[]> {
  const admin = createAdminClient()

  const { data } = await admin
    .from('capture_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit)

  return (data ?? []) as CaptureHistoryEntry[]
}
