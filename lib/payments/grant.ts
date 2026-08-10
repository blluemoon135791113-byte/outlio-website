import 'server-only'

/**
 * THE single path to access.
 *
 * Every payment provider, the invitation flow, and the admin panel call these.
 * Nothing else may write `profiles.role`, `profiles.plan_id`, or
 * `profiles.access_expires_at`.
 *
 * The transactional work happens in Postgres (`grant_entitlement` /
 * `revoke_entitlement`) so the profile update, subscription row, request
 * resolution, and audit log either all apply or none do.
 */
import { REFERRAL_REWARD_CREDITS } from '@/lib/referrals/constants'
import { createAdminClient } from '@/lib/supabase/admin'

export type GrantEntitlementInput = {
  userId: string
  planId: string
  /** `null` means no expiry. */
  durationDays?: number | null
  /** Admin performing the grant, when there is one. */
  grantedBy?: string | null
  provider?: string
  providerRef?: string | null
  reason?: string | null
}

/** Returns the new subscription id. */
export async function grantEntitlement(
  input: GrantEntitlementInput,
): Promise<string> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('grant_entitlement', {
    p_user_id: input.userId,
    p_plan_id: input.planId,
    p_duration_days: input.durationDays ?? undefined,
    p_granted_by: input.grantedBy ?? undefined,
    p_provider: input.provider ?? 'manual',
    p_provider_ref: input.providerRef ?? undefined,
    p_reason: input.reason ?? undefined,
  })

  if (error) throw new Error(`grantEntitlement failed: ${concise(error.message)}`)

  /*
   * Referral payout point.
   *
   * Approval is the trigger because it is a human decision — paying out at
   * signup would let anyone farm credits from throwaway addresses. When real
   * payments land, move this call to the payment path; the SQL is indifferent
   * to what triggered it.
   *
   * Deliberately NOT inside grant_entitlement's transaction: a referral that
   * fails to pay out must never roll back somebody's access. It is idempotent,
   * so the next grant for the same user settles it.
   */
  try {
    await supabase.rpc('reward_pending_referral', {
      p_referred_user_id: input.userId,
      p_amount: REFERRAL_REWARD_CREDITS,
    })
  } catch {
    // Access is granted either way. The referral stays 'pending' and is
    // retried on the next grant.
  }

  return String(data)
}

export async function revokeEntitlement(
  userId: string,
  revokedBy?: string | null,
  reason?: string | null,
): Promise<void> {
  const supabase = createAdminClient()

  const { error } = await supabase.rpc('revoke_entitlement', {
    p_user_id: userId,
    p_revoked_by: revokedBy ?? undefined,
    p_reason: reason ?? undefined,
  })

  if (error) throw new Error(`revokeEntitlement failed: ${concise(error.message)}`)
}

export type RedeemResult = 'ok' | 'invalid' | 'unavailable' | 'already_active'

/**
 * Redeems an invitation code.
 *
 * Atomicity lives in the SQL function: a single UPDATE guarded by
 * `used_count < max_uses`, so a `max_uses = 1` code can be redeemed exactly
 * once even under concurrent requests.
 *
 * `invalid` and `unavailable` are distinguished for logs only — the UI shows
 * one generic message so this cannot become a code-enumeration oracle.
 */
export async function redeemInvitationCode(
  code: string,
  userId: string,
): Promise<RedeemResult> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('redeem_invitation_code', {
    p_code: code,
    p_user_id: userId,
  })

  if (error) throw new Error(`redeemInvitationCode failed: ${concise(error.message)}`)

  const result = String(data)
  if (
    result === 'ok' ||
    result === 'invalid' ||
    result === 'unavailable' ||
    result === 'already_active'
  ) {
    return result
  }
  throw new Error(`redeemInvitationCode returned an unexpected status`)
}

/**
 * Supabase surfaces upstream failures with the origin's HTML body as the error
 * message. Never let that reach a log line or a response intact.
 */
function concise(message: string): string {
  const firstLine = message.split('\n')[0]?.trim() ?? ''
  const stripped = firstLine.startsWith('<') ? 'upstream returned HTML' : firstLine
  return stripped.length > 120 ? `${stripped.slice(0, 120)}…` : stripped
}
