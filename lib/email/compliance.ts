import 'server-only'

/**
 * What every commercial message must carry before it leaves the building.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  PHASE 0 FINDING #2. ALL THREE PIECES WERE MISSING AT ONCE, AND EVERY     ║
 * ║  TEST PASSED.                                                            ║
 * ║                                                                           ║
 * ║   • `unsubscribeHeaders()` built `List-Unsubscribe` correctly and was     ║
 * ║     called by nothing.                                                    ║
 * ║   • `shouldIncludeUnsubscribe()` decided who gets it and was called by    ║
 * ║     nothing.                                                              ║
 * ║   • `OutboundMessage` had no `headers` field, so neither COULD be called. ║
 * ║   • No unsubscribe link was written into any body.                        ║
 * ║   • The string "postal address" did not appear in the codebase.           ║
 * ║                                                                           ║
 * ║  The landing page at /u/[token] existed and worked the whole time. The    ║
 * ║  exit door was built and no message told the recipient where it was.      ║
 * ║                                                                           ║
 * ║  ⚠️ THIS MODULE IS THE ONE PLACE THAT DECIDES. Assembling the footer at   ║
 * ║  each call site is how one of them ends up without it — and the one       ║
 * ║  without it is the one that gets reported as spam.                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { shouldIncludeUnsubscribe, type CampaignType } from '@/lib/email/campaign-policy'
import {
  unsubscribeHeaders,
  unsubscribeUrl,
  type UnsubscribeSubject,
} from '@/lib/email/unsubscribe'

export type ComplianceInput = {
  subject: UnsubscribeSubject
  campaignType: CampaignType
  baseUrl: string
  /** From `workspaces.sender_postal_address`. Null when the owner has not set one. */
  postalAddress: string | null
  bodyText: string
  bodyHtml: string | null
}

export type ComplianceResult = {
  headers: Record<string, string>
  bodyText: string
  bodyHtml: string | null
}

/** Minimal HTML escaping for the footer, which interpolates operator-set text. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Attach the headers and footer a commercial message is required to carry.
 *
 * ⚠️ A `manual` message is returned UNTOUCHED. One person typing to one person
 * is not bulk mail; appending "unsubscribe from this list" to a hand-written
 * reply is both wrong and faintly insulting. `shouldIncludeUnsubscribe` owns
 * that judgement and this function does not second-guess it.
 */
export function applyCompliance(input: ComplianceInput): ComplianceResult {
  if (!shouldIncludeUnsubscribe(input.campaignType)) {
    return { headers: {}, bodyText: input.bodyText, bodyHtml: input.bodyHtml }
  }

  const url = unsubscribeUrl(input.subject, input.baseUrl)
  const headers = unsubscribeHeaders(input.subject, input.baseUrl)

  /*
   * ⚠️ THE HEADER IS NOT ENOUGH ON ITS OWN, WHICH IS WHY THE FOOTER IS HERE
   * TOO. `List-Unsubscribe` is honoured by Gmail, Outlook and other large
   * mailbox providers; it is invisible in plenty of other clients. CAN-SPAM
   * §7704(a)(3) requires a mechanism the RECIPIENT can see and use, and a
   * header no client renders is not that.
   */
  const lines = ['Unsubscribe: ' + url]
  if (input.postalAddress) lines.push(input.postalAddress.trim())

  const footerText = `\n\n---\n${lines.join('\n')}\n`

  const footerHtml =
    `<hr style="margin-top:32px;border:none;border-top:1px solid #e6e6ea">` +
    `<p style="font-size:12px;color:#6b6b76">` +
    `<a href="${escapeHtml(url)}">Unsubscribe</a>` +
    (input.postalAddress ? `<br>${escapeHtml(input.postalAddress.trim())}` : '') +
    `</p>`

  return {
    headers,
    bodyText: input.bodyText + footerText,
    bodyHtml: input.bodyHtml ? input.bodyHtml + footerHtml : null,
  }
}

/**
 * Why a bulk campaign may not launch yet, or null when it may.
 *
 * ⚠️ THIS IS ENFORCED AT LAUNCH, NOT IN THE DATABASE, AND THAT IS DELIBERATE.
 * `workspaces.sender_postal_address` is nullable because the honest alternative
 * — backfilling every existing workspace — means inventing an address, and a
 * WRONG postal address in a commercial email is its own §7704(a)(5) violation
 * that would pass every check we could write. Ask a human at the one moment
 * there is a human to ask. See migration 0111.
 */
export function bulkLaunchBlockedBecause(input: {
  campaignType: CampaignType
  postalAddress: string | null
}): string | null {
  if (!shouldIncludeUnsubscribe(input.campaignType)) return null
  if (input.postalAddress && input.postalAddress.trim().length >= 10) return null

  return (
    'Add your business postal address in workspace settings before launching. ' +
    'Commercial email is required by law to include one, and campaigns without ' +
    'it are far more likely to be marked as spam.'
  )
}
