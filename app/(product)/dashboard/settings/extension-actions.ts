'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { assertUser } from '@/lib/auth/access'
import { revokeAllDevices, revokeDevice } from '@/lib/extension/devices'
import { recordSecurityEvent } from '@/lib/security/events'

/**
 * Device revocation.
 *
 * `assertUser` rather than `assertAccess`: someone whose subscription has
 * lapsed must still be able to disconnect a browser. Taking away the ability
 * to revoke access at the moment a user most wants it would be backwards.
 *
 * Ownership is enforced by passing the SESSION's user id into the query
 * rather than trusting an id from the form. A device id from another account
 * simply matches nothing.
 */
const revokeSchema = z.object({ deviceId: z.string().uuid() })

export type RevokeResult = { ok: boolean; message: string }

export async function revokeDeviceAction(
  raw: z.input<typeof revokeSchema>,
): Promise<RevokeResult> {
  const ctx = await assertUser()
  const userId = ctx.userId!

  const parsed = revokeSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, message: 'That device could not be found.' }
  }

  const revoked = await revokeDevice(userId, parsed.data.deviceId, userId)

  if (!revoked) {
    return { ok: false, message: 'That browser was already disconnected.' }
  }

  await recordSecurityEvent({
    event: 'device.revoked',
    userId,
    context: { device_id: parsed.data.deviceId, by: 'user' },
  })

  revalidatePath('/dashboard/settings')
  return { ok: true, message: 'Browser disconnected.' }
}

export async function revokeAllDevicesAction(): Promise<RevokeResult> {
  const ctx = await assertUser()
  const userId = ctx.userId!

  const count = await revokeAllDevices(userId, userId)

  await recordSecurityEvent({
    event: 'device.revoked',
    userId,
    context: { count, by: 'user', scope: 'all' },
  })

  revalidatePath('/dashboard/settings')

  return {
    ok: true,
    message:
      count === 0
        ? 'No connected browsers to disconnect.'
        : `Disconnected ${count} browser${count === 1 ? '' : 's'}.`,
  }
}
