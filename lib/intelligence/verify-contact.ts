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

import { isPeopleSearchSource } from '@/lib/intelligence/source-policy'
import type { NormalizedEvidence } from '@/lib/intelligence/types'

/* -------------------------------------------------------------------------- *
 * Email
 * -------------------------------------------------------------------------- */

export const EMAIL_KEPT = ['mailbox_verified', 'accept_all', 'mail_server_verified', 'mail_domain_only', 'unverified'] as const
export const EMAIL_DROPPED = ['invalid_syntax', 'disposable', 'domain_not_found', 'no_mail_server', 'mailbox_rejected'] as const
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
  try {
    const a = await resolver.resolve4(domain)
    return a.length > 0 ? 'a_only' : 'none'
  } catch (error) {
    const code = (error as { code?: string }).code
    return code === 'ENOTFOUND' ? 'nxdomain' : code === 'ENODATA' ? 'none' : 'error'
  }
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
        return { status: verdict.exists ? 'mailbox_verified' : 'mailbox_rejected', method: 'smtp', checkedAt }
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

export type PhoneStatus = 'valid_mobile' | 'valid_landline' | 'valid_toll_free' | 'valid_number' | 'invalid'
export type PhoneCheck = {
  status: PhoneStatus
  /** libphonenumber's line type, when it can tell. */
  lineType: string | null
  e164: string | null
  region: string | null
  checkedAt: string
}

/** Country names as a Sales Navigator location writes them → ISO code. */
const COUNTRY: ReadonlyArray<[RegExp, CountryCode]> = [
  [/\b(united states|usa|u\.s\.|us)\b|, (?:al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)$|greater (boston|phoenix|chicago|seattle)|los angeles|san francisco|new york|houston|texas|california|indiana|georgia/i, 'US'],
  [/\b(united kingdom|uk|england|scotland|wales|northern ireland|london|manchester)\b/i, 'GB'],
  [/\bcanada|toronto|vancouver|montreal\b/i, 'CA'],
  [/\baustralia|sydney|melbourne\b/i, 'AU'],
  [/\bireland|dublin\b/i, 'IE'],
  [/\bnew zealand\b/i, 'NZ'],
  [/\bgermany|deutschland|berlin|munich|hamburg\b/i, 'DE'],
  [/\bnetherlands|holland|amsterdam|rotterdam\b/i, 'NL'],
  [/\bfrance|paris\b/i, 'FR'],
  [/\bspain|madrid|barcelona\b/i, 'ES'],
  [/\bitaly|milan|rome\b/i, 'IT'],
  [/\bdenmark|copenhagen\b/i, 'DK'],
  [/\bsweden|stockholm\b/i, 'SE'],
  [/\bnorway|oslo\b/i, 'NO'],
  [/\bpoland|warsaw\b/i, 'PL'],
  [/\bczechia|czech republic|prague\b/i, 'CZ'],
  [/\bswitzerland|zurich|geneva\b/i, 'CH'],
  [/\bbelgium|brussels\b/i, 'BE'],
  [/\bportugal|lisbon\b/i, 'PT'],
  [/\bindia|bengaluru|bangalore|mumbai|delhi\b/i, 'IN'],
  [/\bpakistan|karachi|lahore|islamabad\b/i, 'PK'],
  [/\bunited arab emirates|uae|dubai|abu dhabi\b/i, 'AE'],
  [/\bsingapore\b/i, 'SG'],
  [/\bmexico\b/i, 'MX'],
  [/\bbrazil|são paulo|sao paulo\b/i, 'BR'],
  [/\bsouth africa|johannesburg|cape town\b/i, 'ZA'],
  [/\bisrael|tel aviv\b/i, 'IL'],
]

/** PURE. The country a location names, when it names one we know. */
export function regionFromLocation(location: string | null | undefined): CountryCode | null {
  const text = (location ?? '').trim()
  if (!text) return null
  return COUNTRY.find(([pattern]) => pattern.test(text))?.[1] ?? null
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
    // A national number with no known country cannot be judged — kept, unchecked.
    if (!international.startsWith('+') && !region) {
      return { status: 'valid_number', lineType: null, e164: null, region: null, checkedAt }
    }
    return { status: 'invalid', lineType: null, e164: null, region: region ?? null, checkedAt }
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

  await Promise.all(items.map(async (item) => {
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
  }))

  // Person contacts' status companions follow their contact.
  const companion = new Map<string, { keep: boolean; status: string }>()
  for (const [item, verdict] of verdicts) {
    const statusField = STATUS_FOR[item.field]
    if (statusField) companion.set(`${item.entityId}:${statusField}`, verdict)
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
