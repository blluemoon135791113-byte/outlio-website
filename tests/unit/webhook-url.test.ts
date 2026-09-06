/**
 * Where an outbound webhook may point — M8 Phase 25.5.
 *
 * ⚠️ "POST THIS WHEREVER I SAY" MEANS OUR SERVERS MAKE REQUESTS ON A
 * CUSTOMER'S BEHALF. Pointed at 169.254.169.254 that reaches the cloud
 * metadata service. We never return the body, so it is a blind SSRF rather
 * than a read primitive — but a blind POST to an internal admin endpoint is
 * still an attack, and the delivery log leaks the status code back.
 */
import { describe, expect, it } from 'vitest'

import { assertSafeWebhookUrl, UnsafeWebhookUrlError } from '@/lib/api/webhook-url'

/** Production semantics: loopback is not exempt. */
const strict = (url: string) => () => assertSafeWebhookUrl(url, false)

describe('private and reserved networks are refused', () => {
  it.each([
    ['https://169.254.169.254/latest/meta-data/', 'cloud metadata'],
    ['https://127.0.0.1/hook', 'loopback'],
    ['https://10.0.0.5/hook', 'RFC 1918'],
    ['https://172.16.0.1/hook', 'RFC 1918'],
    ['https://192.168.1.1/hook', 'RFC 1918'],
    ['https://100.64.0.1/hook', 'carrier-grade NAT'],
    ['https://0.0.0.0/hook', 'this network'],
    ['https://localhost/hook', 'loopback by name'],
    ['https://admin.localhost/hook', 'a .localhost subdomain'],
    ['https://[::1]/hook', 'IPv6 loopback'],
    ['https://[fd00::1]/hook', 'IPv6 unique local'],
    ['https://[::ffff:169.254.169.254]/hook', 'IPv4-mapped metadata'],
  ])('refuses %s (%s)', (url) => {
    expect(strict(url)).toThrow(UnsafeWebhookUrlError)
  })

  it('allows 172.32.x, which is public despite looking like RFC 1918', () => {
    // The private range stops at 172.31. Over-blocking a real endpoint is a
    // support ticket, so the boundary is tested in both directions.
    expect(strict('https://172.32.0.1/hook')).not.toThrow()
  })
})

describe('https is required', () => {
  it('refuses plain http to a public host', () => {
    /*
     * The payload carries a customer's own CRM data. A signature proves who
     * SENT a message, not that nobody read it in transit.
     */
    expect(strict('http://example.com/hook')).toThrow(/https/)
  })

  it('refuses other schemes outright', () => {
    for (const url of ['ftp://example.com', 'file:///etc/passwd', 'gopher://example.com']) {
      expect(strict(url)).toThrow(UnsafeWebhookUrlError)
    }
  })

  it('refuses credentials embedded in the URL', () => {
    // They would be sent on every delivery and stored in plaintext on the row.
    expect(strict('https://user:pass@example.com/hook')).toThrow(/username and password/)
  })

  it('refuses something that is not a URL at all', () => {
    expect(strict('not a url')).toThrow(/valid URL/)
  })
})

describe('the loopback carve-out', () => {
  it('permits http to localhost only when explicitly allowed', () => {
    // A developer testing against their own machine is how webhook
    // integrations are actually built...
    expect(() => assertSafeWebhookUrl('http://127.0.0.1:3000/hook', true)).not.toThrow()
    expect(() => assertSafeWebhookUrl('http://localhost:3000/hook', true)).not.toThrow()
    // ...and production never allows it.
    expect(() => assertSafeWebhookUrl('http://127.0.0.1:3000/hook', false)).toThrow()
  })

  it('does NOT extend the carve-out to the rest of the private network', () => {
    // Allowing loopback for local development must not become a hole for
    // everything behind the firewall.
    expect(() => assertSafeWebhookUrl('http://10.0.0.5/hook', true)).toThrow()
    expect(() => assertSafeWebhookUrl('https://169.254.169.254/', true)).toThrow()
  })
})

describe('ordinary endpoints still work', () => {
  it.each([
    'https://hooks.slack.com/services/T00/B00/xxx',
    'https://example.com/webhooks/outlio',
    'https://api.customer.co.uk:8443/inbound',
    'https://a-very-long-subdomain.example.com/path?token=abc',
  ])('accepts %s', (url) => {
    expect(strict(url)).not.toThrow()
  })
})
