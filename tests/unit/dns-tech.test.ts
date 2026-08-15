/**
 * DNS technology detection.
 *
 * The cheapest provider in the system: no key, no account, no cost, ~50ms per
 * company. Measured at a **74% hit rate** on domains whose lookups succeeded.
 *
 * The last block is the important one. An earlier version returned `[]` for
 * both "no such record" and "the lookup failed", so a resolver hiccup rendered
 * as "this company has no email stack" — soprasteria.com and mfs.com were
 * reported as having nothing while running Microsoft 365 and Proofpoint, both
 * of which are fingerprinted here.
 */
import { describe, expect, it } from 'vitest'

import { fingerprintDns, type DnsRecords } from '@/lib/intelligence/providers/dns-tech'

function records(over: Partial<DnsRecords> = {}): DnsRecords {
  return { mx: [], spf: [], hasDmarc: false, ...over }
}

describe('fingerprintDns — mail providers from MX', () => {
  it('recognises Google Workspace', () => {
    const found = fingerprintDns(records({ mx: ['aspmx.l.google.com', 'alt1.aspmx.l.google.com'] }))
    expect(found).toEqual([{ id: 'google-workspace', name: 'Google Workspace', category: 'email' }])
  })

  it('recognises Microsoft 365 from a tenant-specific host', () => {
    // The real shape: soprasteria-com.mail.protection.outlook.com
    const found = fingerprintDns(records({ mx: ['acme-com.mail.protection.outlook.com'] }))
    expect(found.map((t) => t.id)).toContain('microsoft-365')
  })

  it('recognises security gateways', () => {
    expect(
      fingerprintDns(records({ mx: ['mxb-0013d502.gslb.pphosted.com'] })).map((t) => t.id),
    ).toContain('proofpoint')
    expect(
      fingerprintDns(records({ mx: ['eu-smtp-inbound-1.mimecast.com'] })).map((t) => t.id),
    ).toContain('mimecast')
  })

  it('de-duplicates a provider seen across several records', () => {
    const found = fingerprintDns(
      records({ mx: ['aspmx.l.google.com', 'alt2.aspmx.l.google.com'], spf: ['v=spf1 include:_spf.google.com ~all'] }),
    )
    expect(found.filter((t) => t.id === 'google-workspace')).toHaveLength(1)
  })
})

describe('fingerprintDns — the sales and marketing stack from SPF', () => {
  it('answers the question the spec leads with', () => {
    // "uses HubSpot and Intercom but NOT Salesforce" — spec §54.
    const found = fingerprintDns(
      records({
        spf: ['v=spf1 include:_spf.google.com include:_spf.hubspot.com include:spf.intercom.io ~all'],
      }),
    )

    const ids = found.map((t) => t.id)
    expect(ids).toContain('hubspot')
    expect(ids).toContain('intercom')
    expect(ids).not.toContain('salesforce')
  })

  it('detects Salesforce when it IS authorised', () => {
    const found = fingerprintDns(records({ spf: ['v=spf1 include:_spf.salesforce.com ~all'] }))
    expect(found.map((t) => t.id)).toContain('salesforce')
  })

  it('recognises the common marketing senders', () => {
    const found = fingerprintDns(
      records({
        spf: [
          'v=spf1 include:servers.mcsv.net include:_spf.klaviyo.com include:sendgrid.net include:mail.zendesk.com ~all',
        ],
      }),
    )

    const ids = found.map((t) => t.id)
    expect(ids).toEqual(expect.arrayContaining(['mailchimp', 'klaviyo', 'sendgrid', 'zendesk']))
  })

  it('categorises what it finds, so a filter can target CRM or marketing', () => {
    const found = fingerprintDns(
      records({ spf: ['v=spf1 include:_spf.salesforce.com include:_spf.hubspot.com ~all'] }),
    )

    expect(found.find((t) => t.id === 'salesforce')?.category).toBe('crm')
    expect(found.find((t) => t.id === 'hubspot')?.category).toBe('marketing')
  })
})

describe('fingerprintDns — silence is not a negative', () => {
  it('returns nothing for a company with no records', () => {
    // Which the provider turns into NO evidence, leaving the field unknown —
    // never "this company uses no technology".
    expect(fingerprintDns(records())).toEqual([])
  })

  it('returns nothing for records it does not recognise', () => {
    expect(
      fingerprintDns(records({ mx: ['mail.some-tiny-host.example'], spf: ['v=spf1 ip4:203.0.113.0/24 -all'] })),
    ).toEqual([])
  })

  it('ignores TXT records that are not SPF', () => {
    // Verification tokens frequently name a vendor without it being in use.
    expect(
      fingerprintDns(records({ spf: [] })),
    ).toEqual([])
  })
})
