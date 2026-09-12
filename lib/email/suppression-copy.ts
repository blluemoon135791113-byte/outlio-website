/**
 * Suppression types and the copy shown when removing one.
 *
 * ⚠️ SEPARATE FROM `suppressions.ts`, AND NOT FOR TIDINESS. That module is
 * `server-only` because it queries with the service role. The list component
 * is a Client Component and needs the reason labels, so importing them from
 * there dragged `server-only` into the browser bundle and failed the build:
 *
 *   You're importing a module that depends on "server-only".
 *
 * Types and strings cross the boundary; queries do not.
 */

export type SuppressionReason =
  | 'unsubscribed'
  | 'hard_bounce'
  | 'complaint'
  | 'manual'
  | 'invalid_address'

export type Suppression = {
  id: string
  email: string
  reason: SuppressionReason
  /** Free text from whatever created it — a bounce string, or a person's note. */
  source: string | null
  createdAt: string
}

/**
 * ⚠️ HOW EACH ONE GOT THERE, IN THE WORDS SOMEONE REMOVING IT NEEDS.
 *
 * Un-suppressing a `hard_bounce` is a different act from un-suppressing someone
 * who changed their mind: one is a delivery fact that will simply recur, the
 * other is consent. A single generic "are you sure?" flattens that distinction
 * at exactly the moment it matters.
 */
export const REASON_COPY: Record<SuppressionReason, { label: string; removal: string }> = {
  unsubscribed: {
    label: 'Unsubscribed',
    removal:
      'They asked to stop receiving email. Only remove this if they have asked to be added back.',
  },
  hard_bounce: {
    label: 'Bounced',
    removal:
      'Mail to this address was rejected permanently. Removing this will not fix the address — it will bounce again and cost you reputation.',
  },
  complaint: {
    label: 'Marked as spam',
    removal:
      'They reported a message as spam. Mailing them again risks your sending domain.',
  },
  manual: {
    label: 'Added by hand',
    removal: 'Someone on your team added this address.',
  },
  invalid_address: {
    label: 'Invalid address',
    removal: 'The address is not deliverable in its current form.',
  },
}
