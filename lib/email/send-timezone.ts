/**
 * Whose clock a sending window is measured in — §5.7's fallback chain.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  §5.7: "Sending windows evaluate in `contact.timezone` when known, else   ║
 * ║  campaign timezone, else workspace timezone."                            ║
 * ║                                                                           ║
 * ║  Only the last of those three was ever consulted. `scheduleOf` took the    ║
 * ║  mailbox's zone unconditionally, so a 09:00–17:00 window meant nine in the ║
 * ║  MAILBOX's morning — which is the middle of the night for a recipient      ║
 * ║  eight hours away, and the customer had configured a window specifically   ║
 * ║  to avoid that.                                                           ║
 * ║                                                                           ║
 * ║  `crm_contacts.timezone` landed in migration 0121 and nothing read it.    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THE SOURCE IS RETURNED ALONGSIDE THE ZONE, AND THAT IS NOT DECORATION.
 * §4.8 requires the fallback to be shown EXPLICITLY when the recipient's zone
 * is unknown — a window silently evaluated in somebody else's clock looks
 * identical to one evaluated in theirs, and the difference is eight hours.
 */

export type TimezoneSource = 'contact' | 'campaign' | 'account'

export type ResolvedSendTimezone = {
  timezone: string
  source: TimezoneSource
}

/**
 * ⚠️ A BLANK STRING IS NOT A TIMEZONE, AND NEITHER IS WHITESPACE.
 *
 * `crm_contacts.timezone` is free text behind a shape check, and a column that
 * can be written by an import is a column that will eventually contain `''`.
 * Treating that as "known" would hand `zonedParts` a value it cannot resolve,
 * and the failure would surface as an unusable schedule on a send rather than
 * as the missing data it is.
 */
function usable(zone: string | null | undefined): zone is string {
  return typeof zone === 'string' && zone.trim().length > 0
}

/**
 * Which clock this message's sending window is measured in.
 *
 * ⚠️ THE ACCOUNT IS THE FLOOR AND CANNOT BE ABSENT. A mailbox always has a
 * timezone (`email_accounts.timezone` is not null), which is what makes this
 * total — there is no fourth branch where nothing is known and the caller has
 * to invent one.
 */
export function resolveSendTimezone(input: {
  contactTimezone?: string | null
  campaignTimezone?: string | null
  accountTimezone: string
}): ResolvedSendTimezone {
  if (usable(input.contactTimezone)) {
    return { timezone: input.contactTimezone.trim(), source: 'contact' }
  }
  if (usable(input.campaignTimezone)) {
    return { timezone: input.campaignTimezone.trim(), source: 'campaign' }
  }
  return { timezone: input.accountTimezone, source: 'account' }
}

/**
 * What a reader should be told about a schedule computed this way.
 *
 * ⚠️ IT NAMES THE FALLBACK RATHER THAN HIDING IT. "Sending 09:00–17:00" is the
 * same sentence whether that is the recipient's morning or a stranger's, and
 * the customer chose a window precisely because those differ.
 */
export function describeSendTimezone(resolved: ResolvedSendTimezone): string {
  switch (resolved.source) {
    case 'contact':
      return `in the recipient's timezone (${resolved.timezone})`
    case 'campaign':
      return `in the campaign's timezone (${resolved.timezone}) — this contact's own timezone is not known`
    case 'account':
      return `in the mailbox's timezone (${resolved.timezone}) — neither the contact nor the campaign has one set`
  }
}
