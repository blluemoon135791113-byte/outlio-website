/**
 * Duplicate detection scoring (M2 Phase 4).
 *
 * PURE — no I/O. Decides what a human is asked to judge, and says why.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  NEVER SILENTLY MERGE UNCERTAIN PEOPLE.                                  ║
 * ║                                                                          ║
 * ║  Nothing here merges anything. It produces a score and a list of         ║
 * ║  human-readable reasons; a person decides. The only automatic dedup in   ║
 * ║  the system is the pair of unique indexes from 0071 — same mailbox, same ║
 * ║  LinkedIn identity — and those are certainties, not judgements.          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * THE TRAP THIS FILE EXISTS TO AVOID:
 *
 *   Two colleagues share a switchboard number and an employer. Score those
 *   signals additively and every pair of colleagues in the workspace becomes a
 *   "duplicate", the Duplicate Center fills with noise, and the one real
 *   duplicate is lost in it. A Center nobody trusts is worse than no Center.
 *
 * So NAME SIMILARITY IS A GATE, not just another weight. Company, phone and
 * email-domain only ever amplify a name that already matches; on their own
 * they describe colleagues.
 */

// ---------------------------------------------------------------------------
// String similarity
// ---------------------------------------------------------------------------

/**
 * Trigram set for a string, in the style of Postgres `pg_trgm`.
 *
 * Each word is padded with two leading spaces and one trailing space before
 * slicing, so short words still yield trigrams and word boundaries carry
 * weight — "sam" and "samuel" share a start but are not the same token.
 *
 * ⚠️ NOT bit-identical to pg_trgm, and the difference matters.
 *
 * pg_trgm's `similarity()` is Jaccard: shared / (a + b - shared). This is
 * DICE: 2·shared / (a + b). Dice was chosen because Jaccard badly underrates
 * the most common real defect — one mistyped character in one word of a
 * two-word name. "Samuel Ellis" vs "Samual Ellis" is 0.63 under Jaccard,
 * barely above the gate, and 0.77 under Dice, which is much closer to how
 * similar those two names actually are.
 *
 * If a SQL pre-filter is ever added it must use `similarity()` for BLOCKING
 * only, with a correspondingly LOWER threshold, and the final score always
 * computed here. Two definitions of "similar" scoring one pair differently is
 * how a Duplicate Center starts disagreeing with itself.
 */
export function trigrams(value: string): Set<string> {
  const cleaned = value
    .normalize('NFKD')
    // Strip diacritics so "José" and "Jose" are the same name.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  const out = new Set<string>()
  if (!cleaned) return out

  for (const word of cleaned.split(' ')) {
    const padded = `  ${word} `
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      out.add(padded.slice(i, i + 3))
    }
  }

  return out
}

/** Dice coefficient over trigram sets: 0 (nothing shared) to 1 (identical). */
export function trigramSimilarity(a: string, b: string): number {
  const left = trigrams(a)
  const right = trigrams(b)
  if (left.size === 0 || right.size === 0) return 0

  let shared = 0
  for (const gram of left) if (right.has(gram)) shared += 1

  return (2 * shared) / (left.size + right.size)
}

function nameTokens(value: string): string[] {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/**
 * How alike two personal names are, 0 to 1.
 *
 * Trigram overlap alone underrates the two ways real data differs:
 *
 *   INITIALS   "S. Ellis" and "Sam Ellis" share almost no trigrams and are
 *              very often one person.
 *   ORDER      "Ellis, Sam" and "Sam Ellis" are the same name written the way
 *              two different systems export it.
 *
 * Both are handled explicitly. Everything else falls through to trigrams,
 * which is what catches ordinary typos.
 */
export function nameSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0

  const left = nameTokens(a)
  const right = nameTokens(b)
  if (left.length === 0 || right.length === 0) return 0

  // Order-insensitive exact match: "Ellis Sam" === "Sam Ellis".
  const sortedLeft = [...left].sort().join(' ')
  const sortedRight = [...right].sort().join(' ')
  if (sortedLeft === sortedRight) return 1

  // Same surname, and one first name is the other's initial.
  const lastLeft = left.at(-1)!
  const lastRight = right.at(-1)!
  if (lastLeft === lastRight && left.length > 1 && right.length > 1) {
    const firstLeft = left[0]!
    const firstRight = right[0]!
    if (firstLeft === firstRight) return 1
    const initialMatch =
      (firstLeft.length === 1 && firstRight.startsWith(firstLeft)) ||
      (firstRight.length === 1 && firstLeft.startsWith(firstRight))
    // Not 1: "S. Ellis" really might be Sam or Sarah. High enough to surface
    // with any corroborating signal, not high enough to stand alone.
    if (initialMatch) return 0.86
  }

  return trigramSimilarity(a, b)
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type SignalKind =
  | 'linkedin_identical'
  | 'email_identical'
  | 'name_identical'
  | 'name_similar'
  | 'company_identical'
  | 'phone_identical'
  | 'email_domain_identical'

export type DuplicateSignal = {
  kind: SignalKind
  weight: number
  /** Shown to the person deciding. Complete on its own, no jargon. */
  reason: string
}

export type Confidence = 'exact' | 'possible' | 'none'

export type CandidateScore = {
  score: number
  confidence: Confidence
  signals: DuplicateSignal[]
  /** e.g. "Same company, very similar name — 80%". Empty when not a candidate. */
  summary: string
}

/** Everything the scorer needs about one contact. All values pre-normalized. */
export type ContactFacts = {
  fullName: string | null
  linkedInIdentityKey: string | null
  /** Folded mailbox keys, from `normalizeEmail`. */
  emailIdentityKeys: string[]
  /** E.164 only. An unresolved number is not evidence of anything. */
  phoneE164s: string[]
  /** `crm_companies.id` values this contact is linked to. */
  companyIds: string[]
  /** Registrable domains of their addresses, mailbox providers excluded. */
  emailDomains: string[]
}

/**
 * Below this, two names are different names and no amount of shared context
 * makes the pair a duplicate — it makes them colleagues.
 */
const NAME_GATE = 0.62

/** At or above this a pair is worth a person's attention. */
const POSSIBLE_THRESHOLD = 60

/**
 * Reserved for certainties. A judgement call never reaches 100, so "100%" in
 * the UI always means "the same mailbox or the same LinkedIn identity".
 */
const EXACT_SCORE = 100

const NONE: CandidateScore = { score: 0, confidence: 'none', signals: [], summary: '' }

function overlap(a: string[], b: string[]): string[] {
  if (a.length === 0 || b.length === 0) return []
  const right = new Set(b)
  return [...new Set(a)].filter((value) => right.has(value))
}

function summarize(signals: DuplicateSignal[], score: number): string {
  const reasons = signals.map((s) => s.reason)
  if (reasons.length === 0) return ''
  const joined =
    reasons.length === 1
      ? reasons[0]!
      : `${reasons.slice(0, -1).join(', ')} and ${reasons.at(-1)}`
  return `${joined} — ${score}%`
}

/**
 * Scores a pair of contacts.
 *
 * Returns `confidence: 'none'` for pairs nobody should be asked about. The
 * caller stores only what comes back `exact` or `possible`.
 */
export function scoreContactPair(a: ContactFacts, b: ContactFacts): CandidateScore {
  // ---- certainties --------------------------------------------------------
  // These should already be impossible: 0071's unique indexes prevent two live
  // contacts sharing either. They are scored anyway because a merge, an undo,
  // or a soft delete can briefly free a key, and a certainty must never be
  // presented as a guess.
  if (
    a.linkedInIdentityKey &&
    b.linkedInIdentityKey &&
    a.linkedInIdentityKey === b.linkedInIdentityKey
  ) {
    const signals: DuplicateSignal[] = [
      {
        kind: 'linkedin_identical',
        weight: EXACT_SCORE,
        reason: 'Same LinkedIn profile',
      },
    ]
    return {
      score: EXACT_SCORE,
      confidence: 'exact',
      signals,
      summary: summarize(signals, EXACT_SCORE),
    }
  }

  const sharedEmails = overlap(a.emailIdentityKeys, b.emailIdentityKeys)
  if (sharedEmails.length > 0) {
    const signals: DuplicateSignal[] = [
      { kind: 'email_identical', weight: EXACT_SCORE, reason: 'Same email address' },
    ]
    return {
      score: EXACT_SCORE,
      confidence: 'exact',
      signals,
      summary: summarize(signals, EXACT_SCORE),
    }
  }

  // ---- the gate -----------------------------------------------------------
  const similarity = nameSimilarity(a.fullName, b.fullName)
  if (similarity < NAME_GATE) return NONE

  const signals: DuplicateSignal[] = []

  if (similarity >= 0.999) {
    signals.push({ kind: 'name_identical', weight: 55, reason: 'Same name' })
  } else {
    /*
     * 0.62 → 35, 1.0 → 55. Deliberately never enough on its own: two people
     * in one workspace can genuinely share a name.
     *
     * The floor is 35 rather than something lower because a name that has
     * already cleared the gate is meaningfully similar, and the interesting
     * case — a typo plus one corroborating signal — has to be able to reach
     * the threshold. At a floor of 30, "Samuel Ellis" and "Samual Ellis"
     * sharing a phone number scored 59 against a threshold of 60 and went
     * unreported, which is precisely the pair a person should see.
     */
    const weight = Math.round(35 + (similarity - NAME_GATE) * (20 / (1 - NAME_GATE)))
    signals.push({
      kind: 'name_similar',
      weight,
      reason: 'Very similar name',
    })
  }

  // ---- corroboration ------------------------------------------------------
  if (overlap(a.companyIds, b.companyIds).length > 0) {
    signals.push({ kind: 'company_identical', weight: 25, reason: 'Same company' })
  }

  if (overlap(a.phoneE164s, b.phoneE164s).length > 0) {
    // Weighted below company on purpose: a shared number is more often a
    // switchboard than a duplicate, so it corroborates a name rather than
    // carrying the pair.
    signals.push({ kind: 'phone_identical', weight: 20, reason: 'Same phone number' })
  }

  if (overlap(a.emailDomains, b.emailDomains).length > 0) {
    // Mailbox providers are already excluded upstream by `normalizeDomain`, so
    // this means a shared employer domain, not a shared gmail.com.
    signals.push({
      kind: 'email_domain_identical',
      weight: 10,
      reason: 'Email addresses at the same domain',
    })
  }

  // Capped one below EXACT_SCORE: a judgement never claims certainty.
  const score = Math.min(
    EXACT_SCORE - 1,
    signals.reduce((total, signal) => total + signal.weight, 0),
  )

  if (score < POSSIBLE_THRESHOLD) return NONE

  return { score, confidence: 'possible', signals, summary: summarize(signals, score) }
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export type CompanyFacts = {
  normalizedName: string | null
  normalizedDomain: string | null
  normalizedLinkedInUrl: string | null
}

/**
 * Scores a pair of companies.
 *
 * Domain and LinkedIn page are certainties, matching the identity precedence
 * in 0071 and `lib/companies/normalize.ts`. Name alone is a candidate at best
 * — "Apex Systems" and "Apex Ltd" are usually two firms, and merging them
 * silently would take two customers' records with them.
 */
export function scoreCompanyPair(a: CompanyFacts, b: CompanyFacts): CandidateScore {
  const exact = (kind: SignalKind, reason: string): CandidateScore => {
    const signals: DuplicateSignal[] = [{ kind, weight: EXACT_SCORE, reason }]
    return {
      score: EXACT_SCORE,
      confidence: 'exact',
      signals,
      summary: summarize(signals, EXACT_SCORE),
    }
  }

  if (a.normalizedDomain && b.normalizedDomain && a.normalizedDomain === b.normalizedDomain) {
    return exact('email_domain_identical', 'Same website domain')
  }

  if (
    a.normalizedLinkedInUrl &&
    b.normalizedLinkedInUrl &&
    a.normalizedLinkedInUrl === b.normalizedLinkedInUrl
  ) {
    return exact('linkedin_identical', 'Same LinkedIn company page')
  }

  if (!a.normalizedName || !b.normalizedName) return NONE

  const similarity = trigramSimilarity(a.normalizedName, b.normalizedName)
  if (a.normalizedName === b.normalizedName) {
    const signals: DuplicateSignal[] = [
      { kind: 'name_identical', weight: 70, reason: 'Same company name' },
    ]
    return { score: 70, confidence: 'possible', signals, summary: summarize(signals, 70) }
  }

  if (similarity < 0.75) return NONE

  const score = Math.round(60 + (similarity - 0.75) * 30)
  const signals: DuplicateSignal[] = [
    { kind: 'name_similar', weight: score, reason: 'Very similar company name' },
  ]
  return { score, confidence: 'possible', signals, summary: summarize(signals, score) }
}

/** Canonical pair ordering, matching the `record_a_id < record_b_id` check in 0074. */
export function orderPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x]
}
