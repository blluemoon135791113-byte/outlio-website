/**
 * POST /api/extension/pair — exchange a one-time code for a token pair.
 *
 * The code was minted by the signed-in web session on /extension/connect and
 * lives for 60 seconds. It is single use: consuming it inside a conditional
 * update means two racing requests cannot both win.
 *
 * This is an UNAUTHENTICATED route by necessity — the extension has no
 * credentials yet. The code itself is the credential, which is why it is
 * short-lived, hashed at rest, and bound to the `state` the extension chose.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { RULES, consume, subjectFor } from '@/lib/auth/rate-limit'
import {
  REFRESH_TOKEN_TTL_SECONDS,
  hashToken,
  mintAccessToken,
  mintRefreshToken,
} from '@/lib/extension/tokens'
import { recordSecurityEvent } from '@/lib/security/events'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'

const bodySchema = z.object({
  code: z.string().min(16).max(256),
  state: z.string().min(8).max(256),
})

function clientIp(request: Request): string | null {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? null
  )
}

export async function POST(request: Request) {
  const limit = await consume(RULES.extensionPair, subjectFor(clientIp(request)))
  if (!limit.allowed) {
    return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 })
  }

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 })
  }

  const codeHash = hashToken(body.code)
  if (!codeHash) {
    return NextResponse.json({ error: 'SERVER_MISCONFIGURED' }, { status: 500 })
  }

  const admin = createAdminClient()

  // Consume inside the update: `.is('consumed_at', null)` makes this
  // single-use even under concurrency, without a separate read.
  const { data: pairing } = await admin
    .from('extension_pairings')
    .update({ consumed_at: new Date().toISOString() })
    .eq('code_hash', codeHash)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('*')
    .maybeSingle()

  if (!pairing) {
    await recordSecurityEvent({
      event: 'extension.auth.failed',
      level: 'warn',
      context: { reason: 'code_invalid_or_expired' },
    })
    return NextResponse.json({ error: 'PAIRING_INVALID' }, { status: 400 })
  }

  // CSRF: the extension generated `state` and kept it locally. A code
  // intercepted from the callback URL is useless without it.
  if (pairing.state !== body.state) {
    await recordSecurityEvent({
      event: 'extension.auth.failed',
      level: 'warn',
      userId: pairing.user_id,
      context: { reason: 'state_mismatch' },
    })
    return NextResponse.json({ error: 'STATE_MISMATCH' }, { status: 400 })
  }

  const refreshToken = mintRefreshToken()
  const refreshHash = hashToken(refreshToken)
  const jti = randomUUID()

  if (!refreshHash) {
    return NextResponse.json({ error: 'SERVER_MISCONFIGURED' }, { status: 500 })
  }

  const { data: device, error: deviceError } = await admin
    .from('extension_devices')
    .insert({
      user_id: pairing.user_id,
      label: pairing.label ?? 'Browser extension',
      browser: pairing.browser,
      platform: pairing.platform,
      refresh_token_hash: refreshHash,
      access_token_jti: jti,
      enabled: true,
      last_active_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (deviceError || !device) {
    return NextResponse.json({ error: 'PAIRING_FAILED' }, { status: 500 })
  }

  const accessToken = mintAccessToken(pairing.user_id, device.id, jti)
  if (!accessToken) {
    return NextResponse.json({ error: 'SERVER_MISCONFIGURED' }, { status: 500 })
  }

  await recordSecurityEvent({
    event: 'extension.auth.connected',
    userId: pairing.user_id,
    context: { device_id: device.id, browser: pairing.browser ?? null },
  })

  return NextResponse.json({
    accessToken,
    refreshToken,
    deviceId: device.id,
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
  })
}
