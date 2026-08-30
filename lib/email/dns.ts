import 'server-only'

/**
 * Domain authentication checks — M5 Phase 13.
 *
 * Real DNS lookups for SPF, DKIM and DMARC. These are the honest, verifiable
 * half of deliverability: they say whether the customer's domain is configured
 * to let this mail through, which is knowable, rather than whether the mail
 * reached an inbox, which is not.
 *
 * ⚠️ THE PARSERS ARE SEPARATE FROM THE LOOKUPS ON PURPOSE. Record parsing is
 * fiddly and full of edge cases; DNS is slow and unavailable in tests. Keeping
 * them apart means every parsing rule below is unit-testable without a network.
 */
import { promises as dns } from 'node:dns'

export type EmailCheckStatus = 'pass' | 'warn' | 'fail' | 'unknown' | 'not_applicable'

export type CheckOutcome = {
  status: EmailCheckStatus
  detail: string
  record?: string
}

export type DomainAuthResult = {
  domain: string
  spf: CheckOutcome
  dkim: CheckOutcome & { selector?: string }
  dmarc: CheckOutcome & { policy?: string }
}

/**
 * Selectors we can guess.
 *
 * ⚠️ DKIM CANNOT BE VERIFIED WITHOUT KNOWING THE SELECTOR, and the selector is
 * chosen by whoever set the domain up. There is no way to enumerate them from
 * DNS. So we try the common ones and, if none answer, report `unknown` —
 * NEVER `fail`. Telling a correctly-configured customer their DKIM is broken
 * sends them chasing a problem that does not exist, and teaches them to
 * distrust every other check on the page.
 */
const COMMON_DKIM_SELECTORS = [
  'google', // Google Workspace
  'selector1', // Microsoft 365
  'selector2',
  'k1', // Mailchimp / Mandrill
  'mandrill',
  's1', // SendGrid and others
  's2',
  'dkim',
  'default',
  'mail',
  'smtp',
  'zoho',
  'fm1', // Fastmail
] as const

/** Parses an SPF record set. Exported for testing without DNS. */
export function parseSpf(records: string[][]): CheckOutcome {
  const flat = records.map((chunks) => chunks.join(''))
  const spf = flat.filter((r) => r.toLowerCase().startsWith('v=spf1'))

  if (spf.length === 0) {
    return {
      status: 'fail',
      detail:
        'No SPF record found. Receiving servers cannot confirm that this domain authorised the mail, and most will filter it.',
    }
  }

  /*
   * ⚠️ TWO SPF RECORDS IS A HARD FAILURE, NOT A WARNING. RFC 7208 says a
   * domain publishing more than one MUST be treated as `permerror` — the
   * receiver does not pick one, it rejects the evaluation entirely. This is a
   * common and invisible misconfiguration: someone adds a second record for a
   * new provider instead of merging, and authentication silently stops working
   * for everything.
   */
  if (spf.length > 1) {
    return {
      status: 'fail',
      record: spf.join(' | '),
      detail: `This domain publishes ${spf.length} SPF records. The standard requires exactly one — receivers treat multiple records as an error and stop authenticating the domain altogether. Merge them into a single record.`,
    }
  }

  const record = spf[0]!
  const normalized = record.toLowerCase()

  // The "all" mechanism decides what happens to unauthorised senders.
  if (/[~-]all\b/.test(normalized)) {
    return {
      status: 'pass',
      record,
      detail: 'SPF is published and tells receivers to reject or mark unauthorised senders.',
    }
  }

  if (/\?all\b/.test(normalized)) {
    return {
      status: 'warn',
      record,
      detail:
        'SPF ends in `?all` (neutral), which asks receivers to treat unauthorised mail no differently. Use `~all` once the record lists every sender.',
    }
  }

  if (/\+all\b/.test(normalized)) {
    return {
      status: 'fail',
      record,
      detail:
        'SPF ends in `+all`, which authorises the entire internet to send as this domain. This is worse than having no SPF at all.',
    }
  }

  return {
    status: 'warn',
    record,
    detail: 'SPF is published but has no `all` mechanism, so unauthorised senders are unspecified.',
  }
}

/** Parses a DMARC record set. Exported for testing without DNS. */
export function parseDmarc(records: string[][]): CheckOutcome & { policy?: string } {
  const flat = records.map((chunks) => chunks.join(''))
  const dmarc = flat.filter((r) => r.toLowerCase().replace(/\s/g, '').startsWith('v=dmarc1'))

  if (dmarc.length === 0) {
    return {
      status: 'fail',
      detail:
        'No DMARC record found. Since 2024 Google and Yahoo require one for bulk senders, and without it mail to those providers is likely to be rejected.',
    }
  }

  const record = dmarc[0]!
  const policy = /\bp\s*=\s*(none|quarantine|reject)\b/i.exec(record)?.[1]?.toLowerCase()

  if (!policy) {
    return {
      status: 'warn',
      record,
      detail: 'A DMARC record exists but declares no policy (`p=`), so receivers have no instruction.',
    }
  }

  if (policy === 'none') {
    /*
     * `p=none` is monitoring only. It satisfies the bulk-sender requirement
     * and is the correct FIRST step, so it is a warning rather than a failure:
     * marking it failed would push customers to jump straight to `p=reject`,
     * which without prior monitoring blocks their own legitimate mail.
     */
    return {
      status: 'warn',
      record,
      policy,
      detail:
        'DMARC is set to `p=none`, which only monitors. That meets the minimum requirement — move to `quarantine` once the reports show your legitimate mail passing.',
    }
  }

  return {
    status: 'pass',
    record,
    policy,
    detail: `DMARC is published with \`p=${policy}\`, so receivers act on messages that fail authentication.`,
  }
}

async function txt(name: string): Promise<string[][] | null> {
  try {
    return await dns.resolveTxt(name)
  } catch (error) {
    const code = (error as { code?: string }).code
    // NXDOMAIN / no record is a legitimate answer, not a lookup failure.
    if (code === 'ENOTFOUND' || code === 'ENODATA') return []
    return null
  }
}

/**
 * Checks one domain's email authentication.
 *
 * ⚠️ A DNS FAILURE IS `unknown`, NEVER `fail`. A resolver timeout says nothing
 * about the customer's configuration, and reporting it as a fault would have
 * them editing a DNS record that was already correct.
 */
export async function checkDomainAuth(domain: string): Promise<DomainAuthResult> {
  const normalized = domain.trim().toLowerCase()

  const [spfRecords, dmarcRecords] = await Promise.all([
    txt(normalized),
    txt(`_dmarc.${normalized}`),
  ])

  const spf: CheckOutcome =
    spfRecords === null
      ? { status: 'unknown', detail: 'Could not read DNS for this domain. This is not a fault in your setup — Outlio will try again.' }
      : parseSpf(spfRecords)

  const dmarc =
    dmarcRecords === null
      ? { status: 'unknown' as const, detail: 'Could not read DNS for this domain. Outlio will try again.' }
      : parseDmarc(dmarcRecords)

  return { domain: normalized, spf, dkim: await findDkim(normalized), dmarc }
}

async function findDkim(domain: string): Promise<CheckOutcome & { selector?: string }> {
  let anyLookupSucceeded = false

  for (const selector of COMMON_DKIM_SELECTORS) {
    const records = await txt(`${selector}._domainkey.${domain}`)
    if (records === null) continue
    anyLookupSucceeded = true

    const flat = records.map((chunks) => chunks.join(''))
    const key = flat.find((r) => r.toLowerCase().includes('p='))
    if (!key) continue

    // `p=` present but empty is a revoked key — the record exists and
    // explicitly says this selector must no longer be trusted.
    if (/\bp\s*=\s*(;|$)/.test(key)) {
      return {
        status: 'fail',
        selector,
        record: key,
        detail: `The DKIM key at \`${selector}._domainkey\` is empty, which revokes it. Mail signed with this selector will fail authentication.`,
      }
    }

    return {
      status: 'pass',
      selector,
      record: key,
      detail: `A DKIM key is published at \`${selector}._domainkey\`.`,
    }
  }

  /*
   * ⚠️ `unknown`, NOT `fail`. We tried the selectors we know; a domain using a
   * custom one is correctly configured and we simply cannot see it. Saying
   * "DKIM is missing" here would be a false alarm on a working setup.
   */
  return {
    status: 'unknown',
    detail: anyLookupSucceeded
      ? 'Outlio could not find a DKIM key at any common selector. If your provider uses a custom selector, DKIM may still be set up correctly — this check cannot see it.'
      : 'Could not read DNS for this domain. Outlio will try again.',
  }
}

/**
 * Whether the sending address aligns with the authenticated domain.
 *
 * ⚠️ DMARC ALIGNMENT IS RELAXED BY DEFAULT: a subdomain aligns with its
 * organisational domain, so `mail.acme.com` passes for `acme.com`. Requiring
 * an exact match would report a correct setup as broken.
 */
export function isAligned(fromDomain: string, authenticatedDomain: string): boolean {
  const from = fromDomain.trim().toLowerCase()
  const auth = authenticatedDomain.trim().toLowerCase()
  if (!from || !auth) return false
  return from === auth || from.endsWith(`.${auth}`) || auth.endsWith(`.${from}`)
}
