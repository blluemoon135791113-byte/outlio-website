import 'server-only'

/**
 * The sender's sign-off, attached on the way out.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ APPLIED AT SEND TIME, FROM CURRENT SETTINGS — NEVER AT ENQUEUE.       ║
 * ║                                                                           ║
 * ║  This is the same reasoning `lib/email/compliance.ts` records for the     ║
 * ║  unsubscribe footer, and it matters more here because signatures change   ║
 * ║  often. Baking one into `email_messages.body_text` would mean:            ║
 * ║                                                                           ║
 * ║   - a step queued before the signature was set sends without one FOREVER, ║
 * ║     and setting it does not fix the queue;                                ║
 * ║   - someone who changes job title still signs with the old one for every  ║
 * ║     message already waiting — which for a sequence is days of mail.       ║
 * ║                                                                           ║
 * ║  Building it here means the message that actually leaves is always signed ║
 * ║  with what the mailbox says right now.                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ A SIGNATURE IS LITERAL TEXT, NOT A TEMPLATE. `{{first_name}}` is not
 * rendered here and that is deliberate: this runs AFTER the message has been
 * claimed, so there is no longer a safe way to refuse. `renderTemplate` answers
 * a missing value by refusing to render at all — the one honest option at
 * enqueue time — and that option does not exist on this side of the claim. The
 * alternatives are all the failures that function was written to prevent:
 * sending "Hi ," or leaking "{{first_name}}" into a stranger's inbox.
 *
 * A signature describes the SENDER, who is fixed per mailbox, so it has nothing
 * to interpolate anyway. The field is documented as literal in the UI.
 */

export type SignatureInput = {
  /** From `email_accounts.signature_text`. Null when the mailbox has none. */
  signatureText: string | null
  /** From `email_accounts.signature_html`. Optional even when text is set. */
  signatureHtml: string | null
  bodyText: string
  bodyHtml: string | null
}

export type SignatureResult = {
  bodyText: string
  bodyHtml: string | null
}

/** Escaping for a signature the operator typed, interpolated into HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Renders a plain-text signature into the HTML part.
 *
 * ⚠️ ESCAPED, THEN LINE BREAKS RESTORED — in that order. Reversing it would
 * turn the `<br>` tags this inserts into visible text, and escaping afterwards
 * would let a `<` the operator typed through as markup.
 */
function textToHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>')
}

/**
 * Appends the mailbox's signature to a message.
 *
 * ⚠️ THE ORDER IS SIGNATURE, THEN COMPLIANCE FOOTER. A sign-off below the
 * unsubscribe line reads as part of the legal boilerplate rather than as a
 * person. Callers must run this BEFORE `applyCompliance`.
 *
 * ⚠️ NO RFC 3676 `-- ` DELIMITER, AND THE REASON IS NOT COSMETIC. That marker
 * tells a mail client everything after it is a signature, and several clients
 * collapse or hide exactly that region. The unsubscribe footer is appended
 * after this point, so using the conventional delimiter would hide the one
 * thing CAN-SPAM §7704(a)(3) requires the recipient to be able to see. A blank
 * line separates instead.
 *
 * Unlike the compliance footer, this applies to EVERY campaign type including
 * `manual`: a one-to-one reply is the message that most wants a sign-off, and
 * is the one that must not carry "unsubscribe from this list".
 */
export function applySignature(input: SignatureInput): SignatureResult {
  const text = input.signatureText?.trim() || null
  const html = input.signatureHtml?.trim() || null

  // Nothing set on this mailbox. Return the message untouched rather than
  // appending a separator with nothing after it.
  if (!text && !html) {
    return { bodyText: input.bodyText, bodyHtml: input.bodyHtml }
  }

  /*
   * The text part can only ever use the text signature. Stripping tags out of
   * `signature_html` to synthesise one would be a guess at what the operator
   * meant, and a bad one — an HTML signature is usually a table of links that
   * flattens into nonsense.
   */
  const bodyText = text ? `${input.bodyText}\n\n${text}\n` : input.bodyText

  /*
   * The HTML part prefers the HTML signature and falls back to the converted
   * text, so a mailbox that set only a text signature still signs its HTML
   * mail. A message with no HTML part stays that way — this function never
   * promotes a text-only message to multipart.
   */
  const signatureForHtml = html ?? (text ? textToHtml(text) : null)

  const bodyHtml =
    input.bodyHtml && signatureForHtml
      ? `${input.bodyHtml}<div style="margin-top:24px">${signatureForHtml}</div>`
      : input.bodyHtml

  return { bodyText, bodyHtml }
}
