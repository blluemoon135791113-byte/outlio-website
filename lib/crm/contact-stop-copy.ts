/**
 * Do-not-contact scopes, reasons, and the words a person reads.
 *
 * ⚠️ SEPARATE FROM `contact-stop.ts`, AND NOT FOR TIDINESS. That module is
 * `server-only` because it queries with the service role. The panel that marks
 * a contact is a Client Component and needs the option lists, so importing them
 * from there dragged `server-only` into the browser bundle and failed the
 * build:
 *
 *   'server-only' cannot be imported from a Client Component module
 *
 * `lib/email/suppression-copy.ts` exists for exactly this reason and carries
 * exactly this warning. This is its CRM counterpart — types and strings cross
 * the boundary; queries do not.
 */

/** Which channel is asking, and which a stop applies to. */
export type StopChannel = 'email' | 'linkedin'

/** The scopes a person can be marked under, for a form to offer. */
export const STOP_SCOPES = ['all', 'email', 'linkedin'] as const
export type StopScope = (typeof STOP_SCOPES)[number]

/**
 * Why somebody was marked.
 *
 * ⚠️ `unsubscribed` IS ABSENT ON PURPOSE. That reason belongs to the address
 * list, where it records something the RECIPIENT did by clicking a link.
 * Letting a teammate file a manual note under it would forge consent
 * provenance — the record would claim the person opted out themselves, which is
 * a stronger and legally different fact than a colleague writing it down.
 */
export const STOP_REASONS = [
  'not_interested',
  'explicit_request',
  'hostile',
  'privacy_request',
  'manual',
] as const
export type StopReason = (typeof STOP_REASONS)[number]

/**
 * ⚠️ WORDS A PERSON WOULD SAY, NOT THE ENUM. `hostile` rendered in a panel
 * reads as a judgement of the contact; "asked us to stop, firmly" is what
 * actually happened and is what the next person needs in order to decide how
 * carefully to tread. The stored value is unchanged — this is only how it is
 * read out.
 *
 * `unsubscribed` is here although it cannot be CHOSEN: a stop can still be
 * displayed with that reason when it came from the address list.
 */
export const STOP_REASON_LABEL: Record<string, string> = {
  not_interested: 'Not interested',
  explicit_request: 'Asked not to be contacted',
  hostile: 'Asked us to stop, firmly',
  privacy_request: 'Privacy request',
  manual: 'Added by a teammate',
  unsubscribed: 'Unsubscribed',
  hard_bounce: 'Address bounced',
  complaint: 'Marked as spam',
}

/** "Every channel" / "Email only" — the scope as a person reads it. */
export const STOP_SCOPE_LABEL: Record<StopScope, string> = {
  all: 'Every channel',
  email: 'Email only',
  linkedin: 'LinkedIn only',
}
