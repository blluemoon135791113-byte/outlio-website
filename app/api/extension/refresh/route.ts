/**
 * POST /api/extension/refresh — rotate a refresh token.
 *
 * Rotation with REUSE DETECTION. Each refresh replaces the stored hash, so a
 * token is valid exactly once. If a spent token is presented again there are
 * only two explanations — a copy is in circulation, or the legitimate client
 * lost the response — and neither is safe to serve. The device is revoked and
 * the user reconnects.
 *
 * That costs an occasional reconnect after a dropped response, and buys a hard
 * ceiling on how long a stolen token is useful.
 */
import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import { RULES, consume } from '@/lib/auth/rate-limit'
import {
  REFRESH_TOKEN_TTL_SECONDS,
  hashToken,
  mintAccessToken,
  mintRefreshToken,
} from '@/lib/extension/tokens'
import { recordSecurityEvent } from '@/lib/security/events'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const bodySchema = z.object({
  refreshToken: z.string().min(16).max(512),
  deviceId: z.string().uuid(),
})

export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 })
  }

  const limit = await consume(RULES.extensionRefresh, `device:${body.deviceId}`)
  if (!limit.allowed) {
    return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 })
  }

  const presentedHash = hashToken(body.refreshToken)
  if (!presentedHash) {
    return NextResponse.json({ error: 'SERVER_MISCONFIGURED' }, { status: 500 })
  }

  const admin = createAdminClient()

  const { data: device } = await admin
    .from('extension_devices')
    .select('id, user_id, refresh_token_hash, enabled, revoked_at, created_at')
    .eq('id', body.deviceId)
    .maybeSingle()

  if (!device || !device.enabled || device.revoked_at) {
    return NextResponse.json({ error: 'DEVICE_REVOKED' }, { status: 401 })
  }

  // Reuse detection: a valid-looking device whose stored hash no longer
  // matches means this token was already spent.
  if (device.refresh_token_hash !== presentedHash) {
    await admin.rpc('revoke_extension_device', {
      p_device_id: device.id,
      p_user_id: device.user_id,
    })

    await recordSecurityEvent({
      event: 'extension.auth.failed',
      level: 'error',
      userId: device.user_id,
      context: { reason: 'refresh_token_reuse', device_id: device.id },
    })

    return NextResponse.json({ error: 'DEVICE_REVOKED' }, { status: 401 })
  }

  // Absolute lifetime: rotation alone would let a device live forever.
  const age = Date.now() - new Date(device.created_at).getTime()
  if (age > REFRESH_TOKEN_TTL_SECONDS * 1000) {
    await admin.rpc('revoke_extension_device', {
      p_device_id: device.id,
      p_user_id: device.user_id,
    })
    return NextResponse.json({ error: 'DEVICE_REVOKED' }, { status: 401 })
  }

  const nextRefresh = mintRefreshToken()
  const nextHash = hashToken(nextRefresh)
  const jti = randomUUID()

  if (!nextHash) {
    return NextResponse.json({ error: 'SERVER_MISCONFIGURED' }, { status: 500 })
  }

  // Conditional on the OLD hash, so two concurrent refreshes cannot both
  // succeed and leave two live tokens.
  const { data: rotated } = await admin
    .from('extension_devices')
    .update({
      refresh_token_hash: nextHash,
      access_token_jti: jti,
      last_active_at: new Date().toISOString(),
    })
    .eq('id', device.id)
    .eq('refresh_token_hash', presentedHash)
    .select('id')
    .maybeSingle()

  if (!rotated) {
    return NextResponse.json({ error: 'DEVICE_REVOKED' }, { status: 401 })
  }

  const accessToken = mintAccessToken(device.user_id, device.id, jti)
  if (!accessToken) {
    return NextResponse.json({ error: 'SERVER_MISCONFIGURED' }, { status: 500 })
  }

  return NextResponse.json({ accessToken, refreshToken: nextRefresh })
}
