/**
 * Where a mail connection is allowed to point — M5 Phase 12.
 *
 * SMTP and IMAP hostnames are typed in by the customer, which makes
 * "connect here and tell me whether it worked" a port scanner unless the
 * destination is constrained. The cloud metadata endpoint (169.254.169.254) is
 * the case that turns a settings form into a credential leak.
 */
import { describe, expect, it } from 'vitest'

import {
  assertSafeMailEndpoint,
  UnsafeMailEndpointError,
} from '@/lib/email/providers/smtp-address'

/** Production semantics: loopback is not exempt. */
const strict = (host: string, port = 587, kind: 'smtp' | 'imap' = 'smtp') =>
  () => assertSafeMailEndpoint(kind, host, port, false)

describe('private and reserved networks are refused', () => {
  it.each([
    ['169.254.169.254', 'cloud metadata — reads IAM credentials'],
    ['127.0.0.1', 'the worker itself'],
    ['10.0.0.5', 'RFC 1918'],
    ['172.16.0.1', 'RFC 1918'],
    ['172.31.255.254', 'RFC 1918 upper bound'],
    ['192.168.1.1', 'RFC 1918'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['0.0.0.0', 'this network'],
    ['224.0.0.1', 'multicast'],
    ['localhost', 'by name'],
    ['db.localhost', 'a .localhost subdomain'],
    ['::1', 'IPv6 loopback'],
    ['fd00::1', 'IPv6 unique local'],
    ['fe80::1', 'IPv6 link-local'],
  ])('refuses %s (%s)', (host) => {
    expect(strict(host)).toThrow(UnsafeMailEndpointError)
  })

  it('refuses an IPv4-mapped IPv6 address in both spellings', () => {
    /*
     * `::ffff:169.254.169.254` is the metadata endpoint wearing an IPv6 coat,
     * and a v4-only check would wave it through.
     *
     * Both forms are asserted because they are refused by DIFFERENT rules: the
     * bare form trips the "colon outside brackets" check, while the bracketed
     * form is legal syntax and must be caught by the IPv6 range check itself.
     * Testing only the bare form would leave the range check unproven.
     */
    expect(strict('::ffff:169.254.169.254')).toThrow(UnsafeMailEndpointError)
    expect(strict('[::ffff:169.254.169.254]')).toThrow(UnsafeMailEndpointError)
  })

  it('refuses a bracketed IPv6 loopback and unique-local address', () => {
    expect(strict('[::1]')).toThrow(UnsafeMailEndpointError)
    expect(strict('[fd00::1]')).toThrow(UnsafeMailEndpointError)
  })

  it('allows 172.32.x, which is public despite looking like RFC 1918', () => {
    // The private range stops at 172.31. Over-blocking a real customer's mail
    // server is a support ticket, so the boundary is tested in both directions.
    expect(strict('172.32.0.1')).not.toThrow()
  })
})

describe('hostnames that hide their destination are refused', () => {
  it.each([
    ['http://10.0.0.1/', 'a URL rather than a host'],
    ['evil.com@10.0.0.1', 'userinfo pointing elsewhere'],
    ['mail.example.com:25', 'a port glued on'],
    ['mail.example.com/path', 'a path'],
    ['mail example com', 'whitespace'],
    ['mail.example.com\\x', 'a backslash'],
  ])('refuses %s (%s)', (host) => {
    expect(strict(host)).toThrow(UnsafeMailEndpointError)
  })

  it('refuses an empty host with a clear message', () => {
    expect(strict('   ')).toThrow(/hostname is required/)
  })
})

describe('only real mail ports are allowed', () => {
  it.each([587, 465, 25, 2525])('allows SMTP port %i', (port) => {
    expect(strict('smtp.example.com', port)).not.toThrow()
  })

  it.each([143, 993])('allows IMAP port %i', (port) => {
    expect(strict('imap.example.com', port, 'imap')).not.toThrow()
  })

  it.each([22, 3306, 6379, 8080, 11211])('refuses port %i', (port) => {
    // Without this, the connection test is a general-purpose port scanner
    // for whatever network the worker sits in.
    expect(strict('scan.example.com', port)).toThrow(UnsafeMailEndpointError)
  })

  it('does not accept an IMAP port for an SMTP connection', () => {
    expect(strict('mail.example.com', 993, 'smtp')).toThrow(UnsafeMailEndpointError)
  })
})

describe('the loopback carve-out', () => {
  it('permits localhost only when explicitly allowed', () => {
    // Non-production allows it so the integration test can reach a mail
    // server in a container...
    expect(() => assertSafeMailEndpoint('smtp', 'localhost', 2525, true)).not.toThrow()
    // ...and production never does.
    expect(() => assertSafeMailEndpoint('smtp', 'localhost', 2525, false)).toThrow()
  })

  it('does NOT extend the carve-out to other private addresses', () => {
    // Allowing loopback for local testing must not become a hole for the
    // whole private network.
    expect(() => assertSafeMailEndpoint('smtp', '10.0.0.5', 587, true)).toThrow(
      UnsafeMailEndpointError,
    )
    expect(() => assertSafeMailEndpoint('smtp', '169.254.169.254', 587, true)).toThrow(
      UnsafeMailEndpointError,
    )
  })
})

describe('ordinary mail servers still work', () => {
  it.each([
    'smtp.gmail.com',
    'smtp.office365.com',
    'smtp.mailgun.org',
    'email-smtp.eu-west-1.amazonaws.com',
    'mail.a-very-long-subdomain.example.co.uk',
  ])('accepts %s', (host) => {
    expect(strict(host)).not.toThrow()
  })
})

/**
 * Connection failures must say something the customer can act on.
 *
 * ⚠️ A HOSTNAME TYPO IS THE MOST LIKELY MISTAKE when connecting a mailbox, and
 * it was originally reported as "The mail server returned an error" — which
 * sends someone to check their password. Found by actually using the connect
 * form against a host that does not exist.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { classifySmtpErrorForTest } from '@/lib/email/providers/smtp'

describe('connection error messages are actionable', () => {
  it('names a hostname that does not resolve, rather than blaming the server', () => {
    const result = classifySmtpErrorForTest({ code: 'ENOTFOUND' })
    expect(result.code).toBe('SMTP_HOST_NOT_FOUND')
    expect(result.message).toContain('typo')
    // Retrying a name that does not exist will never succeed.
    expect(result.retryable).toBe(false)
  })

  it('distinguishes unreachable from not-found', () => {
    const refused = classifySmtpErrorForTest({ code: 'ECONNREFUSED' })
    expect(refused.code).toBe('SMTP_UNREACHABLE')
    // A refused connection can succeed later; the host is real.
    expect(refused.retryable).toBe(true)
  })

  it('treats a bad password as permanent and says so', () => {
    const auth = classifySmtpErrorForTest({ code: 'EAUTH' })
    expect(auth.code).toBe('SMTP_AUTH')
    expect(auth.retryable).toBe(false)
  })

  /*
   * ╔═══════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ THE SHAPE ABOVE IS NOT THE SHAPE A REAL SERVER SENDS, AND THAT IS ║
   * ║  WHY THE BUG SURVIVED.                                                ║
   * ║                                                                       ║
   * ║  Gmail answers a bad app password with `535 5.7.8 Username and        ║
   * ║  Password not accepted`, so nodemailer reports BOTH `code: 'EAUTH'`   ║
   * ║  AND `responseCode: 535`. The classifier checked the 5xx range first, ║
   * ║  so the permanent branch won and the user connecting a mailbox was    ║
   * ║  told "the mail server rejected this message permanently" — during a  ║
   * ║  connection test, where there is no message.                          ║
   * ║                                                                       ║
   * ║  The test above passes either way, because it omits `responseCode`.   ║
   * ║  Coverage that models a simpler world than the one the code runs in.  ║
   * ╚═══════════════════════════════════════════════════════════════════════╝
   */
  it('reads a real Gmail auth rejection as auth, not as a permanent 5xx', () => {
    const gmail = classifySmtpErrorForTest({
      code: 'EAUTH',
      responseCode: 535,
      message: '535-5.7.8 Username and Password not accepted',
    })
    expect(gmail.code).toBe('SMTP_AUTH')
    expect(gmail.message).toContain('app password')
    expect(gmail.retryable).toBe(false)
  })

  it('reads 535 as auth even when the driver sets no EAUTH', () => {
    // RFC 4954: 535 is "authentication credentials invalid" and nothing else.
    const bare = classifySmtpErrorForTest({ responseCode: 535 })
    expect(bare.code).toBe('SMTP_AUTH')
  })

  it('does not claim a message was rejected during a connection test', () => {
    /*
     * The same classifier runs for sends and for `verify()`. A genuine 5xx on
     * connect is a refused connection; describing it as a rejected message
     * describes an event that did not happen.
     */
    const onConnect = classifySmtpErrorForTest({ responseCode: 550 }, 'connect')
    expect(onConnect.code).toBe('SMTP_PERMANENT')
    expect(onConnect.message).not.toContain('message')
    expect(onConnect.message).toContain('connection')

    const onSend = classifySmtpErrorForTest({ responseCode: 550 })
    expect(onSend.message).toContain('message')
  })

  it('the connect path asks for the connect wording', () => {
    // A classifier that can phrase correctly is no use if the caller does not
    // tell it which situation it is in.
    const source = readFileSync(
      join(__dirname, '..', '..', 'lib', 'email', 'providers', 'smtp.ts'),
      'utf8',
    )
    expect(source).toContain("classifySmtpError(error, 'connect')")
  })

  it('never leaks the provider’s own text, which can echo recipients', () => {
    const unknown = classifySmtpErrorForTest({ message: '550 no such user bob@private.example' })
    expect(unknown.message).not.toContain('bob@private.example')
  })
})

/**
 * A failed connection must not cost every field.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  REACT 19 CLEARS UNCONTROLLED FIELDS WHEN A FORM ACTION RETURNS.         ║
 * ║                                                                           ║
 * ║  Observed 2026-09-04: one wrong password wiped the address, both          ║
 * ║  hostnames, the username and the from-name as well. Connecting a mailbox  ║
 * ║  is the flow where the first attempt usually fails, so this landed on     ║
 * ║  every user, every time — and retyping six fields to correct one of them  ║
 * ║  is how somebody gives up on the feature.                                 ║
 * ║                                                                           ║
 * ║  Same defect, same fix, as `lib/auth/actions.ts`.                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
describe('the connect form survives a failed attempt', () => {
  const ACTIONS = readFileSync(
    join(__dirname, '..', '..', 'app', '(product)', 'email', 'actions.ts'),
    'utf8',
  )
  const FORM = readFileSync(
    join(__dirname, '..', '..', 'components', 'email', 'ConnectMailbox.tsx'),
    'utf8',
  )

  it('the action echoes what was typed', () => {
    expect(ACTIONS).toContain('values?: Record<string, string>')
    expect(ACTIONS).toContain('const reject = (error: string): ActionState')
  })

  it('every failure path echoes, not just the first', () => {
    /*
     * A `reject` helper that half the returns ignore is worse than none: the
     * field loss then depends on which error you hit, which is impossible to
     * reason about from the outside.
     */
    const body = ACTIONS.slice(
      ACTIONS.indexOf('export async function connectSmtpAccount'),
      ACTIONS.indexOf('export async function', ACTIONS.indexOf('export async function connectSmtpAccount') + 10),
    )
    // The permission refusal happens before any input is read, so it is exempt.
    const rawReturns = [...body.matchAll(/return \{ ok: false, error:/g)]
    expect(rawReturns.length, 'a failure path still returns without values').toBe(1)
    expect(body).toContain('return reject(')
  })

  it('never echoes the password', () => {
    /*
     * ⚠️ THE ONE FIELD THAT MUST BE RETYPED. Echoing a credential puts it in
     * the page source and in any error report that captures the DOM.
     */
    const values = ACTIONS.slice(ACTIONS.indexOf('const values = {'), ACTIONS.indexOf('const reject'))
    expect(values).not.toContain('password')
  })

  it('the form reads them back into every field', () => {
    for (const field of [
      'displayName', 'fromEmail', 'fromName', 'username', 'smtpHost', 'imapHost',
    ]) {
      expect(FORM, `${field} is not restored`).toContain(`prior.${field}`)
    }
    // Ports keep their sensible defaults but prefer what was typed.
    expect(FORM).toContain("prior.smtpPort ?? '587'")
    expect(FORM).toContain("prior.imapPort ?? '993'")
  })
})
