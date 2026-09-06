/**
 * SMTP + IMAP adapter, against a REAL mail server — M5 Phase 12.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE BRIEF FORBIDS INVENTING PROVIDER BEHAVIOUR.                          ║
 * ║                                                                           ║
 * ║  "Never invent provider API capabilities; verify against real provider    ║
 * ║  behavior/sandbox accounts." A mocked transport would prove only that the ║
 * ║  mock was called — it cannot tell you that STARTTLS negotiated, that the  ║
 * ║  UID cursor actually resumes, or that headers survive a real round trip.  ║
 * ║                                                                           ║
 * ║  So this runs GreenMail, a real SMTP and IMAPS server, in Docker:         ║
 * ║                                                                           ║
 * ║    docker run -d --name outlio-greenmail -p 2525:3025 -p 993:3993 \       ║
 * ║      -e GREENMAIL_OPTS='-Dgreenmail.setup.test.all \                      ║
 * ║        -Dgreenmail.hostname=0.0.0.0 \                                     ║
 * ║        -Dgreenmail.users=sender:senderpw@acme.example,replier:replierpw@other.example' \
 * ║      greenmail/standalone:2.1.4                                           ║
 * ║                                                                           ║
 * ║  It SKIPS rather than fails when the server is absent, so a checkout      ║
 * ║  without Docker still runs a green suite — but it is skipped loudly.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Only the credential lookup is mocked, because that is Postgres rather than
 * mail. Every byte of SMTP and IMAP here is real.
 */
import { createConnection } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const SMTP_PORT = 2525
const IMAP_PORT = 993

const SECRET = {
  smtpUsername: 'sender',
  smtpPassword: 'senderpw',
  imapUsername: 'sender',
  imapPassword: 'senderpw',
}

// ⚠️ Only the database read is faked. The adapter's own logic, the transport,
// the TLS negotiation and the IMAP protocol are all exercised for real.
vi.mock('@/lib/email/accounts', () => ({
  readAccountSecret: async () => SECRET,
}))

const { SmtpProvider } = await import('@/lib/email/providers/smtp')
const { EmailCapabilityError } = await import('@/lib/email/provider')
type Handle = import('@/lib/email/provider').EmailAccountHandle

function reachable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port, timeout: 1500 })
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

let available = false

beforeAll(async () => {
  available = (await reachable(SMTP_PORT)) && (await reachable(IMAP_PORT))
  if (!available) {
    console.warn(
      `\n  SKIPPING the SMTP adapter integration tests: no mail server on ` +
        `127.0.0.1:${SMTP_PORT}/${IMAP_PORT}. Start GreenMail (see the header ` +
        `of this file) to run them.\n`,
    )
  }
})

const provider = new SmtpProvider()

const sendOnly: Handle = {
  id: 'acct-send-only',
  workspaceId: 'ws-1',
  provider: 'smtp',
  fromEmail: 'sender@acme.example',
  fromName: 'Acme Sales',
  configuration: { smtpHost: 'localhost', smtpPort: SMTP_PORT },
  secretReference: 'ref-1',
}

const withImap: Handle = {
  ...sendOnly,
  id: 'acct-with-imap',
  configuration: {
    smtpHost: 'localhost',
    smtpPort: SMTP_PORT,
    imapHost: 'localhost',
    imapPort: IMAP_PORT,
  },
}

describe.runIf(process.env.VITEST_SMTP !== 'off')('SMTP adapter against a real server', () => {
  it('connects and verifies a send-only account', async ({ skip }) => {
    if (!available) return skip()

    const result = await provider.testConnection(sendOnly)
    expect(result.ok).toBe(true)
  })

  it('actually delivers a message', async ({ skip }) => {
    if (!available) return skip()

    const result = await provider.send(sendOnly, {
      to: 'replier@other.example',
      subject: 'Quick question about your Q3 roadmap',
      text: 'Hi — worth a chat?',
      html: '<p>Hi — worth a chat?</p>',
      idempotencyKey: 'msg-key-0001',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // The Message-ID is derived from the idempotency key, so a duplicate is
    // provable rather than merely suspected.
    expect(result.providerMessageId).toContain('msg-key-0001')
    expect(result.providerMessageId).toContain('acme.example')
  })

  it('produces the SAME Message-ID when a retry reuses the key', async ({ skip }) => {
    if (!available) return skip()

    const send = () =>
      provider.send(sendOnly, {
        to: 'replier@other.example',
        subject: 'Retried',
        text: 'body',
        html: null,
        idempotencyKey: 'retry-key-42',
      })

    const first = await send()
    const second = await send()

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    /*
     * ⚠️ BOTH WERE DELIVERED, AND THAT IS THE POINT. SMTP has no dedupe verb,
     * so an identical Message-ID does NOT stop a second delivery. This test
     * pins that reality so nobody mistakes the stable id for the exactly-once
     * guarantee — which M5 criterion 3 places in Phase 14's engine, where the
     * key is recorded BEFORE the message is handed over.
     */
    expect(first.providerMessageId).toBe(second.providerMessageId)
  })

  it('reads a reply back over IMAP and normalizes it', async ({ skip }) => {
    if (!available) return skip()

    // Deliver a message INTO the sender's own mailbox, which is what an actual
    // reply would be.
    const delivered = await provider.send(withImap, {
      to: 'sender@acme.example',
      subject: 'Re: Quick question about your Q3 roadmap',
      text: 'Yes — Thursday works.',
      html: null,
      idempotencyKey: 'reply-key-0001',
    })
    expect(delivered.ok).toBe(true)

    const { replies, next } = await provider.syncReplies(withImap, {
      cursor: null,
      syncedAt: new Date(0).toISOString(),
    })

    expect(replies.length).toBeGreaterThan(0)
    const reply = replies.find((r) => r.subject?.includes('Q3 roadmap'))
    expect(reply).toBeDefined()
    expect(reply!.fromEmail).toBe('sender@acme.example')
    expect(reply!.text).toContain('Thursday works')

    // The cursor is a UID, and it advanced.
    expect(Number(next.cursor)).toBeGreaterThan(0)
  })

  it('resumes from the UID cursor instead of re-reading the mailbox', async ({ skip }) => {
    if (!available) return skip()

    const first = await provider.syncReplies(withImap, {
      cursor: null,
      syncedAt: new Date(0).toISOString(),
    })
    expect(first.replies.length).toBeGreaterThan(0)

    // Immediately syncing again from the returned cursor must find nothing
    // new. A date-based cursor would re-read the whole day here, which is how
    // a reply gets processed — and a sequence stopped — twice.
    const second = await provider.syncReplies(withImap, first.next)
    expect(second.replies).toHaveLength(0)

    // ...and a message that arrives after the cursor IS picked up.
    await provider.send(withImap, {
      to: 'sender@acme.example',
      subject: 'A later message',
      text: 'after the cursor',
      html: null,
      idempotencyKey: 'after-cursor-1',
    })

    const third = await provider.syncReplies(withImap, second.next)
    expect(third.replies.some((r) => r.subject === 'A later message')).toBe(true)
  })

  it('reports no quota rather than inventing one', async ({ skip }) => {
    if (!available) return skip()

    const status = await provider.getStatus(sendOnly)
    expect(status.reachable).toBe(true)
    // SMTP exposes no quota. A plausible-looking guess would have the
    // scheduler pacing sends against a number nobody verified.
    expect(status.dailySendLimit).toBeNull()
    expect(status.sentToday).toBeNull()
  })
})

describe('capability gating is enforced, not merely advertised', () => {
  it('refuses to sync replies for an account with no IMAP host', async () => {
    // This is M5 criterion 2 at the point it matters: the capability model
    // says `unconfigured`, and the adapter actually refuses rather than
    // silently returning an empty list that would read as "no replies yet".
    await expect(
      provider.syncReplies(sendOnly, { cursor: null, syncedAt: new Date(0).toISOString() }),
    ).rejects.toThrow(EmailCapabilityError)
  })

  it('refuses to accept a webhook, since SMTP has no push channel', async () => {
    await expect(provider.receiveProviderEvent()).rejects.toThrow(EmailCapabilityError)
  })

  it('reports replies as unconfigured until an IMAP host is set', () => {
    expect(provider.getCapabilities(sendOnly).replies).toBe('unconfigured')
    expect(provider.getCapabilities(withImap).replies).toBe('supported')
  })
})

afterAll(() => {
  vi.restoreAllMocks()
})
