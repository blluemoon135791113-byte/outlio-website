/**
 * Which URLs the server may fetch.
 *
 * ⚠️ THE REJECTIONS CARRY ALL THE WEIGHT. Hubble fetches URLs chosen by a
 * search engine and an LLM — neither is trusted input. A poisoned result
 * pointing at the cloud metadata endpoint would make our own server read
 * credentials and hand them to a model.
 */
import { describe, expect, it } from 'vitest'

import { isPrivateAddress, screenUrl } from '@/lib/hubble/net/guard'

describe('screenUrl', () => {
  it('allows an ordinary public page', () => {
    for (const url of [
      'https://example.com/about',
      'http://example.com',
      'https://sub.example.co.uk/careers?x=1',
      'https://example.com:443/x',
    ]) {
      expect(screenUrl(url).allowed, url).toBe(true)
    }
  })

  it('REFUSES the cloud metadata endpoints', () => {
    // The single most damaging target: reachable, unauthenticated, and it
    // returns credentials.
    for (const url of [
      'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://[::ffff:169.254.169.254]/',
    ]) {
      expect(screenUrl(url).allowed, url).toBe(false)
    }
  })

  it('REFUSES loopback and private ranges', () => {
    for (const url of [
      'http://127.0.0.1:8888/search',
      'http://localhost/admin',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://[::1]/',
      'http://0.0.0.0/',
    ]) {
      expect(screenUrl(url).allowed, url).toBe(false)
    }
  })

  it('REFUSES non-http schemes', () => {
    for (const url of [
      'file:///etc/passwd',
      'data:text/html,<script>x</script>',
      'javascript:alert(1)',
      'gopher://example.com/',
    ]) {
      expect(screenUrl(url).allowed, url).toBe(false)
    }
  })

  it('refuses credentials in the URL', () => {
    // A redirect-laundering trick, never a real source.
    expect(screenUrl('http://user:pass@example.com/').allowed).toBe(false)
  })

  it('refuses internal-looking hostnames and odd ports', () => {
    for (const url of [
      'http://intranet/',
      'http://db.internal/',
      'http://printer.local/',
      'http://example.com:8080/',
      'http://example.com:22/',
    ]) {
      expect(screenUrl(url).allowed, url).toBe(false)
    }
  })

  it('is not fooled by a trailing dot', () => {
    // `localhost.` and `localhost` are the same host to a resolver.
    expect(screenUrl('http://localhost./').allowed).toBe(false)
  })
})

describe('isPrivateAddress', () => {
  it('treats anything that is not a public IP as private', () => {
    // ⚠️ FAIL CLOSED. An unparseable address must not be assumed routable.
    for (const value of ['not-an-ip', '', '999.1.1.1']) {
      expect(isPrivateAddress(value), value).toBe(true)
    }
  })

  it('allows genuine public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']) {
      expect(isPrivateAddress(ip), ip).toBe(false)
    }
  })

  it('catches the IPv4-mapped spelling of a reserved address', () => {
    // `::ffff:169.254.169.254` reaches metadata by another name.
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true)
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true)
  })
})
