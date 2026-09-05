/**
 * Mailbox connection diagnostics — SMTP and IMAP, reported separately.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ `testConnection` ALREADY EXISTED AND IS NOT ENOUGH FOR THIS. It        ║
 * ║  returns ONE verdict for both protocols, so "sending works but replies    ║
 * ║  do not" and "nothing works" are the same answer. Diagnosing a mailbox    ║
 * ║  needs them apart.                                                        ║
 * ║                                                                           ║
 * ║  ⚠️ THIS FILE HOLDS NO SECRETS AND TOUCHES NO NETWORK. It is the types    ║
 * ║  and the scrubber, so both can be unit-tested against hostile input       ║
 * ║  without a mail server and without a decryption key. The part that        ║
 * ║  decrypts and connects lives in the provider, where the credential        ║
 * ║  already is.                                                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

export type CheckOutcome = 'passed' | 'failed' | 'not_attempted' | 'not_configured'

export type ProtocolResult = {
  connection: CheckOutcome
  authentication: CheckOutcome
  /** A stable classification, safe to show and to log. */
  code?: string
  /** Curated explanation. Never raw provider text. */
  message?: string
  /** Hard-scrubbed excerpt, for a provider quirk the classifier does not know. */
  providerDetail?: string
}

export type MailboxDiagnostics = {
  accountId: string
  fromEmail: string
  smtp: ProtocolResult
  imap: ProtocolResult & { inbox: CheckOutcome }
  send: {
    attempted: boolean
    accepted: CheckOutcome
    /** RFC 5322 Message-ID, when the server gave one. Not a secret. */
    messageId?: string
    code?: string
    message?: string
    providerDetail?: string
  }
}

/**
 * Anything that could carry a credential, removed.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ MAIL SERVERS ECHO THE COMMAND THEY REJECTED, AND THE COMMAND CONTAINS ║
 * ║  THE CREDENTIAL. A failed `AUTH PLAIN` can come back with the base64      ║
 * ║  argument attached; `AUTH LOGIN` echoes the username and sometimes the    ║
 * ║  password prompt round. Putting a raw provider string in a response, a    ║
 * ║  log line or a support ticket is how a password leaves the system.       ║
 * ║                                                                           ║
 * ║  Three defences, deliberately overlapping:                                ║
 * ║                                                                           ║
 * ║   1. Everything from an auth verb onwards is dropped, not masked.         ║
 * ║   2. Long unbroken tokens go, which is what base64 looks like.            ║
 * ║   3. The literal secret is removed if the caller supplies it — the only   ║
 * ║      defence that still works when a server invents a format nobody       ║
 * ║      anticipated.                                                         ║
 * ║                                                                           ║
 * ║  ⚠️ THE THIRD IS THE ONE THAT MATTERS. The first two are pattern          ║
 * ║  matching, and pattern matching is a guess about the future.             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function scrubProviderDetail(
  raw: unknown,
  secrets: readonly (string | null | undefined)[] = [],
): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined

  let text = raw.replace(/\s+/g, ' ').trim()

  // 1. Auth verbs: everything after them is argument, and arguments are secrets.
  text = text.replace(
    /\b(AUTH(?:\s+(?:PLAIN|LOGIN|XOAUTH2|CRAM-MD5))?|LOGIN|PASS|PASSWORD)\b.*$/i,
    '$1 [redacted]',
  )

  // 2. Long unbroken tokens — base64, bearer tokens, app passwords.
  text = text.replace(/\b[A-Za-z0-9+/=_-]{16,}\b/g, '[redacted]')

  /*
   * 3. The literal value, whatever shape the server wrapped it in. Also its
   *    base64 form, because that is how AUTH carries it on the wire.
   */
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue
    for (const form of [secret, Buffer.from(secret, 'utf8').toString('base64')]) {
      text = text.split(form).join('[redacted]')
    }
  }

  // A diagnostic, not a transcript.
  return text.length > 200 ? `${text.slice(0, 200)}…` : text
}

/**
 * IMAP failures, classified.
 *
 * ⚠️ `imapflow` SETS `authenticationFailed` ON AN AUTH REJECTION, which is the
 * one distinction that changes what the reader should do: a wrong password is
 * theirs to fix, an unreachable host usually is not.
 */
export function classifyImapError(error: unknown): { code: string; message: string; authFailed: boolean } {
  const err = error as { authenticationFailed?: boolean; code?: string; message?: string }

  if (err?.authenticationFailed) {
    return {
      code: 'IMAP_AUTH',
      message:
        'The IMAP username or password was rejected. Zoho, Gmail and Outlook all ' +
        'require an app password here, not the account password.',
      authFailed: true,
    }
  }

  if (err?.code === 'ENOTFOUND' || err?.code === 'EAI_AGAIN') {
    return { code: 'IMAP_DNS', message: 'The IMAP host name did not resolve.', authFailed: false }
  }

  if (err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET') {
    return {
      code: 'IMAP_UNREACHABLE',
      message: 'Outlio could not open a connection to the IMAP server on that port.',
      authFailed: false,
    }
  }

  return {
    code: 'IMAP_ERROR',
    message: 'Outlio could not complete the IMAP check.',
    authFailed: false,
  }
}

/** A one-screen summary, in the shape the operator asked for. */
export function formatDiagnostics(d: MailboxDiagnostics): string {
  const line = (label: string, v: CheckOutcome) => `${label.padEnd(22)}${v}`
  const out = [
    `Mailbox: ${d.fromEmail}`,
    '',
    line('SMTP connection:', d.smtp.connection),
    line('SMTP authentication:', d.smtp.authentication),
  ]
  if (d.smtp.message) out.push(`SMTP error:           ${d.smtp.message}`)
  if (d.smtp.providerDetail) out.push(`SMTP provider detail: ${d.smtp.providerDetail}`)

  out.push('', line('Message accepted:', d.send.accepted))
  if (d.send.messageId) out.push(`Message ID:           ${d.send.messageId}`)
  if (d.send.message) out.push(`Send error:           ${d.send.message}`)
  if (d.send.providerDetail) out.push(`Send provider detail: ${d.send.providerDetail}`)

  out.push(
    '',
    line('IMAP connection:', d.imap.connection),
    line('IMAP authentication:', d.imap.authentication),
    line('Inbox access:', d.imap.inbox),
  )
  if (d.imap.message) out.push(`IMAP error:           ${d.imap.message}`)
  if (d.imap.providerDetail) out.push(`IMAP provider detail: ${d.imap.providerDetail}`)

  return out.join('\n')
}
