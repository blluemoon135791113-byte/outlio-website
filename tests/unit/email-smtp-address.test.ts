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
