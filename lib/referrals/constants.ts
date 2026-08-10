/**
 * Referral rewards.
 *
 * THE single source of this number. The SQL function takes it as an argument
 * rather than defaulting it, so changing it here changes both the payout and
 * every piece of copy — there is no second place to forget.
 */
export const REFERRAL_REWARD_CREDITS = 20

/** Query parameter that carries a code onto the sign-up page. */
export const REFERRAL_PARAM = 'ref'

/** Codes are 8 characters from an alphabet with no look-alikes. */
export function normalizeReferralCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

export function referralLink(origin: string, code: string): string {
  return `${origin}/sign-up?${REFERRAL_PARAM}=${encodeURIComponent(code)}`
}
