-- 0130 — mailbox signatures
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  THERE WAS NOWHERE TO PUT A SIGNATURE, AND NOTHING APPENDED ONE.          ║
-- ║                                                                           ║
-- ║  Every "signature" in this codebase before now was cryptographic — HMAC   ║
-- ║  tokens, webhook verification, session guards. No column, no field, no    ║
-- ║  send-time step. So every sequence email left without a sign-off unless   ║
-- ║  the author retyped one into the body of every step by hand, and changing ║
-- ║  it meant editing every step of every campaign.                           ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ THE SIGNATURE BELONGS TO THE MAILBOX, NOT THE CAMPAIGN. It is the sender's
-- identity — their name, role and company — so it is the same on every message
-- that leaves that address, and setting it once is the whole point. A per-step
-- signature would be a second body field wearing a different name.
--
-- Applied by hand in the Supabase SQL editor. Re-run `npm run db:types`
-- afterwards so the generated types match what is actually deployed.

alter table public.email_accounts
  /*
   * The plain-text signature. NULL means "this mailbox has none", which is
   * different from an empty string — the app writes NULL when the field is
   * cleared so that `coalesce` and `is not null` both read correctly, and so a
   * mailbox that never had one is indistinguishable from one deliberately
   * emptied. Both mean: append nothing.
   */
  add column if not exists signature_text text
    check (signature_text is null or length(signature_text) between 1 and 5000),

  /*
   * The HTML signature, used only for the HTML part of a multipart message.
   *
   * ⚠️ OPTIONAL EVEN WHEN `signature_text` IS SET. A mailbox with only a text
   * signature still signs its HTML mail — `lib/email/signature.ts` escapes the
   * text and converts newlines rather than dropping the signature from the
   * HTML part, because a signature that appears in some clients and not others
   * is harder to notice than one that is missing everywhere.
   */
  add column if not exists signature_html text
    check (signature_html is null or length(signature_html) between 1 and 20000);

/*
 * ⚠️ AN HTML SIGNATURE WITHOUT A TEXT ONE IS REFUSED AT THE SCHEMA LEVEL.
 *
 * Every message carries a text part; only some carry an HTML one. A mailbox
 * with HTML only would look signed in the editor and send UNSIGNED plain-text
 * mail — the failure nobody notices, because the sender's own client renders
 * HTML and shows them the version that works.
 *
 * `updateSignature` already refuses it with a sentence, which is the good error.
 * This is the backstop: that action is the only write path TODAY, and an
 * invariant guarded in exactly one place stops being an invariant the moment
 * somebody writes the second one.
 *
 * Added separately from the columns so the failure names this rule rather than
 * a column definition.
 */
alter table public.email_accounts
  drop constraint if exists email_accounts_html_signature_needs_text;

alter table public.email_accounts
  add constraint email_accounts_html_signature_needs_text
  check (signature_html is null or signature_text is not null);

comment on column public.email_accounts.signature_text is
  'Plain-text sign-off appended at SEND time, above the compliance footer. Literal text: template variables are deliberately not rendered here.';

comment on column public.email_accounts.signature_html is
  'HTML sign-off for the HTML part only. When null and signature_text is set, the text is escaped and converted instead.';
