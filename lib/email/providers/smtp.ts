import 'server-only'

/**
 * SMTP submission with an optional IMAP companion — M5 Phase 12.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  WHY SMTP IS THE FIRST ADAPTER AND NOT GMAIL.                             ║
 * ║                                                                           ║
 * ║  The brief says adapters ship "in safest order based on existing Outlio   ║
 * ║  OAuth infra (Ledger evidence decides)". The evidence:                    ║
 * ║                                                                           ║
 * ║   - There are NO Google OAuth client credentials in this environment, so  ║
 * ║     a Gmail adapter could not be exercised against Google at all — and    ║
 * ║     the brief forbids inventing provider behaviour.                       ║
 * ║   - The existing Google grant is `drive.file` + `spreadsheets`. Sending   ║
 * ║     needs `gmail.send` and reply sync needs `gmail.readonly`, both of     ║
 * ║     which are RESTRICTED scopes: Google app verification plus an annual   ║
 * ║     third-party CASA security assessment. That is money and weeks of      ║
 * ║     lead time, not an afternoon.                                         ║
 * ║   - SMTP+IMAP needs no OAuth, no verification and no restricted scopes,   ║
 * ║     and can be verified end to end against a real mail server today.      ║
 * ║                                                                           ║
 * ║  It is also the case that exercises Phase 11's capability model hardest,  ║
 * ║  since reply support depends on configuration rather than on provider.    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'

import {
  classifyImapError,
  scrubProviderDetail,
  type MailboxDiagnostics,
} from '@/lib/email/diagnostics'
import {
  capabilitiesFor,
  type EmailAccountConfiguration,
  type EmailCapabilities,
} from '@/lib/email/capabilities'
import {
  EmailCapabilityError,
  type AccountStatusReport,
  type ConnectionTest,
  type EmailAccountHandle,
  type EmailProvider,
  type NormalizedReply,
  type OutboundMessage,
  type SendResult,
  type SyncCursor,
} from '@/lib/email/provider'
import { readAccountSecret } from '@/lib/email/accounts'
import { assertSafeMailEndpoint, UnsafeMailEndpointError } from '@/lib/email/providers/smtp-address'

/**
 * What is stored, encrypted, for an SMTP account.
 *
 * ⚠️ TWO SEPARATE PASSWORDS. Submission and retrieval are different services
 * and frequently different credentials; assuming one password for both is a
 * guess that fails on any provider using app-specific passwords.
 */
export type SmtpSecret = {
  smtpUsername: string
  smtpPassword: string
  imapUsername?: string
  imapPassword?: string
}

export type SmtpConnectInput = {
  configuration: EmailAccountConfiguration
  secret: SmtpSecret
  fromEmail: string
  displayName?: string | null
}

/**
 * ⚠️ EVERY SOCKET GETS A DEADLINE. A mail server that accepts a connection and
 * then says nothing would otherwise hold a worker open indefinitely, and one
 * unreachable account would starve every other account's sends.
 */
const TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
} as const

/** 465 is implicit TLS; 587 and 25 start plaintext and STARTTLS upward. */
function isImplicitTls(port: number): boolean {
  return port === 465
}

function transportFor(account: EmailAccountHandle, secret: SmtpSecret) {
  const host = account.configuration.smtpHost
  const port = account.configuration.smtpPort ?? 587

  if (!host) {
    throw new EmailCapabilityError('smtp', 'send')
  }

  assertSafeMailEndpoint('smtp', host, port)

  return nodemailer.createTransport({
    host,
    port,
    secure: isImplicitTls(port),
    auth: { user: secret.smtpUsername, pass: secret.smtpPassword },
    /*
     * ⚠️ STARTTLS IS REQUIRED ON PLAINTEXT PORTS, not merely attempted.
     * nodemailer's default silently continues in the clear when a server
     * refuses to upgrade — which would put the customer's password and every
     * recipient's address on the wire in plaintext, exactly the failure the
     * customer is trusting us to avoid. Localhost is exempt so the integration
     * test can run against a container without a certificate.
     */
    requireTLS: !isImplicitTls(port) && !isLocal(host),
    tls: isLocal(host) ? { rejectUnauthorized: false } : undefined,
    ...TIMEOUTS,
  })
}

function isLocal(host: string): boolean {
  const h = host.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1'
}

/**
 * A deterministic Message-ID derived from the idempotency key.
 *
 * ⚠️ THIS DOES NOT PREVENT A DOUBLE SEND, AND MUST NOT BE MISTAKEN FOR THE
 * GUARANTEE. SMTP has no dedupe verb: hand the same message to the same server
 * twice and it is delivered twice, identical Message-ID or not. The
 * exactly-once guarantee (M5 criterion 3) lives in Phase 14's engine, which
 * records the key BEFORE handing the message over.
 *
 * What a stable id buys is diagnosis and threading — a duplicate becomes
 * provable rather than merely suspected, and a reply threads back to the
 * message that caused it.
 */
function messageIdFor(idempotencyKey: string, domain: string): string {
  const safe = idempotencyKey.replace(/[^a-zA-Z0-9._-]/g, '')
  return `<${safe}@${domain}>`
}

function imapClientFor(account: EmailAccountHandle, secret: SmtpSecret): ImapFlow {
  const host = account.configuration.imapHost
  const port = account.configuration.imapPort ?? 993

  if (!host) {
    // The caller should have consulted getCapabilities first. Phase 11's
    // capability model exists precisely so this is unreachable in practice.
    throw new EmailCapabilityError('smtp', 'replies')
  }

  assertSafeMailEndpoint('imap', host, port)

  return new ImapFlow({
    host,
    port,
    secure: port === 993,
    auth: {
      user: secret.imapUsername ?? secret.smtpUsername,
      pass: secret.imapPassword ?? secret.smtpPassword,
    },
    logger: false,
    tls: isLocal(host) ? { rejectUnauthorized: false } : undefined,
  })
}

/**
 * Maps a provider failure to whether retrying could ever help.
 *
 * ⚠️ A 5xx IS PERMANENT AND MUST NOT BE RETRIED. Retrying a "no such mailbox"
 * wastes the send budget of a healthy account and, on a bad address, keeps
 * hammering a server that has already told us the answer — which is how a
 * sending domain earns a reputation problem.
 */
function classifySmtpError(
  error: unknown,
  /*
   * ⚠️ THE SAME 5xx MEANS DIFFERENT THINGS IN THE TWO PLACES THIS RUNS. During
   * a send there IS a message to reject; during `verify()` there is not, and
   * telling someone connecting a mailbox that "the mail server rejected this
   * message" describes an event that did not happen.
   */
  context: 'send' | 'connect' = 'send',
): { retryable: boolean; code: string; message: string } {
  const err = error as { responseCode?: number; code?: string; message?: string }
  const responseCode = err?.responseCode

  /*
   * ╔═══════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ AUTH IS CHECKED BEFORE THE 5xx RANGE, AND THE ORDER IS THE BUG    ║
   * ║  THAT WAS HERE.                                                       ║
   * ║                                                                       ║
   * ║  Gmail answers a bad app password with `535 5.7.8 Username and        ║
   * ║  Password not accepted`. 535 IS a 5xx, so the permanent branch caught ║
   * ║  it first and the user was told "the mail server rejected this        ║
   * ║  message permanently" — during a connection test, where no message    ║
   * ║  exists — which sends them to check their SMTP host instead of their  ║
   * ║  password. It is the single most common failure when connecting a     ║
   * ║  mailbox, reported as the one thing it is not.                        ║
   * ║                                                                       ║
   * ║  It also suppressed `reconnectRequired`, which `#verify` derives from ║
   * ║  `SMTP_AUTH` — so the account was never flagged as needing new        ║
   * ║  credentials either.                                                  ║
   * ║                                                                       ║
   * ║  ⚠️ 535 IS MATCHED EXPLICITLY as well as `EAUTH`. Not every server    ║
   * ║  sets nodemailer's `EAUTH`, but 535 is "authentication credentials    ║
   * ║  invalid" in RFC 4954 and means nothing else.                         ║
   * ╚═══════════════════════════════════════════════════════════════════════╝
   */
  if (err?.code === 'EAUTH' || responseCode === 535 || responseCode === 534) {
    return {
      retryable: false,
      code: 'SMTP_AUTH',
      message:
        'The username or password for this mailbox was rejected. ' +
        'Gmail and Outlook need an app password, not your normal one.',
    }
  }

  if (typeof responseCode === 'number' && responseCode >= 500 && responseCode < 600) {
    return {
      retryable: false,
      code: 'SMTP_PERMANENT',
      message:
        context === 'connect'
          ? 'The mail server refused the connection and will not accept a retry.'
          : 'The mail server rejected this message permanently.',
    }
  }

  if (typeof responseCode === 'number' && responseCode >= 400 && responseCode < 500) {
    return {
      retryable: true,
      code: 'SMTP_TEMPORARY',
      message: 'The mail server asked us to try again later.',
    }
  }

  /*
   * ⚠️ DNS FAILURES BELONG HERE, NOT IN THE CATCH-ALL. A typo in the hostname
   * is the single most likely mistake when someone connects a mailbox, and
   * "The mail server returned an error" sends them looking at their password.
   * `ENOTFOUND`/`EAI_AGAIN` mean the NAME did not resolve, which is a
   * different and much more actionable fact.
   */
  if (err?.code === 'ENOTFOUND' || err?.code === 'EAI_AGAIN' || err?.code === 'EDNS') {
    return {
      retryable: false,
      code: 'SMTP_HOST_NOT_FOUND',
      message: 'That mail server hostname does not exist. Check it for a typo.',
    }
  }

  if (
    err?.code === 'ETIMEDOUT' ||
    err?.code === 'ECONNECTION' ||
    err?.code === 'ESOCKET' ||
    err?.code === 'ECONNREFUSED'
  ) {
    return {
      retryable: true,
      code: 'SMTP_UNREACHABLE',
      message: 'Could not reach the mail server. Check the hostname and port.',
    }
  }

  // ⚠️ The provider's own text is deliberately NOT surfaced: it can echo the
  // recipient address and internal hostnames back to the client.
  return { retryable: true, code: 'SMTP_UNKNOWN', message: 'The mail server returned an error.' }
}

/**
 * ⚠️ EXPORTED FOR TESTS ONLY. The classifier decides whether a failure is
 * retryable, which is the difference between a message that eventually sends
 * and one that hammers a server that already said no — worth pinning directly.
 */
export const classifySmtpErrorForTest = classifySmtpError

export class SmtpProvider implements EmailProvider {
  readonly id = 'smtp' as const

  async connect(input: unknown): Promise<{ secret: unknown; account: ConnectionTest }> {
    const typed = input as SmtpConnectInput
    // The port is not read here: `#verify` builds the transport, and resolving
    // a default in two places is how the two drift apart.
    const host = typed.configuration.smtpHost

    if (!host) {
      return {
        secret: null,
        account: {
          ok: false,
          reconnectRequired: false,
          code: 'SMTP_NO_HOST',
          message: 'An SMTP server hostname is required.',
        },
      }
    }

    const probe: EmailAccountHandle = {
      id: 'pending',
      workspaceId: 'pending',
      provider: 'smtp',
      fromEmail: typed.fromEmail,
      fromName: typed.displayName ?? null,
      configuration: typed.configuration,
      secretReference: 'pending',
    }

    const test = await this.#verify(probe, typed.secret)
    return { secret: typed.secret, account: test }
  }

  async disconnect(): Promise<void> {
    /*
     * Nothing to revoke upstream. SMTP has no token to invalidate — the
     * credential is a password the customer still owns, and the only thing we
     * can do is forget it, which `disconnectEmailAccount` does by deleting the
     * secret row outright.
     */
  }

  async testConnection(account: EmailAccountHandle): Promise<ConnectionTest> {
    const secret = await readAccountSecret<SmtpSecret>(account.id, account.secretReference)
    return this.#verify(account, secret)
  }

  async #verify(account: EmailAccountHandle, secret: SmtpSecret): Promise<ConnectionTest> {
    try {
      const transport = transportFor(account, secret)
      await transport.verify()
      transport.close()
    } catch (error) {
      if (error instanceof UnsafeMailEndpointError) {
        return {
          ok: false,
          reconnectRequired: false,
          code: 'SMTP_UNSAFE_HOST',
          message: error.message,
        }
      }
      const { code, message } = classifySmtpError(error, 'connect')
      return { ok: false, reconnectRequired: code === 'SMTP_AUTH', code, message }
    }

    /*
     * ⚠️ IMAP IS VERIFIED SEPARATELY, AND ITS FAILURE IS NOT FATAL. An account
     * whose submission works but whose retrieval does not is still a usable
     * SENDING account — it just cannot see replies. Refusing the whole
     * connection would deny the customer a working mailbox over a feature they
     * may not have asked for.
     */
    if (account.configuration.imapHost) {
      try {
        const client = imapClientFor(account, secret)
        await client.connect()
        await client.logout()
      } catch {
        return {
          ok: false,
          reconnectRequired: true,
          code: 'IMAP_UNAVAILABLE',
          message:
            'Sending works, but Outlio could not sign in to IMAP, so it will not see replies. Check the IMAP username and password.',
        }
      }
    }

    return { ok: true, fromEmail: account.fromEmail, displayName: account.fromName }
  }

  /**
   * SMTP and IMAP checked SEPARATELY, with every result scrubbed.
   *
   * ╔═══════════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ RUNS WHEREVER THE ENCRYPTION KEY IS, WHICH IS THE POINT. The stored   ║
   * ║  credential is decrypted here by `readAccountSecret`; a machine without   ║
   * ║  the deployed `INTEGRATION_ENCRYPTION_KEY` fails at that line and never   ║
   * ║  reaches the provider. That is the isolation working, not a bug, and it   ║
   * ║  is why this check has to run server-side in the deployed environment.   ║
   * ║                                                                           ║
   * ║  ⚠️ NOTHING HERE BYPASSES PROVIDER AUTHENTICATION. It bypasses the        ║
   * ║  campaign SCHEDULER only — no send window, no ramp, no daily counter —    ║
   * ║  because this is a diagnostic the operator asked for, not a campaign. The ║
   * ║  mail server still has to accept the credential.                          ║
   * ║                                                                           ║
   * ║  ⚠️ `verify()` DOES CONNECT AND AUTH TOGETHER, so the two lines below are ║
   * ║  derived from the CLASSIFICATION rather than measured independently: an   ║
   * ║  `SMTP_AUTH` failure means the socket got far enough to be rejected on    ║
   * ║  credentials, so connection passed and authentication failed. Anything    ║
   * ║  else at that stage is reported as the connection failing with            ║
   * ║  authentication `not_attempted` — stated rather than implied, because     ║
   * ║  "authentication: failed" would otherwise be a guess.                     ║
   * ╚═══════════════════════════════════════════════════════════════════════════╝
   */
  async runDiagnostics(
    account: EmailAccountHandle,
    options: { sendTestTo?: string } = {},
  ): Promise<MailboxDiagnostics> {
    const secret = await readAccountSecret<SmtpSecret>(account.id, account.secretReference)
    const secrets = [secret.smtpPassword, secret.imapPassword, secret.smtpUsername, secret.imapUsername]

    const result: MailboxDiagnostics = {
      accountId: account.id,
      fromEmail: account.fromEmail,
      smtp: { connection: 'not_attempted', authentication: 'not_attempted' },
      imap: { connection: 'not_configured', authentication: 'not_configured', inbox: 'not_configured' },
      send: { attempted: false, accepted: 'not_attempted' },
    }

    // ---- SMTP -------------------------------------------------------------
    let transport
    try {
      transport = transportFor(account, secret)
      await transport.verify()
      result.smtp.connection = 'passed'
      result.smtp.authentication = 'passed'
    } catch (error) {
      const classified =
        error instanceof UnsafeMailEndpointError
          ? { code: 'SMTP_UNSAFE_HOST', message: error.message }
          : classifySmtpError(error, 'connect')

      const authRejected = classified.code === 'SMTP_AUTH'
      result.smtp.connection = authRejected ? 'passed' : 'failed'
      result.smtp.authentication = authRejected ? 'failed' : 'not_attempted'
      result.smtp.code = classified.code
      result.smtp.message = classified.message
      result.smtp.providerDetail = scrubProviderDetail(
        (error as { message?: string })?.message,
        secrets,
      )
    } finally {
      try {
        transport?.close()
      } catch {
        // Closing a transport that never opened is not a diagnostic result.
      }
    }

    // ---- One test message, only if asked and only if SMTP works -----------
    if (options.sendTestTo && result.smtp.authentication === 'passed') {
      result.send.attempted = true
      const sent = await this.send(account, {
        to: options.sendTestTo,
        subject: 'Outlio mailbox test',
        text:
          'This message was sent by the Outlio mailbox connection test. ' +
          'It is not part of any campaign or sequence.',
        html:
          '<p>This message was sent by the Outlio mailbox connection test. ' +
          'It is not part of any campaign or sequence.</p>',
        idempotencyKey: `mailbox-test-${account.id}-${Date.now()}`,
      } as OutboundMessage)

      if (sent.ok) {
        result.send.accepted = 'passed'
        result.send.messageId = sent.providerMessageId
      } else {
        result.send.accepted = 'failed'
        result.send.code = sent.code
        result.send.message = sent.message
        result.send.providerDetail = scrubProviderDetail(sent.message, secrets)
      }
    }

    // ---- IMAP -------------------------------------------------------------
    if (account.configuration.imapHost) {
      result.imap = { connection: 'not_attempted', authentication: 'not_attempted', inbox: 'not_attempted' }
      let client: ImapFlow | undefined
      try {
        client = imapClientFor(account, secret)
        await client.connect()
        result.imap.connection = 'passed'
        result.imap.authentication = 'passed'

        /*
         * ⚠️ READ-ONLY. A diagnostic must not mark mail as seen, move it, or
         * touch the UID cursor the reply sync depends on.
         */
        const box = await client.mailboxOpen('INBOX', { readOnly: true })
        result.imap.inbox = box ? 'passed' : 'failed'
      } catch (error) {
        const classified = classifyImapError(error)
        result.imap.connection = classified.authFailed ? 'passed' : 'failed'
        result.imap.authentication = classified.authFailed ? 'failed' : 'not_attempted'
        result.imap.inbox = 'not_attempted'
        result.imap.code = classified.code
        result.imap.message = classified.message
        result.imap.providerDetail = scrubProviderDetail(
          (error as { message?: string })?.message,
          secrets,
        )
      } finally {
        // Always log out, so the diagnostic never leaves a session open.
        try {
          await client?.logout()
        } catch {
          try {
            client?.close()
          } catch {
            // Nothing further to do; the socket is the server's problem now.
          }
        }
      }
    }

    return result
  }

  async send(account: EmailAccountHandle, message: OutboundMessage): Promise<SendResult> {
    let transport
    try {
      const secret = await readAccountSecret<SmtpSecret>(account.id, account.secretReference)
      transport = transportFor(account, secret)
    } catch (error) {
      if (error instanceof UnsafeMailEndpointError) {
        return {
          ok: false,
          retryable: false,
          code: 'SMTP_UNSAFE_HOST',
          message: error.message,
        }
      }
      throw error
    }

    const domain = account.fromEmail.slice(account.fromEmail.lastIndexOf('@') + 1)

    try {
      const info = await transport.sendMail({
        from: account.fromName
          ? { name: account.fromName, address: account.fromEmail }
          : account.fromEmail,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html ?? undefined,
        replyTo: message.replyTo,
        messageId: messageIdFor(message.idempotencyKey, domain),
        /*
         * ⚠️ `List-Unsubscribe` AND `List-Unsubscribe-Post` ARRIVE HERE.
         *
         * Before Phase 0.5 there was no `headers` field on OutboundMessage at
         * all, so no message Outlio sent could carry them — see the block on
         * `OutboundMessage.headers`. Dropping this line silently restores that
         * bug, and `email-compliance.test.ts` exists to stop that.
         */
        headers: message.headers,
        // Threading headers, so a reply lands against the right conversation.
        inReplyTo: message.inReplyToMessageId,
        references: message.inReplyToMessageId ? [message.inReplyToMessageId] : undefined,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          content: Buffer.from(a.content, 'base64'),
        })),
      })

      /*
       * ⚠️ ACCEPTANCE IS NOT DELIVERY. A 250 means this server took
       * responsibility for the message, nothing more — it may still bounce
       * minutes later. `delivered` is an EVENT that arrives separately, and
       * conflating the two would report a bounced campaign as a successful one.
       */
      return {
        ok: true,
        providerMessageId: info.messageId,
        threadId: message.threadId ?? null,
      }
    } catch (error) {
      return { ok: false, ...classifySmtpError(error) }
    } finally {
      transport.close()
    }
  }

  async receiveProviderEvent(): Promise<never> {
    /*
     * There is no webhook to receive. A plain mail server has no push channel,
     * which is why `capabilitiesFor('smtp').webhookEvents` is `unsupported`
     * rather than `unconfigured` — no amount of setup would create one.
     * Bounces arrive as mail and are read by the IMAP sync instead.
     */
    throw new EmailCapabilityError('smtp', 'webhookEvents')
  }

  async syncThreads(account: EmailAccountHandle, since: SyncCursor): Promise<SyncCursor> {
    const { next } = await this.syncReplies(account, since)
    return next
  }

  async syncReplies(
    account: EmailAccountHandle,
    since: SyncCursor,
  ): Promise<{ replies: NormalizedReply[]; next: SyncCursor }> {
    if (!account.configuration.imapHost) {
      throw new EmailCapabilityError('smtp', 'replies')
    }

    const secret = await readAccountSecret<SmtpSecret>(account.id, account.secretReference)
    const client = imapClientFor(account, secret)
    const replies: NormalizedReply[] = []

    await client.connect()
    let highestUid = Number(since.cursor ?? 0)

    try {
      const lock = await client.getMailboxLock('INBOX')
      try {
        /*
         * ⚠️ RESUMES FROM A UID, NOT FROM A DATE. IMAP date searches have
         * day granularity and no ordering guarantee, so a date cursor either
         * re-reads a whole day on every sync or drops messages that arrive
         * within the same day after the cursor was written. UIDs are
         * monotonic within a mailbox and are exactly the resumption token
         * IMAP provides.
         */
        const range = `${highestUid + 1}:*`

        for await (const msg of client.fetch(
          range,
          { uid: true, source: true, envelope: true },
          { uid: true },
        )) {
          // A `uid:*` range returns the last message even when it is older
          // than the cursor, so the guard is required rather than defensive.
          if (msg.uid <= highestUid) continue
          highestUid = Math.max(highestUid, msg.uid)
          if (!msg.source) continue

          const parsed = await simpleParser(msg.source)
          const from = parsed.from?.value?.[0]?.address
          if (!from) continue

          /*
           * Headers are handed on RAW. The deterministic out-of-office
           * pre-filter is M6 Phase 17's job, and an adapter that decided what
           * counted as an auto-reply would put that policy in three different
           * places — one per provider — where they would drift apart.
           */
          const headers: Record<string, string> = {}
          for (const key of ['auto-submitted', 'x-autoreply', 'x-autorespond', 'precedence', 'in-reply-to', 'references']) {
            const value = parsed.headers.get(key)
            if (typeof value === 'string') headers[key] = value
          }

          replies.push({
            providerMessageId: parsed.messageId ?? `uid-${msg.uid}`,
            threadId: null,
            fromEmail: from.toLowerCase(),
            subject: parsed.subject ?? null,
            text: parsed.text ?? '',
            receivedAt: (parsed.date ?? new Date()).toISOString(),
            headers,
          })
        }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => {
        // Logout failing after a successful read must not discard the replies.
      })
    }

    return {
      replies,
      next: { cursor: String(highestUid), syncedAt: new Date().toISOString() },
    }
  }

  getCapabilities(account: EmailAccountHandle): EmailCapabilities {
    return capabilitiesFor('smtp', account.configuration)
  }

  async getStatus(account: EmailAccountHandle): Promise<AccountStatusReport> {
    const test = await this.testConnection(account)

    return {
      reachable: test.ok,
      /*
       * ⚠️ NULL, NOT A GUESS. SMTP exposes no quota, and inventing a plausible
       * ceiling would be worse than admitting ignorance — the scheduler would
       * pace sends against a number nobody verified. Phase 13 derives a limit
       * from observed behaviour and the customer's own configured ramp.
       */
      dailySendLimit: null,
      sentToday: null,
      code: test.ok ? null : test.code,
      message: test.ok ? null : test.message,
    }
  }
}

export const smtpProvider = new SmtpProvider()
