/**
 * How long a researched fact stays usable (spec §24).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS IS THE ONLY PLACE EXPIRY IS DECIDED.                               ║
 * ║                                                                          ║
 * ║  Nothing else may compute an `expires_at`, compare a timestamp against   ║
 * ║  "recent enough", or hardcode a duration. Expiry scattered across a      ║
 * ║  codebase is how a system quietly starts re-buying data it already owns. ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * PURE — no I/O.
 */
import { RESEARCH_FIELDS, type ResearchField } from '@/lib/intelligence/types'

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Field → time-to-live in seconds. `null` means the fact does not expire.
 *
 * The durations follow how fast the underlying truth actually moves:
 *
 *   - A funding round that happened is permanent history; whether it is the
 *     LATEST round is not, hence a long but finite life.
 *   - Hiring and news are the shortest, because a stale buying signal is worse
 *     than no signal — it sends someone into a conversation with wrong facts.
 *   - Contact details expire on the slow side. Re-verifying an email that is
 *     still deliverable is money spent for nothing.
 *
 * `Record<ResearchField, …>` is deliberate: a new field cannot be added without
 * a TTL decision, because the omission is a compile error.
 */
export const FIELD_TTL_SECONDS: Record<ResearchField, number | null> = {
  // Slow-moving company facts. A company rarely changes domain, and when it
  // does the old one usually redirects.
  company_domain: 180 * DAY,
  employee_count: 30 * DAY,
  industry: 180 * DAY,
  headquarters: 180 * DAY,
  company_description: 180 * DAY,
  /** A public page address moves about as rarely as the site itself. */
  company_linkedin: 180 * DAY,
  company_contact_email: 90 * DAY,
  company_contact_phone: 90 * DAY,
  /** Self-described focus areas move about as often as the description does. */
  specialties: 180 * DAY,
  business_model: 180 * DAY,
  revenue_estimate: 60 * DAY,
  // Registry identity and incorporation history are permanent. Status and
  // compliance flags move quickly enough to warrant a short refresh window.
  company_number: null,
  /** An LEI is a permanent identifier; it does not decay. */
  lei_number: null,
  company_status: 7 * DAY,
  company_type: 365 * DAY,
  jurisdiction: null,
  incorporation_date: null,
  sic_codes: 180 * DAY,
  registered_office: 90 * DAY,
  accounts_overdue: 7 * DAY,
  confirmation_statement_overdue: 7 * DAY,
  insolvency_history: 7 * DAY,
  // SEC identity fields are stable; ticker/exchange and filing activity move.
  sec_cik: null,
  sec_legal_name: 90 * DAY,
  sec_entity_type: 365 * DAY,
  sec_sic: 180 * DAY,
  sec_sic_description: 180 * DAY,
  sec_ein: 365 * DAY,
  sec_lei: 365 * DAY,
  sec_tickers: 30 * DAY,
  sec_exchanges: 30 * DAY,
  sec_state_of_incorporation: 365 * DAY,
  sec_business_address: 90 * DAY,
  sec_website: 90 * DAY,
  sec_former_names: 180 * DAY,
  sec_filing_history: 1 * DAY,

  /*
   * Federal spending is published on a rolling basis and a company's award
   * history only grows. A month-old total is still a true statement about the
   * company; re-querying daily would spend courtesy on a free public service
   * for no new information.
   */
  federal_awards_total: 30 * DAY,
  federal_awards_count: 30 * DAY,
  federal_award_types: 30 * DAY,
  /** The matched recipient name does not change. */
  federal_recipient_name: null,

  /*
   * Derived facts expire with the observations behind them. A growth figure
   * recomputed from the same two readings is the same number, so the TTL only
   * needs to outlive the inputs, not lead them.
   */
  employee_growth: 30 * DAY,
  tech_churn: 30 * DAY,
  /** Founding date does not move; the age recomputes from it on read. */
  company_age: 180 * DAY,
  funding_recency: 30 * DAY,

  /** Social handles change rarely, and are free when they do. */
  social_profiles: 180 * DAY,

  person_seniority: 180 * DAY,
  person_department: 180 * DAY,
  /** A person's own handles move even less than an employer's. */
  person_social_profiles: 180 * DAY,

  // Funding. Long, because rounds are infrequent and expensive to look up.
  funding_round: 90 * DAY,
  funding_amount: 90 * DAY,
  funding_currency: 90 * DAY,
  funding_date: 90 * DAY,
  funding_investors: 90 * DAY,

  tech_stack: 30 * DAY,
  product_launches: 30 * DAY,

  // Signals. Short by design — see above.
  recent_news: 3 * DAY,
  hiring_signals: 3 * DAY,
  competitors: 60 * DAY,

  website_signals: 30 * DAY,
  pricing_signals: 30 * DAY,

  review_presence: 30 * DAY,
  review_rating: 30 * DAY,
  review_count: 30 * DAY,

  github_presence: 14 * DAY,

  // Contact data. Expensive to buy, slow to change.
  work_email: 180 * DAY,
  email_status: 90 * DAY,
  mobile_phone: 180 * DAY,
  phone_status: 90 * DAY,
}

/**
 * Environment override, so a TTL can be shortened during an incident without a
 * deploy. Format: `field=seconds,field=seconds`. Unknown fields and unparseable
 * values are ignored rather than throwing — a malformed override must not take
 * research down.
 */
export function parseTtlOverrides(
  raw: string | undefined,
): Partial<Record<ResearchField, number>> {
  if (!raw) return {}

  const known = new Set<string>(RESEARCH_FIELDS)
  const overrides: Partial<Record<ResearchField, number>> = {}

  for (const pair of raw.split(',')) {
    const [field, value] = pair.split('=').map((part) => part.trim())
    if (!field || !value || !known.has(field)) continue

    const seconds = Number.parseInt(value, 10)
    if (!Number.isFinite(seconds) || seconds < 0) continue

    overrides[field as ResearchField] = seconds
  }

  return overrides
}

export function ttlSecondsFor(
  field: ResearchField,
  overrides: Partial<Record<ResearchField, number>> = {},
): number | null {
  const override = overrides[field]
  return override === undefined ? FIELD_TTL_SECONDS[field] : override
}

/**
 * When evidence retrieved at `retrievedAt` stops being usable.
 *
 * Returns `null` for fields that never expire.
 */
export function expiresAtFor(
  field: ResearchField,
  retrievedAt: Date,
  overrides: Partial<Record<ResearchField, number>> = {},
): Date | null {
  const ttl = ttlSecondsFor(field, overrides)
  if (ttl === null) return null
  return new Date(retrievedAt.getTime() + ttl * 1000)
}

/**
 * Whether evidence may still be reused.
 *
 * Evidence with no expiry is always fresh. Evidence expiring exactly now is
 * stale — the boundary belongs on the side that re-researches, because serving
 * a fact one millisecond past its declared life is the failure this guards.
 */
export function isFresh(expiresAt: string | null, now: Date = new Date()): boolean {
  if (expiresAt === null) return true
  const expiry = Date.parse(expiresAt)
  if (Number.isNaN(expiry)) return false
  return expiry > now.getTime()
}
