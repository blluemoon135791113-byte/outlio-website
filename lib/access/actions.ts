'use server'

/**
 * Access request flow (spec §9.2).
 *
 * Four options: purchase access, request a sales call, request manual approval,
 * redeem an invitation code.
 *
 * Every action re-verifies the caller server-side. Nothing here trusts a
 * client-supplied user id.
 */
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'

import { assertUser } from '@/lib/auth/access'
import { consume, subjectFor, type RateLimitRule } from '@/lib/auth/rate-limit'
import { redeemInvitationCode } from '@/lib/payments/grant'
import { getPaymentProvider } from '@/lib/payments/registry'
import { createAdminClient } from '@/lib/supabase/admin'

export type AccessActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string }

/** Redemption is guessing-sensitive, so it gets its own tighter bucket. */
const REDEEM_RULE: RateLimitRule = {
  bucket: 'access:redeem',
  maxAttempts: 5,
  windowSeconds: 15 * 60,
  blockSeconds: 30 * 60,
}

const REQUEST_RULE: RateLimitRule = {
  bucket: 'access:request',
  maxAttempts: 10,
  windowSeconds: 60 * 60,
  blockSeconds: 60 * 60,
}

async function clientIp(): Promise<string | null> {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null
  return h.get('x-real-ip')
}

const messageSchema = z.string().trim().max(2000).optional()

// ---------------------------------------------------------------------------
// Request manual approval / a sales call / a trial
// ---------------------------------------------------------------------------

const REQUEST_TYPES = ['manual_approval', 'sales_call', 'trial'] as const
type RequestType = (typeof REQUEST_TYPES)[number]

export async function submitAccessRequestAction(
  _prev: AccessActionState,
  formData: FormData,
): Promise<AccessActionState> {
  const ctx = await assertUser()

  const rawType = String(formData.get('request_type') ?? '')
  if (!REQUEST_TYPES.includes(rawType as RequestType)) {
    return { status: 'error', message: 'Choose how you would like to get access.' }
  }
  const requestType = rawType as RequestType

  const parsedMessage = messageSchema.safeParse(formData.get('message') ?? undefined)
  if (!parsedMessage.success) {
    return { status: 'error', message: 'That message is too long.' }
  }

  const limit = await consume(REQUEST_RULE, subjectFor(await clientIp(), ctx.email))
  if (!limit.allowed) {
    return { status: 'error', message: 'Too many requests. Please wait and try again.' }
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('access_requests').insert({
    // Service role bypasses RLS — the id comes from the verified session only.
    user_id: ctx.userId!,
    request_type: requestType,
    status: 'pending',
    message: parsedMessage.data || null,
  })

  // 23505 = a pending request already exists. Treat as success: the user's
  // intent is recorded and nagging them about it helps nobody.
  if (error && error.code !== '23505') {
    return {
      status: 'error',
      message: 'We could not submit your request. Please try again.',
    }
  }

  // Reflect 'pending' on the profile so the access page reads correctly.
  await supabase
    .from('profiles')
    .update({ role: 'pending_user' })
    .eq('id', ctx.userId!)
    .eq('role', 'registered_user')

  revalidatePath('/dashboard/access')
  return {
    status: 'success',
    message: "Request received. We'll email you once it has been reviewed.",
  }
}

// ---------------------------------------------------------------------------
// Purchase access — routed through the configured payment provider
// ---------------------------------------------------------------------------

export async function startCheckoutAction(
  _prev: AccessActionState,
  formData: FormData,
): Promise<AccessActionState> {
  const ctx = await assertUser()

  const planId = z.string().uuid().safeParse(formData.get('plan_id'))
  if (!planId.success) return { status: 'error', message: 'Choose a valid plan.' }

  const limit = await consume(REQUEST_RULE, subjectFor(await clientIp(), ctx.email))
  if (!limit.allowed) {
    return { status: 'error', message: 'Too many requests. Please wait and try again.' }
  }

  try {
    const provider = getPaymentProvider()
    const result = await provider.createCheckout({
      userId: ctx.userId!,
      planId: planId.data,
      email: ctx.email ?? '',
      returnUrl: '/dashboard',
    })

    if ('manual' in result) {
      revalidatePath('/dashboard/access')
      return {
        status: 'success',
        message:
          'Thanks — our team will contact you with payment details shortly.',
      }
    }

    return { status: 'success', message: result.url }
  } catch {
    // Includes NotConfiguredError from an unconfigured provider.
    return {
      status: 'error',
      message: 'Payment is not available right now. Please request manual approval instead.',
    }
  }
}

// ---------------------------------------------------------------------------
// Redeem an invitation code
// ---------------------------------------------------------------------------

const codeSchema = z
  .string()
  .trim()
  .min(6, 'That code does not look right.')
  .max(64, 'That code does not look right.')

/**
 * One message for both `invalid` and `unavailable`.
 *
 * Distinguishing "no such code" from "already used" would turn this into a
 * code-enumeration oracle. The distinction is preserved in logs only.
 */
const GENERIC_CODE_ERROR =
  'That code is not valid, or has already been used. Check it and try again.'

export async function redeemCodeAction(
  _prev: AccessActionState,
  formData: FormData,
): Promise<AccessActionState> {
  const ctx = await assertUser()

  const parsed = codeSchema.safeParse(formData.get('code'))
  if (!parsed.success) {
    return { status: 'error', message: GENERIC_CODE_ERROR }
  }

  const limit = await consume(REDEEM_RULE, subjectFor(await clientIp(), ctx.email))
  if (!limit.allowed) {
    return {
      status: 'error',
      message: 'Too many attempts. Please wait before trying another code.',
    }
  }

  const result = await redeemInvitationCode(parsed.data, ctx.userId!)

  if (result === 'already_active') {
    return { status: 'error', message: 'Your account already has access.' }
  }
  if (result !== 'ok') {
    return { status: 'error', message: GENERIC_CODE_ERROR }
  }

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/access')
  return { status: 'success', message: 'Code accepted — your access is active.' }
}

/**
 * Whether the invitation option should be shown at all.
 *
 * Async because every export from a `'use server'` module must be an async
 * function — Next treats each one as a callable Server Action.
 */
export async function invitationsEnabled(): Promise<boolean> {
  return process.env.INVITATIONS_ENABLED === 'true'
}
