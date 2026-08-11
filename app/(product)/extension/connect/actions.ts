'use server'

import { z } from 'zod'

import { assertAccess } from '@/lib/auth/access'
import { RULES, consume } from '@/lib/auth/rate-limit'
import { createPairing } from '@/lib/extension/pairing'
import { recordSecurityEvent } from '@/lib/security/events'

/**
 * Issues a pairing code for the signed-in user.
 *
 * `assertAccess` — not `assertUser` — because a code should only exist for
 * someone who could actually capture. Handing a token to an account with no
 * entitlement just moves the rejection later, to a point where the user has
 * already installed and connected and thinks it works.
 */
const inputSchema = z.object({
  state: z.string().min(8).max(256),
  label: z.string().min(1).max(80),
  browser: z.string().max(40).nullable(),
  platform: z.string().max(40).nullable(),
})

export type PairingResult =
  | { ok: true; code: string }
  | { ok: false; message: string }

export async function createPairingAction(
  raw: z.input<typeof inputSchema>,
): Promise<PairingResult> {
  const ctx = await assertAccess()
  const userId = ctx.userId!

  const parsed = inputSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, message: 'That connection request was not valid.' }
  }

  const limit = await consume(RULES.extensionPair, `user:${userId}`)
  if (!limit.allowed) {
    return {
      ok: false,
      message: 'Too many connection attempts. Wait a few minutes and try again.',
    }
  }

  try {
    const code = await createPairing({
      userId,
      state: parsed.data.state,
      label: parsed.data.label,
      browser: parsed.data.browser,
      platform: parsed.data.platform,
    })

    await recordSecurityEvent({
      event: 'extension.auth.connected',
      userId,
      context: { stage: 'code_issued', browser: parsed.data.browser },
    })

    return { ok: true, code }
  } catch {
    return { ok: false, message: 'We could not start the connection. Please try again.' }
  }
}
