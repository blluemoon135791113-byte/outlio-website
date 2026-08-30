/**
 * What a sending account can actually DO — M5 Phase 11.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  CAPABILITIES ARE DERIVED, NEVER DECLARED.                                ║
 * ║                                                                           ║
 * ║  The temptation is a lookup table: gmail → everything, smtp → sending.    ║
 * ║  That is wrong for the case the brief calls out by name. SMTP is          ║
 * ║  send-only, but an SMTP account WITH an IMAP companion configured can     ║
 * ║  read replies. The same provider therefore has two different capability   ║
 * ║  sets depending on how one account was configured, so capability is a     ║
 * ║  function of (provider, configuration) and of nothing else.               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ COMPUTED WITHOUT DECRYPTING ANYTHING. Everything this file reads lives in
 * the non-secret `configuration` column. An IMAP *password* is a secret; the
 * fact that an IMAP *host* was configured is not. Keeping the distinction means
 * the campaign engine can ask "can this account read replies?" on a hot path
 * without touching the secrets table — and a decrypt on a hot path is how
 * secrets end up in logs and error traces.
 */

/** The providers M5 targets. Adapters arrive in Phase 12. */
export const EMAIL_PROVIDERS = ['gmail', 'microsoft', 'smtp'] as const

export type EmailProviderId = (typeof EMAIL_PROVIDERS)[number]

/**
 * Support for a feature, as a three-state rather than a boolean.
 *
 * ⚠️ `unsupported` AND `unconfigured` ARE DIFFERENT ANSWERS and collapsing them
 * into `false` destroys the only useful thing the UI can say. "This provider
 * cannot ever do this" is a dead end; "you have not set this up yet" is a
 * prompt with a fix attached. The brief requires SMTP-without-IMAP to report no
 * replies — but the honest reason is that it is unconfigured, not impossible.
 */
export type Support = 'supported' | 'unsupported' | 'unconfigured'

export type EmailCapabilities = {
  /** Outbound send. Every provider supports this or it would not be here. */
  send: Support
  /** Reading replies to sent mail. Requires read access, not just send. */
  replies: Support
  /** Reading whole conversations, for the contact timeline. */
  threads: Support
  /** Provider-pushed delivery/bounce events, as opposed to polling. */
  webhookEvents: Support
  /** File attachments on outbound mail. */
  attachments: Support
  /**
   * RFC 8058 one-click `List-Unsubscribe`.
   *
   * Always supported, because it is a HEADER WE SET on a message we compose —
   * it needs nothing from the provider. It is listed so M6 can ask a single
   * object rather than special-casing a header it already controls.
   */
  listUnsubscribe: Support
  /** OAuth rather than a stored password. */
  oauth: Support
}

/**
 * The non-secret half of an account's connection settings.
 *
 * ⚠️ NOTHING SENSITIVE BELONGS IN THIS TYPE. It mirrors the `configuration`
 * JSONB column, which is readable by workspace members under RLS. Passwords,
 * tokens and refresh tokens live in `email_account_secrets`, which has no
 * client policy at all.
 */
export type EmailAccountConfiguration = {
  /** SMTP submission host. Absent means SMTP was never finished. */
  smtpHost?: string
  smtpPort?: number
  /** IMAP companion. Its PRESENCE is what unlocks reply sync for SMTP. */
  imapHost?: string
  imapPort?: number
}

/**
 * What an account can do, given its provider and how it was configured.
 *
 * ⚠️ PURE. No database, no network, no decryption — so the campaign engine can
 * call it per-recipient without cost, and so the SMTP/IMAP rule is testable
 * without a mail server.
 */
export function capabilitiesFor(
  provider: EmailProviderId,
  configuration: EmailAccountConfiguration = {},
): EmailCapabilities {
  const base: EmailCapabilities = {
    send: 'supported',
    replies: 'unsupported',
    threads: 'unsupported',
    webhookEvents: 'unsupported',
    attachments: 'supported',
    listUnsubscribe: 'supported',
    oauth: 'unsupported',
  }

  switch (provider) {
    case 'gmail':
    case 'microsoft':
      /*
       * Both are full mailbox APIs: the same OAuth grant that authorises
       * sending also authorises reading, so replies and threads come with the
       * connection rather than needing separate setup. Neither can be
       * "unconfigured" for replies — if the account is connected at all, it can
       * read.
       */
      return {
        ...base,
        replies: 'supported',
        threads: 'supported',
        webhookEvents: 'supported',
        oauth: 'supported',
      }

    case 'smtp':
      /*
       * ⚠️ THE CASE THE BRIEF NAMES. SMTP is a SUBMISSION protocol — it has no
       * verb for reading a mailbox, so an SMTP account on its own can never see
       * a reply. Configuring an IMAP companion adds the missing read side.
       *
       * Reporting `replies: supported` here without IMAP would be the most
       * expensive lie in the system: a sequence whose stop-on-reply never
       * fires keeps mailing people who already answered.
       *
       * `webhookEvents` stays `unsupported` rather than `unconfigured` — there
       * is no configuration that would give a plain SMTP server a push
       * channel, so offering one would be a dead end.
       */
      return {
        ...base,
        replies: configuration.imapHost ? 'supported' : 'unconfigured',
        threads: configuration.imapHost ? 'supported' : 'unconfigured',
      }
  }
}

/** Whether a capability is usable right now. */
export function isUsable(support: Support): boolean {
  return support === 'supported'
}

/**
 * Why a capability is unavailable, in words a customer can act on.
 *
 * Returns `null` when it IS available, so a caller can use it directly as the
 * reason a feature is greyed out.
 */
export function unavailableReason(
  capability: keyof EmailCapabilities,
  support: Support,
): string | null {
  if (support === 'supported') return null

  if (support === 'unconfigured' && (capability === 'replies' || capability === 'threads')) {
    return 'Add IMAP settings to this account so Outlio can read replies. Without them it can send but never see an answer.'
  }

  if (capability === 'webhookEvents') {
    return 'This provider cannot push delivery events. Outlio checks for them on a schedule instead.'
  }

  return support === 'unconfigured'
    ? 'This account needs more setup before that will work.'
    : 'This provider does not support that.'
}
