/**
 * SPF and DMARC record parsing — M5 Phase 13.
 *
 * Parsed from record text rather than from live DNS, so every rule below is
 * pinned without a network. The lookups themselves are a thin wrapper.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { isAligned, parseDmarc, parseSpf } from '@/lib/email/dns'

/** DNS TXT records arrive as arrays of chunks, which must be joined. */
const txt = (...records: string[]) => records.map((r) => [r])

describe('SPF', () => {
  it('passes a record that rejects unauthorised senders', () => {
    expect(parseSpf(txt('v=spf1 include:_spf.google.com ~all')).status).toBe('pass')
    expect(parseSpf(txt('v=spf1 mx -all')).status).toBe('pass')
  })

  it('fails when no SPF record exists', () => {
    expect(parseSpf(txt('some-other-verification=abc123')).status).toBe('fail')
    expect(parseSpf([]).status).toBe('fail')
  })

  it('FAILS on two SPF records, which is the standard’s own rule', () => {
    /*
     * RFC 7208: a domain publishing more than one SPF record MUST be treated
     * as permerror. The receiver does not pick one — it stops authenticating
     * the domain entirely. This is a common, invisible misconfiguration:
     * someone adds a second record for a new provider instead of merging.
     */
    const result = parseSpf(txt('v=spf1 include:_spf.google.com ~all', 'v=spf1 include:mailgun.org ~all'))
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('Merge them')
  })

  it('fails +all, which authorises the entire internet', () => {
    const result = parseSpf(txt('v=spf1 +all'))
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('worse than having no SPF')
  })

  it('warns on a neutral ?all', () => {
    expect(parseSpf(txt('v=spf1 include:example.com ?all')).status).toBe('warn')
  })

  it('warns when there is no all mechanism at all', () => {
    expect(parseSpf(txt('v=spf1 include:example.com')).status).toBe('warn')
  })

  it('joins chunked records before parsing', () => {
    // TXT records over 255 characters arrive split, and a parser that reads
    // only the first chunk would see a truncated record.
    expect(parseSpf([['v=spf1 include:a.example.com ', 'include:b.example.com ~all']]).status).toBe(
      'pass',
    )
  })

  it('is case-insensitive, since DNS records are', () => {
    expect(parseSpf(txt('V=SPF1 MX -ALL')).status).toBe('pass')
  })
})

describe('DMARC', () => {
  it('passes p=reject and p=quarantine', () => {
    expect(parseDmarc(txt('v=DMARC1; p=reject; rua=mailto:d@acme.example')).status).toBe('pass')
    expect(parseDmarc(txt('v=DMARC1; p=quarantine')).status).toBe('pass')
  })

  it('reports the policy it found', () => {
    expect(parseDmarc(txt('v=DMARC1; p=quarantine')).policy).toBe('quarantine')
  })

  it('fails when there is no DMARC record', () => {
    const result = parseDmarc([])
    expect(result.status).toBe('fail')
    // Google and Yahoo have required this of bulk senders since 2024.
    expect(result.detail).toContain('Google and Yahoo')
  })

  it('WARNS rather than fails on p=none', () => {
    /*
     * p=none is monitoring only, but it satisfies the bulk-sender requirement
     * and is the correct FIRST step. Marking it failed would push customers
     * straight to p=reject, which without prior monitoring blocks their own
     * legitimate mail.
     */
    const result = parseDmarc(txt('v=DMARC1; p=none; rua=mailto:d@acme.example'))
    expect(result.status).toBe('warn')
    expect(result.detail).toContain('move to `quarantine`')
  })

  it('warns when a record declares no policy', () => {
    expect(parseDmarc(txt('v=DMARC1; rua=mailto:d@acme.example')).status).toBe('warn')
  })

  it('tolerates whitespace around the policy', () => {
    expect(parseDmarc(txt('v=DMARC1 ; p = reject ; sp=none')).policy).toBe('reject')
  })

  it('ignores unrelated TXT records at _dmarc', () => {
    expect(parseDmarc(txt('some-verification=xyz', 'v=DMARC1; p=reject')).status).toBe('pass')
  })
})

describe('from-domain alignment', () => {
  it('aligns an exact match', () => {
    expect(isAligned('acme.example', 'acme.example')).toBe(true)
  })

  it('aligns a subdomain with its organisational domain', () => {
    /*
     * DMARC alignment is RELAXED by default, so mail.acme.example aligns with
     * acme.example. Requiring an exact match would report a correct setup as
     * broken.
     */
    expect(isAligned('mail.acme.example', 'acme.example')).toBe(true)
    expect(isAligned('acme.example', 'mail.acme.example')).toBe(true)
  })

  it('does not align two different domains', () => {
    expect(isAligned('acme.example', 'other.example')).toBe(false)
  })

  it('does not align a domain that merely ends with the same letters', () => {
    // notacme.example must not align with acme.example.
    expect(isAligned('notacme.example', 'acme.example')).toBe(false)
  })

  it('does not align when either side is missing', () => {
    expect(isAligned('', 'acme.example')).toBe(false)
    expect(isAligned('acme.example', '')).toBe(false)
  })
})

describe('the DKIM selectors we guess', () => {
  /**
   * ╔═══════════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ THIS PRODUCT SENDS THROUGH ZOHO AND COULD NOT SEE ITS OWN DKIM KEY.   ║
   * ║                                                                           ║
   * ║  Measured against `outlio.io` on 2026-09-05 — the domain in               ║
   * ║  `email_accounts.from_domain`, whose SPF is `v=spf1 include:zohomail.com`: ║
   * ║                                                                           ║
   * ║      dig +short TXT zoho._domainkey.outlio.io   → (nothing)               ║
   * ║      dig +short TXT zmail._domainkey.outlio.io  → "v=DKIM1; k=rsa; p=…"   ║
   * ║                                                                           ║
   * ║  The list had `zoho` and not `zmail`, so `checkDomainAuth` reported DKIM  ║
   * ║  `unknown` for a domain that is correctly configured.                     ║
   * ║                                                                           ║
   * ║  ⚠️ REPORTING `unknown` RATHER THAN `fail` IS THE RIGHT CALL AND IS WHAT  ║
   * ║  HID THIS. A false negative that is careful about its own uncertainty     ║
   * ║  reads as honest, so nobody goes looking. It is not cosmetic: Gmail and   ║
   * ║  Yahoo's bulk-sender rules require DKIM, and Phase 7 turns on exactly     ║
   * ║  this surface being right.                                               ║
   * ╚═══════════════════════════════════════════════════════════════════════════╝
   */
  const source = readFileSync(join(__dirname, '..', '..', 'lib/email/dns.ts'), 'utf8')
  const list = source.slice(
    source.indexOf('const COMMON_DKIM_SELECTORS'),
    source.indexOf('] as const', source.indexOf('const COMMON_DKIM_SELECTORS')),
  )

  it('includes zmail, which is the selector Zoho actually publishes', () => {
    expect(
      /'zmail'/.test(list),
      "`zmail` is gone. outlio.io publishes its DKIM key there and nowhere else, " +
        'so removing it makes this product blind to DKIM on its own sending domain.',
    ).toBe(true)
  })

  it('still covers the other providers it claims to', () => {
    // A positive control: without it, an emptied list would pass the check above
    // only by accident of the string never being found either way.
    for (const selector of ['google', 'selector1', 'k1', 's1', 'zoho', 'fm1']) {
      expect(list, `${selector} was dropped from the selector list`).toContain(`'${selector}'`)
    }
  })
})
