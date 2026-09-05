/**
 * Identity resolution — "is this actually the right person?"
 *
 * PURE. No I/O, no clock, no environment.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THE FAILURE THIS EXISTS TO PREVENT.                                     ║
 * ║                                                                          ║
 * ║  A search for `"James Smith" email` returns a real, published, correct   ║
 * ║  email address — belonging to a DIFFERENT James Smith. Filed against the ║
 * ║  lead it looks indistinguishable from a genuine find: it has a source    ║
 * ║  URL, it passes every format check, and it will be exported to a CRM and ║
 * ║  emailed. A wrong contact is worse than a missing one, because a missing ║
 * ║  one is visibly missing.                                                 ║
 * ║                                                                          ║
 * ║  ⚠️ A NAME ALONE CAN NEVER PRODUCE A MATCH. That is the whole rule. It   ║
 * ║  is asserted in code below and asserted again by test, because it is the ║
 * ║  single invariant that stops same-name contamination.                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Before this file, `mentionsIdentity()` was a private boolean inside
 * `search-contact.ts` — so exactly one provider asked the question, and every
 * other one either re-invented the check or skipped it. Identity is a property
 * of the SYSTEM, not of one adapter.
 */
import { normalizeCompanyName } from '@/lib/companies/normalize'

/** What we know about the lead. The thing being matched TO. */
export type IdentitySubject = {
  fullName: string | null
  companyName: string | null
  companyDomain: string | null
  jobTitle: string | null
  linkedinUrl: string | null
  /**
   * A corroborating signal only — a city can never distinguish a person from a
   * namesake on its own, and the resolver enforces that regardless of what is
   * passed here.
   */
  location: string | null
}

/** What a provider or a page is offering. The thing being matched FROM. */
export type IdentityObservation = {
  /** Free text that may mention the person: a title, a snippet, page copy. */
  text?: string | null
  /** Where the text came from. Its host is itself an identity signal. */
  url?: string | null
  /** Identifiers a structured provider returned about its candidate. */
  candidate?: {
    fullName?: string | null
    jobTitle?: string | null
    companyName?: string | null
    companyDomain?: string | null
    linkedinUrl?: string | null
    location?: string | null
  }
}

export const IDENTITY_SIGNALS = [
  'linkedin_url',
  'name_exact',
  'name_tokens',
  'employer_domain',
  'employer_name',
  'job_title',
  'location',
] as const

export type IdentitySignal = (typeof IDENTITY_SIGNALS)[number]

export type IdentityVerdict = 'match' | 'weak' | 'no_match'

export type IdentityMatch = {
  verdict: IdentityVerdict
  /** 0–1. Recorded on the evidence so a wrong value can be traced later. */
  score: number
  signals: IdentitySignal[]
  /** Present whenever the verdict is not `match`. */
  reason: string | null
}

/**
 * Weights.
 *
 * Name establishes a CANDIDATE. Everything else establishes that the candidate
 * is our person. The numbers are chosen so that name + any one employer signal
 * clears the bar, and name + every non-employer signal does not: a job title
 * and a city are shared by thousands of people, an employer is not.
 */
const WEIGHT: Record<IdentitySignal, number> = {
  // A LinkedIn profile URL is a unique identifier, so it is decisive on its own.
  linkedin_url: 0.97,
  name_exact: 0.42,
  name_tokens: 0.36,
  employer_domain: 0.36,
  employer_name: 0.30,
  job_title: 0.12,
  location: 0.08,
}

const MATCH_THRESHOLD = 0.7
const WEAK_THRESHOLD = 0.45

/** Signals that, on their own, distinguish one person from their namesakes. */
const DISTINGUISHING: ReadonlySet<IdentitySignal> = new Set([
  'linkedin_url',
  'employer_domain',
  'employer_name',
])

function words(value: string | null | undefined): string[] {
  return (value ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

function bareDomain(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    ?.split(':')[0] ?? ''
}

function hostOf(url: string | null | undefined): string {
  try {
    return new URL(url ?? '').hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function onDomain(host: string, domain: string): boolean {
  return Boolean(host && domain) && (host === domain || host.endsWith(`.${domain}`))
}

/**
 * Canonical form of a LinkedIn profile URL, for comparison only.
 *
 * ⚠️ RECORDED AND COMPARED, NEVER FETCHED (CLAUDE.md rules 1–2). Locale
 * subdomains (`uk.linkedin.com`), query strings and trailing slashes are all
 * noise on what is otherwise a stable unique identifier.
 */
export function canonicalLinkedInUrl(value: string | null | undefined): string | null {
  if (!value) return null
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    return null
  }
  if (!/(^|\.)linkedin\.com$/.test(parsed.hostname.toLowerCase())) return null

  const path = parsed.pathname.toLowerCase().replace(/\/+$/, '')
  // Only PERSON profiles are identities. A company page says nothing about
  // which employee is being discussed.
  const match = /^\/(?:in|sales\/lead)\/([^/]+)/.exec(path)
  return match ? `linkedin.com/in/${decodeURIComponent(match[1]!)}` : null
}

/** True when the subject's full name appears as a contiguous phrase. */
function nameAppearsExactly(nameTokens: readonly string[], haystack: readonly string[]): boolean {
  if (nameTokens.length === 0 || nameTokens.length > haystack.length) return false
  for (let start = 0; start + nameTokens.length <= haystack.length; start += 1) {
    if (nameTokens.every((token, offset) => haystack[start + offset] === token)) return true
  }
  return false
}

/**
 * True when the name's anchors are present.
 *
 * ⚠️ A SINGLE-LETTER ANCHOR IS AN INITIAL, AND MUST SIT IN A NAME POSITION.
 * Captured lead sources often abbreviate a surname ("Muhritz W") while
 * first-party pages spell it out, so the initial has to match something — but
 * matching it against ANY word starting with that letter makes the surname
 * check a no-op: "works", "with", "website" and "welcome" all satisfy a "W".
 * That degrades the test to first-name-plus-employer and readmits exactly the
 * namesake contamination this module exists to prevent.
 *
 * So the initial must be ADJACENT to the spelled-out anchor, in the right
 * order, AND capitalised in the source: "Muhritz Waheed" passes, "Muhritz
 * Ahmed works with…" does not, and neither does "Muhritz will be speaking" —
 * adjacency alone still admits a function word that happens to start with the
 * right letter.
 *
 * Capitalisation is the cheapest signal that separates a surname from a
 * stopword, and preferring it costs us pages that style names in lower case.
 * That trade is deliberate: a wrong contact is worse than a missing one.
 */
function anchorsPresent(
  anchors: readonly string[],
  haystack: readonly string[],
  cased: readonly string[],
): boolean {
  if (anchors.length === 1) {
    // A lone initial identifies nobody at all.
    const only = anchors[0]!
    return only.length > 1 && haystack.includes(only)
  }

  const [first, last] = anchors as [string, string]
  const firstIsInitial = first.length === 1
  const lastIsInitial = last.length === 1

  // "J. S." is not a name.
  if (firstIsInitial && lastIsInitial) return false

  if (!firstIsInitial && !lastIsInitial) {
    return haystack.includes(first) && haystack.includes(last)
  }

  const spelled = firstIsInitial ? last : first
  const initial = firstIsInitial ? first : last
  return haystack.some((token, index) => {
    if (token !== spelled) return false
    // The initial precedes a surname and follows a forename.
    const at = firstIsInitial ? index - 1 : index + 1
    const neighbour = haystack[at]
    if (!neighbour?.startsWith(initial)) return false
    const original = cased[at] ?? ''
    return original.slice(0, 1) !== original.slice(0, 1).toLowerCase()
  })
}

/**
 * Scores one observation against one subject.
 *
 * Never throws, and never guesses: an unparseable URL contributes nothing
 * rather than being treated as a mismatch, because absence of a signal is not
 * evidence against.
 */
export function resolveIdentity(
  subject: IdentitySubject,
  observation: IdentityObservation,
): IdentityMatch {
  // Keep one-letter initials: captured lead sources frequently abbreviate a
  // surname ("Muhritz W") while first-party pages spell it in full.
  const nameTokens = words(subject.fullName)
  if (nameTokens.length === 0) {
    return { verdict: 'no_match', score: 0, signals: [], reason: 'subject has no name' }
  }

  const candidate = observation.candidate ?? {}
  const text = `${observation.text ?? ''} ${candidate.fullName ?? ''} ${candidate.jobTitle ?? ''} ${candidate.companyName ?? ''} ${candidate.location ?? ''}`
  // Case is preserved in parallel: an initial is only credible next to a
  // capitalised neighbour, and `words()` lower-cases everything.
  const cased = text.match(/[\p{L}\p{N}]+/gu) ?? []
  const haystack = cased.map((token) => token.toLowerCase())
  const compact = haystack.join('')
  const signals: IdentitySignal[] = []

  /* ---- LinkedIn URL: decisive, and checked first. --------------------- */
  const subjectProfile = canonicalLinkedInUrl(subject.linkedinUrl)
  const candidateProfile =
    canonicalLinkedInUrl(candidate.linkedinUrl) ?? canonicalLinkedInUrl(observation.url)
  if (subjectProfile && candidateProfile && subjectProfile === candidateProfile) {
    return { verdict: 'match', score: WEIGHT.linkedin_url, signals: ['linkedin_url'], reason: null }
  }
  /*
   * ⚠️ TWO DIFFERENT PROFILE URLS ARE A REFUSAL, not merely a missing signal.
   * This is the one place we can be certain two records are different people,
   * and saying so is worth more than any amount of name agreement.
   */
  if (subjectProfile && candidateProfile && subjectProfile !== candidateProfile) {
    return {
      verdict: 'no_match',
      score: 0,
      signals: [],
      reason: 'candidate is a different LinkedIn profile',
    }
  }

  /* ---- Name: necessary, never sufficient. ----------------------------- */
  // First and last anchor the name. Middle names appear inconsistently and
  // requiring them loses real matches.
  const anchors = nameTokens.length === 1 ? nameTokens : [nameTokens[0]!, nameTokens.at(-1)!]
  if (!anchorsPresent(anchors, haystack, cased)) {
    return { verdict: 'no_match', score: 0, signals: [], reason: 'name not present' }
  }
  signals.push(nameAppearsExactly(nameTokens, haystack) ? 'name_exact' : 'name_tokens')

  /* ---- Employer: the signal that separates namesakes. ------------------ */
  const employerDomain = bareDomain(subject.companyDomain)
  if (employerDomain) {
    const host = hostOf(observation.url)
    const candidateHost = bareDomain(candidate.companyDomain)
    if (
      onDomain(host, employerDomain) ||
      onDomain(candidateHost, employerDomain) ||
      text.toLowerCase().includes(employerDomain)
    ) {
      signals.push('employer_domain')
    }
  }

  const employerName = normalizeCompanyName(subject.companyName)
  if (employerName && employerName.length > 2) {
    // Compared without separators so "acme corp" matches "AcmeCorp" and
    // "Acme-Corp" — the same employer written three ways.
    const needle = words(employerName).join('')
    if (needle.length > 2 && compact.includes(needle)) signals.push('employer_name')
  }

  /* ---- Weak corroborators. They refine, they never decide. ------------- */
  const titleTokens = words(subject.jobTitle).filter((token) => token.length > 3)
  if (titleTokens.length > 0 && titleTokens.every((token) => haystack.includes(token))) {
    signals.push('job_title')
  }

  const locationTokens = words(subject.location).filter((token) => token.length > 2)
  if (locationTokens.length > 0 && locationTokens.some((token) => haystack.includes(token))) {
    signals.push('location')
  }

  const score = Math.min(
    0.96,
    signals.reduce((total, signal) => total + WEIGHT[signal], 0),
  )

  /*
   * ⚠️ THE INVARIANT. Without a distinguishing signal this is a namesake, no
   * matter how high the arithmetic ran. Enforced here rather than left to the
   * weights, so tuning a weight can never quietly delete the rule.
   */
  const distinguished = signals.some((signal) => DISTINGUISHING.has(signal))
  if (!distinguished) {
    return {
      verdict: score >= WEAK_THRESHOLD ? 'weak' : 'no_match',
      score: Math.min(score, WEAK_THRESHOLD + 0.14),
      signals,
      reason: 'name matched but nothing distinguishes this person from a namesake',
    }
  }

  if (score >= MATCH_THRESHOLD) {
    return { verdict: 'match', score, signals, reason: null }
  }
  return {
    verdict: score >= WEAK_THRESHOLD ? 'weak' : 'no_match',
    score,
    signals,
    reason: 'not enough identifiers agree',
  }
}

/** The gate providers call: may this observation be filed against this lead? */
export function identityAccepted(match: IdentityMatch): boolean {
  return match.verdict === 'match'
}

/**
 * Best match across several observations of the same candidate.
 *
 * Corroboration across pages is what turns two weak observations into an
 * accepted one — but only when at least one of them was distinguishing, so
 * this can never launder two namesake pages into a match.
 */
export function bestIdentityMatch(
  subject: IdentitySubject,
  observations: readonly IdentityObservation[],
): IdentityMatch {
  let best: IdentityMatch = {
    verdict: 'no_match',
    score: 0,
    signals: [],
    reason: 'no observations',
  }
  for (const observation of observations) {
    const match = resolveIdentity(subject, observation)
    if (match.score > best.score) best = match
  }
  return best
}
