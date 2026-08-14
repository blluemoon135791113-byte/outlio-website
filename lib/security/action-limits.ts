import type { RateLimitRule } from '@/lib/auth/rate-limit'

export const ACTION_LIMITS = {
  upload: { bucket: 'action:upload', maxAttempts: 30, windowSeconds: 10 * 60, blockSeconds: 15 * 60 },
  export: { bucket: 'action:export', maxAttempts: 60, windowSeconds: 10 * 60, blockSeconds: 15 * 60 },
  integration: { bucket: 'action:integration', maxAttempts: 20, windowSeconds: 10 * 60, blockSeconds: 15 * 60 },
  profile: { bucket: 'action:profile', maxAttempts: 20, windowSeconds: 60 * 60, blockSeconds: 30 * 60 },
  passwordChange: { bucket: 'auth:password-change', maxAttempts: 5, windowSeconds: 15 * 60, blockSeconds: 30 * 60 },
  adminMutation: { bucket: 'action:admin', maxAttempts: 40, windowSeconds: 10 * 60, blockSeconds: 15 * 60 },
  accountDeletion: { bucket: 'account:delete', maxAttempts: 3, windowSeconds: 60 * 60, blockSeconds: 60 * 60 },
  // Each attempt sends mail to an address the requester chose. Keep it tight so
  // the change-email flow cannot be used to send unsolicited mail.
  emailChange: { bucket: 'account:email-change', maxAttempts: 5, windowSeconds: 60 * 60, blockSeconds: 60 * 60 },
  subscriptionChange: { bucket: 'account:subscription', maxAttempts: 10, windowSeconds: 60 * 60, blockSeconds: 30 * 60 },
} as const satisfies Record<string, RateLimitRule>
