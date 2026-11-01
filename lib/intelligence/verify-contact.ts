import 'server-only'

/**
 * Every contact is checked before it is kept.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  "FOUND ON A PUBLIC PAGE" IS NOT "WORKS".                                ║
 * ║                                                                          ║
 * ║  A published address can sit on a domain that no longer receives mail; ║
 * ║  a published number can be malformed, a fax line, or a landline filed   ║
 * ║  as a mobile. Outlio sells deliverability: an address that bounces      ║
 * ║  costs the customer's sending reputation. So each contact is checked    ║
 * ║  with free, public signals before it is stored:                         ║
 * ║                                                                          ║
 * ║    email — syntax · disposable domain · the domain's MAIL SERVER (DNS   ║
 * ║            MX) · optionally the MAILBOX (SMTP, self-hosted worker only: ║
 * ║            Vercel blocks port 25)                                       ║
 * ║    phone — a real number for its country, and its LINE TYPE (mobile,   ║
 * ║            landline, toll-free) from libphonenumber's full metadata     ║
 * ║                                                                          ║
 * ║  A contact that fails is DROPPED, not stored with a warning. One that   ║
 * ║  passes carries `verification` and a status the export prints.          ║
 * ║  Nothing is altered: the value stored is still exactly the one found    ║
 * ║  (rule 4) — verification only decides whether it is kept.              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { Resolver } from 'node:dns/promises'

import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max'

import { inParallel } from '@/lib/intelligence/site-pages'
import { isPeopleSearchSource } from '@/lib/intelligence/source-policy'
import type { NormalizedEvidence } from '@/lib/intelligence/types'

/* -------------------------------------------------------------------------- *
 * Email
 * -------------------------------------------------------------------------- */

export const EMAIL_KEPT = ['mailbox_verified', 'accept_all', 'mail_server_verified', 'mail_domain_only', 'unverified'] as const
export const EMAIL_DROPPED = ['invalid_syntax', 'disposable', 'domain_not_found', 'no_mail_server'] as const
export type EmailStatus = (typeof EMAIL_KEPT)[number] | (typeof EMAIL_DROPPED)[number]

export type EmailCheck = { status: EmailStatus; method: 'syntax' | 'dns' | 'smtp'; checkedAt: string }

/** Throwaway inboxes: never a business contact. */
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org',
  'yopmail.com', 'trashmail.com', 'getnada.com', 'sharklasers.com', 'dispostable.com',
  'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mohmal.com', 'emailondeck.com',
])

const SYNTAX = /^[a-z0-9._%+-]{1,64}@(?=.{4,253}$)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}$/i

/** The MX answer for a domain, from DNS. Injectable for tests. */
export type MailLookup = (domain: string) => Promise<'mx' | 'a_only' | 'none' | 'nxdomain' | 'error'>

const resolver = new Resolver({ timeout: 3_000, tries: 1 })

const dnsMailLookup: MailLookup = async (domain) => {
  try {
    const mx = await resolver.resolveMx(domain)
    if (mx.some((record) => record.exchange && record.exchange !== '.')) return 'mx'
    // A "null MX" (RFC 7505) says the domain accepts no mail at all.
    if (mx.length > 0) return 'none'
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'ENOTFOUND') return 'nxdomain'
    if (code !== 'ENODATA') return 'error'
  }
  // No MX: mail falls back to the domain's own address (RFC 5321 §5.1).
  // …then its IPv4 or IPv6 address; only with neither is there nowhere to deliver.
  for (const resolve of [() => resolver.resolve4(domain), () => resolver.resolve6(domain)]) {
    try {
      if ((await resolve()).length > 0) return 'a_only'
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === 'ENOTFOUND') return 'nxdomain'
      if (code !== 'ENODATA') return 'error'
    }
  }
  return 'none'
}

/** Lookups are per DOMAIN and reused: a batch shares a handful of employers. */
const MAIL_CACHE = new Map<string, { at: number; result: Promise<Awaited<ReturnType<MailLookup>>> }>()
const MAIL_CACHE_MS = 10 * 60_000

function cachedLookup(domain: string, lookup: MailLookup) {
  const hit = MAIL_CACHE.get(domain)
  if (hit && Date.now() - hit.at < MAIL_CACHE_MS) return hit.result
  if (MAIL_CACHE.size > 2_000) MAIL_CACHE.clear()
  const result = lookup(domain)
  MAIL_CACHE.set(domain, { at: Date.now(), result })
  return result
}

/** Test seam: the cache is process-lifetime state. */
export function resetMailCache(): void {
  MAIL_CACHE.clear()
}

/** A mailbox probe (SMTP) with a catch-all control. Injectable; off unless configured. */
export type MailboxProbe = (email: string) => Promise<{ probed: boolean; exists: boolean; acceptAll: boolean }>

export async function checkEmail(
  address: string,
  options: { lookup?: MailLookup; mailbox?: MailboxProbe | null } = {},
): Promise<EmailCheck> {
  const checkedAt = new Date().toISOString()
  const email = address.trim().toLowerCase()
  if (!SYNTAX.test(email)) return { status: 'invalid_syntax', method: 'syntax', checkedAt }
  const domain = email.split('@')[1]!
  if (DISPOSABLE.has(domain)) return { status: 'disposable', method: 'syntax', checkedAt }

  const mail = await cachedLookup(domain, options.lookup ?? dnsMailLookup)
  if (mail === 'nxdomain') return { status: 'domain_not_found', method: 'dns', checkedAt }
  if (mail === 'none') return { status: 'no_mail_server', method: 'dns', checkedAt }
  // A DNS failure is OUR problem, not the address's: kept, marked unchecked.
  if (mail === 'error') return { status: 'unverified', method: 'dns', checkedAt }

  if (options.mailbox && mail === 'mx') {
    try {
      const verdict = await options.mailbox(email)
      if (verdict.probed) {
        if (verdict.acceptAll) return { status: 'accept_all', method: 'smtp', checkedAt }
        if (verdict.exists) return { status: 'mailbox_verified', method: 'smtp', checkedAt }
        /*
         * ⚠️ A REJECTION IS NOT PROOF THE MAILBOX IS GONE. Microsoft 365 and
         * Google refuse probes from unfamiliar IPs with a 5.7.x policy error
         * that looks identical to "no such user" here. The probe can upgrade
         * a contact; it never drops one — the DNS verdict stands.
         */
      }
    } catch {
      // A probe that cannot run leaves the DNS verdict standing.
    }
  }
  return { status: mail === 'mx' ? 'mail_server_verified' : 'mail_domain_only', method: 'dns', checkedAt }
}

/* -------------------------------------------------------------------------- *
 * Phone
 * -------------------------------------------------------------------------- */

export type PhoneStatus = 'valid_mobile' | 'valid_landline' | 'valid_toll_free' | 'valid_number' | 'unverified' | 'invalid'
export type PhoneCheck = {
  status: PhoneStatus
  /** libphonenumber's line type, when it can tell. */
  lineType: string | null
  e164: string | null
  region: string | null
  checkedAt: string
}

/**
 * Country names as a Sales Navigator location writes them → ISO code.
 *
 * ⚠️ COUNTRY NAMES FIRST — no two-letter state, ever. "Berlin, DE" is not
 * Delaware, "London, Ontario" is not England, "Georgia" may be either. A
 * wrong guess is harmless only because a national number that will not parse
 * is kept as `unverified`, never dropped (checkPhone).
 */
const COUNTRY: ReadonlyArray<[RegExp, CountryCode]> = [
  [/\b(united states|united states of america|usa)\b/i, 'US'],
  [/\b(united kingdom|england|scotland|wales|northern ireland)\b/i, 'GB'],
  [/\bcanada\b/i, 'CA'],
  [/\baustralia\b/i, 'AU'],
  [/\bireland\b/i, 'IE'],
  [/\bnew zealand\b/i, 'NZ'],
  [/\bgermany|deutschland\b/i, 'DE'],
  [/\bnetherlands\b/i, 'NL'],
  [/\bfrance\b/i, 'FR'],
  [/\bspain\b/i, 'ES'],
  [/\bitaly\b/i, 'IT'],
  [/\bdenmark\b/i, 'DK'],
  [/\bsweden\b/i, 'SE'],
  [/\bnorway\b/i, 'NO'],
  [/\bpoland\b/i, 'PL'],
  [/\b(czechia|czech republic)\b/i, 'CZ'],
  [/\bswitzerland\b/i, 'CH'],
  [/\baustria\b/i, 'AT'],
  [/\bbelgium\b/i, 'BE'],
  [/\bportugal\b/i, 'PT'],
  [/\bindia\b/i, 'IN'],
  [/\bpakistan\b/i, 'PK'],
  [/\b(united arab emirates|uae)\b/i, 'AE'],
  [/\bsingapore\b/i, 'SG'],
  [/(?<!new )\bmexico\b/i, 'MX'],
  [/\bbrazil\b/i, 'BR'],
  [/\bsouth africa\b/i, 'ZA'],
  [/\bisrael\b/i, 'IL'],
]

/**
 * US state names in full. Read only after every country name has had its
 * chance, so "Washington, England, United Kingdom" stays British.
 * Georgia is left out — it is also a country.
 */
const US_STATE = new RegExp(
  `\\b(${[
    'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware',
    'florida', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana',
    'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana',
    'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina',
    'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina',
    'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia',
    'wisconsin', 'wyoming',
  ].join('|')})\\b`,
  'i',
)

/**
 * Sales Navigator names US metros without a country: "Greater Phoenix Area",
 * "San Francisco Bay Area", "Dallas-Fort Worth Metroplex". A core city counts
 * only inside that metro phrasing — a bare "Phoenix" is not read as a place.
 *
 * ⚠️ Cities that are also a metro abroad are left out on purpose: Birmingham,
 * Manchester, Cambridge, Melbourne, Perth, Paris, Athens, Durham, Kingston,
 * London, Dublin. "Greater Manchester" is in England.
 */
const US_METRO_SHAPE = /^greater\b|\b(area|metropolitan|metroplex|metro|region)\b/i
const US_METRO = new RegExp(
  `\\b(${[
    'new york city', 'los angeles', 'san francisco', 'silicon valley', 'chicago', 'dallas', 'fort worth',
    'houston', 'washington dc', 'baltimore', 'miami', 'fort lauderdale',
    'philadelphia', 'atlanta', 'boston', 'phoenix', 'seattle', 'minneapolis', 'st\\.? paul', 'san diego',
    'denver', 'tampa', 'detroit', 'st\\.? louis', 'orlando', 'charlotte', 'san antonio', 'austin',
    'sacramento', 'pittsburgh', 'las vegas', 'cincinnati', 'kansas city', 'columbus', 'cleveland',
    'indianapolis', 'nashville', 'raleigh', 'salt lake city', 'milwaukee', 'jacksonville',
    'oklahoma city', 'louisville', 'memphis', 'new orleans', 'hartford', 'buffalo', 'richmond',
    'grand rapids', 'tucson', 'honolulu', 'omaha', 'albuquerque', 'boise', 'des moines', 'madison',
    'knoxville', 'greenville', 'spokane', 'tulsa', 'el paso', 'chattanooga', 'reno', 'anchorage',
  ].join('|')})\\b`,
  'i',
)

/** PURE. The country a location names, when it names one we know. */
export function regionFromLocation(location: string | null | undefined): CountryCode | null {
  const text = (location ?? '').trim()
  if (!text) return null
  // The last segment first: "Toronto, Ontario, Canada" ends in its country.
  const last = text.split(',').at(-1) ?? ''
  return (
    COUNTRY.find(([pattern]) => pattern.test(last))?.[1] ??
    COUNTRY.find(([pattern]) => pattern.test(text))?.[1] ??
    (US_STATE.test(text) || (US_METRO_SHAPE.test(text) && US_METRO.test(text)) ? 'US' : null)
  )
}

const LINE_STATUS: Readonly<Record<string, PhoneStatus>> = {
  MOBILE: 'valid_mobile',
  FIXED_LINE: 'valid_landline',
  TOLL_FREE: 'valid_toll_free',
}

/** PURE. Whether a number is real for its country, and what kind of line it is. */
export function checkPhone(raw: string, region: CountryCode | null): PhoneCheck {
  const checkedAt = new Date().toISOString()
  const text = raw.trim()
  const international = text.startsWith('00') ? `+${text.slice(2)}` : text
  let parsed: ReturnType<typeof parsePhoneNumberFromString> | undefined
  try {
    parsed = international.startsWith('+')
      ? parsePhoneNumberFromString(international)
      : region
        ? parsePhoneNumberFromString(international, region)
        : undefined
  } catch {
    parsed = undefined
  }
  if (!parsed?.isValid()) {
    /*
     * Only a number that states its own country (`+…`) can be judged invalid.
     * A national one is checked against a country GUESSED from a location —
     * a wrong guess must not drop a good number, so it is kept, unchecked.
     */
    if (!international.startsWith('+')) {
      return { status: 'unverified', lineType: null, e164: null, region: region ?? null, checkedAt }
    }
    return { status: 'invalid', lineType: null, e164: null, region: null, checkedAt }
  }
  const lineType = parsed.getType() ?? null
  return {
    status: (lineType && LINE_STATUS[lineType]) || 'valid_number',
    lineType,
    e164: parsed.number,
    region: parsed.country ?? region ?? null,
    checkedAt,
  }
}

/* -------------------------------------------------------------------------- *
 * Evidence
 * -------------------------------------------------------------------------- */

/** Contacts checked at once. */
const VERIFY_CONCURRENCY = 10

const EMAIL_FIELDS = new Set(['work_email', 'company_contact_email'])
const PHONE_FIELDS = new Set(['mobile_phone', 'company_contact_phone'])
/** The status field that travels with a person contact. */
const STATUS_FOR: Readonly<Record<string, string>> = { work_email: 'email_status', mobile_phone: 'phone_status' }
const KEPT_EMAIL: ReadonlySet<string> = new Set(EMAIL_KEPT)

export type VerificationReport = {
  kept: NormalizedEvidence[]
  /** Reason → count, for the run's tool-call log. Never the values. */
  dropped: Record<string, number>
}

/**
 * Checks every contact in `items` and returns what to store.
 *
 * Non-contact evidence passes through untouched. A dropped contact takes its
 * status companion with it; a kept one gets `verification`, and its status —
 * on the companion for a person, on the value for a company — becomes the
 * verified status, so the export prints what was checked.
 *
 * `locations` maps an entity id to a location string (lead location or
 * company headquarters), for judging national-format phone numbers.
 */
export async function verifyContactEvidence(
  items: readonly NormalizedEvidence[],
  locations: ReadonlyMap<string, string | null>,
  options: { lookup?: MailLookup; mailbox?: MailboxProbe | null } = {},
): Promise<VerificationReport> {
  const dropped: Record<string, number> = {}
  const drop = (reason: string) => { dropped[reason] = (dropped[reason] ?? 0) + 1 }
  const verdicts = new Map<NormalizedEvidence, { keep: boolean; status: string; verification: object }>()

  // Bounded: DNS lookups (and any mailbox probes) for a large batch are not fired at once.
  await inParallel(items, VERIFY_CONCURRENCY, async (item) => {
    const isEmail = EMAIL_FIELDS.has(item.field)
    const isPhone = PHONE_FIELDS.has(item.field)
    if (!isEmail && !isPhone) return
    if (isPeopleSearchSource(item.sourceUrl)) {
      verdicts.set(item, { keep: false, status: 'people_search_source', verification: {} })
      return
    }
    const value = item.value as Record<string, unknown>
    if (isEmail) {
      const email = typeof value.email === 'string' ? value.email : ''
      const check = await checkEmail(email, {
        lookup: options.lookup,
        // A person's mailbox only: a company's shared inbox is not probed.
        mailbox: item.field === 'work_email' ? options.mailbox ?? null : null,
      })
      verdicts.set(item, { keep: KEPT_EMAIL.has(check.status), status: check.status, verification: check })
    } else {
      const phone = typeof value.phone === 'string' ? value.phone : ''
      const check = checkPhone(phone, regionFromLocation(locations.get(item.entityId)))
      verdicts.set(item, { keep: check.status !== 'invalid', status: check.status, verification: check })
    }
  })

  /*
   * Person contacts' status companions follow their contact. ⚠️ BY ENTITY,
   * NOT BY LAST WRITE: one person can have two emails in a batch. The status
   * survives when ANY of them is kept, and says what the first kept one passed;
   * it goes only when every one was dropped.
   */
  const companion = new Map<string, { keep: boolean; status: string }>()
  for (const item of items) {
    const verdict = verdicts.get(item)
    const statusField = STATUS_FOR[item.field]
    if (!verdict || !statusField) continue
    const key = `${item.entityId}:${statusField}`
    const current = companion.get(key)
    if (!current || (!current.keep && verdict.keep)) companion.set(key, verdict)
  }

  const kept: NormalizedEvidence[] = []
  for (const item of items) {
    const verdict = verdicts.get(item)
    if (verdict) {
      if (!verdict.keep) {
        drop(verdict.status)
        continue
      }
      const value: Record<string, unknown> = { ...(item.value as Record<string, unknown>), verification: verdict.verification }
      if (item.field.startsWith('company_contact_')) value.status = verdict.status
      kept.push({ ...item, value })
      continue
    }
    const follows = companion.get(`${item.entityId}:${item.field}`)
    if (follows) {
      if (!follows.keep) continue
      const value = item.value as Record<string, unknown>
      kept.push({ ...item, value: { ...value, status: follows.status, foundAs: value.status ?? null } })
      continue
    }
    kept.push(item)
  }
  return { kept, dropped }
}
