import 'server-only'

/**
 * Technology detection from DNS records.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THE BEST VALUE-PER-COST PROVIDER IN THE SYSTEM.                         ║
 * ║                                                                          ║
 * ║  No API. No key. No account. No rate limit worth pacing. Node's built-in ║
 * ║  resolver, ~50ms per company, and it answers the question the spec       ║
 * ║  leads with — "uses HubSpot and Intercom but NOT Salesforce" (§54).      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Two records do the work:
 *
 *   MX   — who runs their mail: Google Workspace, Microsoft 365, Zoho…
 *   SPF  — every service authorised to send mail AS them. A company using
 *          HubSpot, Mailchimp or Salesforce has to list it here for its email
 *          to be delivered, so the record is a published inventory of their
 *          marketing and sales stack.
 *
 * ⚠️ SOURCE CONFIDENCE IS HIGH, AND EARNED. These records are published by the
 * company in its own zone. This is not a third party's opinion or a scraped
 * inference — it is the company stating, to the internet, which services act on
 * its behalf. Spec §17's definition of an official company source.
 *
 * ⚠️ WHAT IT CANNOT SEE. SPF only covers services that send email. A company
 * using Salesforce purely as an internal CRM may never authorise it to send, so
 * absence is NOT evidence of absence — it stays `unknown`, as always.
 */
import { promises as dns } from 'node:dns'

import { expiresAtFor } from '@/lib/intelligence/ttl'
import type {
  CompanyEntity,
  IntelligenceProvider,
  NormalizedEvidence,
  ResearchTask,
} from '@/lib/intelligence/types'

/** A resolver that never answers must not hold a research run open. */
const DNS_TIMEOUT_MS = 5_000

export type DetectedTech = {
  id: string
  name: string
  category: 'email' | 'marketing' | 'crm' | 'support' | 'infrastructure' | 'other'
}

type Fingerprint = { match: string; tech: DetectedTech }

/**
 * MX host fragment → mail provider.
 *
 * Ordered most specific first; matching stops at the first hit per record.
 */
const MX_FINGERPRINTS: Fingerprint[] = [
  { match: 'aspmx.l.google.com', tech: { id: 'google-workspace', name: 'Google Workspace', category: 'email' } },
  { match: 'googlemail.com', tech: { id: 'google-workspace', name: 'Google Workspace', category: 'email' } },
  { match: 'protection.outlook.com', tech: { id: 'microsoft-365', name: 'Microsoft 365', category: 'email' } },
  { match: 'mail.protection.outlook', tech: { id: 'microsoft-365', name: 'Microsoft 365', category: 'email' } },
  { match: 'zoho.com', tech: { id: 'zoho-mail', name: 'Zoho Mail', category: 'email' } },
  { match: 'zoho.eu', tech: { id: 'zoho-mail', name: 'Zoho Mail', category: 'email' } },
  { match: 'mimecast.com', tech: { id: 'mimecast', name: 'Mimecast', category: 'infrastructure' } },
  { match: 'pphosted.com', tech: { id: 'proofpoint', name: 'Proofpoint', category: 'infrastructure' } },
  { match: 'ppe-hosted.com', tech: { id: 'proofpoint', name: 'Proofpoint', category: 'infrastructure' } },
  { match: 'messagelabs.com', tech: { id: 'symantec-email', name: 'Symantec Email Security', category: 'infrastructure' } },
  { match: 'barracudanetworks.com', tech: { id: 'barracuda', name: 'Barracuda', category: 'infrastructure' } },
  { match: 'secureserver.net', tech: { id: 'godaddy-email', name: 'GoDaddy Email', category: 'email' } },
  { match: 'messagingengine.com', tech: { id: 'fastmail', name: 'Fastmail', category: 'email' } },
  { match: 'improvmx.com', tech: { id: 'improvmx', name: 'ImprovMX', category: 'email' } },
  { match: 'forwardemail.net', tech: { id: 'forwardemail', name: 'ForwardEmail', category: 'email' } },
  { match: 'titan.email', tech: { id: 'titan', name: 'Titan Email', category: 'email' } },
  { match: 'yandex', tech: { id: 'yandex-mail', name: 'Yandex Mail', category: 'email' } },
]

/**
 * SPF `include:` fragment → the service it authorises.
 *
 * This is the valuable half. A company cannot send marketing mail through
 * HubSpot, campaigns through Mailchimp, or cases through Zendesk without
 * naming them here.
 */
const SPF_FINGERPRINTS: Fingerprint[] = [
  { match: '_spf.google.com', tech: { id: 'google-workspace', name: 'Google Workspace', category: 'email' } },
  { match: 'spf.protection.outlook.com', tech: { id: 'microsoft-365', name: 'Microsoft 365', category: 'email' } },

  { match: 'hubspot.com', tech: { id: 'hubspot', name: 'HubSpot', category: 'marketing' } },
  { match: 'hubspotemail.net', tech: { id: 'hubspot', name: 'HubSpot', category: 'marketing' } },
  { match: 'salesforce.com', tech: { id: 'salesforce', name: 'Salesforce', category: 'crm' } },
  { match: 'pardot.com', tech: { id: 'pardot', name: 'Pardot', category: 'marketing' } },
  { match: 'mktomail.com', tech: { id: 'marketo', name: 'Marketo', category: 'marketing' } },
  { match: 'marketo.com', tech: { id: 'marketo', name: 'Marketo', category: 'marketing' } },
  { match: 'servers.mcsv.net', tech: { id: 'mailchimp', name: 'Mailchimp', category: 'marketing' } },
  { match: 'mailchimp', tech: { id: 'mailchimp', name: 'Mailchimp', category: 'marketing' } },
  { match: 'klaviyo', tech: { id: 'klaviyo', name: 'Klaviyo', category: 'marketing' } },
  { match: 'createsend.com', tech: { id: 'campaign-monitor', name: 'Campaign Monitor', category: 'marketing' } },
  { match: 'brevo.com', tech: { id: 'brevo', name: 'Brevo', category: 'marketing' } },
  { match: 'sendinblue.com', tech: { id: 'brevo', name: 'Brevo', category: 'marketing' } },
  { match: 'customeriomail.com', tech: { id: 'customer-io', name: 'Customer.io', category: 'marketing' } },

  { match: 'intercom', tech: { id: 'intercom', name: 'Intercom', category: 'support' } },
  { match: 'zendesk.com', tech: { id: 'zendesk', name: 'Zendesk', category: 'support' } },
  { match: 'freshdesk.com', tech: { id: 'freshdesk', name: 'Freshdesk', category: 'support' } },
  { match: 'helpscoutemail.com', tech: { id: 'help-scout', name: 'Help Scout', category: 'support' } },

  { match: 'sendgrid.net', tech: { id: 'sendgrid', name: 'SendGrid', category: 'infrastructure' } },
  { match: 'mailgun.org', tech: { id: 'mailgun', name: 'Mailgun', category: 'infrastructure' } },
  { match: 'amazonses.com', tech: { id: 'amazon-ses', name: 'Amazon SES', category: 'infrastructure' } },
  { match: 'mandrillapp.com', tech: { id: 'mandrill', name: 'Mandrill', category: 'infrastructure' } },
  { match: 'mtasv.net', tech: { id: 'postmark', name: 'Postmark', category: 'infrastructure' } },
  { match: 'sparkpostmail.com', tech: { id: 'sparkpost', name: 'SparkPost', category: 'infrastructure' } },
  { match: 'stripe.com', tech: { id: 'stripe', name: 'Stripe', category: 'infrastructure' } },
  { match: 'zoho.com', tech: { id: 'zoho', name: 'Zoho', category: 'crm' } },
  { match: 'atlassian.net', tech: { id: 'atlassian', name: 'Atlassian', category: 'other' } },
  { match: 'notion.so', tech: { id: 'notion', name: 'Notion', category: 'other' } },
]

export type DnsRecords = {
  mx: string[]
  spf: string[]
  hasDmarc: boolean
}

/**
 * Maps raw DNS records onto detected technologies.
 *
 * PURE, so every fingerprint is testable without a resolver.
 */
export function fingerprintDns(records: DnsRecords): DetectedTech[] {
  const found = new Map<string, DetectedTech>()

  const scan = (haystack: string, fingerprints: readonly Fingerprint[]) => {
    const lower = haystack.toLowerCase()
    for (const { match, tech } of fingerprints) {
      if (lower.includes(match)) found.set(tech.id, tech)
    }
  }

  for (const host of records.mx) scan(host, MX_FINGERPRINTS)
  for (const record of records.spf) scan(record, SPF_FINGERPRINTS)

  return [...found.values()]
}

/**
 * DNS error codes that genuinely mean "there is no such record".
 *
 * Everything else — SERVFAIL, TIMEOUT, refused, connection reset — means the
 * lookup did not happen, which is a different fact entirely.
 */
const NO_SUCH_RECORD = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN'])

class DnsLookupError extends Error {}

/**
 * Resolves a record, or distinguishes absence from failure.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ AN EMPTY RESULT AND A FAILED LOOKUP ARE NOT THE SAME THING.          ║
 * ║                                                                          ║
 * ║  The first version returned `[]` for both. A transient resolver hiccup   ║
 * ║  therefore rendered as "this company has no email stack", and a live     ║
 * ║  probe reported soprasteria.com and mfs.com as having nothing — when     ║
 * ║  they run Microsoft 365 and Proofpoint respectively, both of which this  ║
 * ║  file already fingerprints.                                             ║
 * ║                                                                          ║
 * ║  This is the FOURTH time in this build that a failure and an empty       ║
 * ║  result have been rendered identically. A failed lookup now throws, so   ║
 * ║  the executor records `error` and the field stays `unknown`.             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
async function resolveOrThrow<T>(work: Promise<T>, empty: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new DnsLookupError('dns timeout')), DNS_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code && NO_SUCH_RECORD.has(code)) return empty
    throw new DnsLookupError(code ?? 'dns lookup failed')
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function readDnsRecords(domain: string): Promise<DnsRecords> {
  const [mx, txt, dmarc] = await Promise.all([
    resolveOrThrow(dns.resolveMx(domain), [] as Array<{ exchange: string }>),
    resolveOrThrow(dns.resolveTxt(domain), [] as string[][]),
    // A missing _dmarc record is normal and must never fail the lookup.
    resolveOrThrow(dns.resolveTxt(`_dmarc.${domain}`), [] as string[][]).catch(() => []),
  ])

  const flattened = txt.map((chunks) => chunks.join(''))

  return {
    mx: mx.map((record) => record.exchange),
    // Only SPF records; other TXT entries are verification tokens and noise.
    spf: flattened.filter((record) => record.toLowerCase().startsWith('v=spf1')),
    hasDmarc: dmarc.some((chunks) => chunks.join('').toLowerCase().startsWith('v=dmarc1')),
  }
}

export const dnsTechProvider: IntelligenceProvider<{
  records: DnsRecords
  detected: DetectedTech[]
  domain: string
}> = {
  name: 'dns-tech',
  category: 'tech_stack',

  // Needs a domain, and nothing else. No credential check — there is no key.
  canHandle: (task: ResearchTask) =>
    task.entity.type === 'company' && Boolean((task.entity as CompanyEntity).domain),

  // Free. Genuinely, not "free tier".
  estimateCost: async () => 0,

  execute: async (task) => {
    const domain = (task.entity as CompanyEntity).domain!
    const records = await readDnsRecords(domain)
    return { records, detected: fingerprintDns(records), domain }
  },

  normalize: (output, task): NormalizedEvidence[] => {
    // Nothing recognised is UNKNOWN, not "no technology". SPF only lists
    // services that send mail, so silence proves very little.
    if (output.detected.length === 0) return []

    const retrievedAt = new Date()

    return [
      {
        field: 'tech_stack',
        entityType: 'company',
        entityId: task.entity.id,
        value: {
          detected: output.detected,
          coverage: 'email_and_sending_stack',
          hasDmarc: output.records.hasDmarc,
          // Kept so a surprising detection can be checked by hand.
          spf: output.records.spf,
        },
        sourceProvider: 'dns-tech',
        sourceUrl: `https://dnschecker.org/all-dns-records-of-domain.php?query=${encodeURIComponent(output.domain)}`,
        // Published by the company in its own DNS zone: an official source.
        sourceConfidence: 'high',
        confidence: 0.9,
        retrievedAt: retrievedAt.toISOString(),
        expiresAt: expiresAtFor('tech_stack', retrievedAt)?.toISOString() ?? null,
      },
    ]
  },
}
