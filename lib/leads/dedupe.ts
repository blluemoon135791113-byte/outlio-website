/**
 * Duplicate detection (spec §12.1).
 *
 * Pure — no I/O. Deterministic key resolution in priority order; the first
 * strategy that yields a value wins, and which one was used is recorded.
 */
import { createHash } from 'node:crypto'

import type { DedupeStrategy } from '@/types/database'
import type { ParsedLead } from '@/lib/leads/parse'

export type DedupeMode = 'keep_all' | 'remove_exact' | 'remove_likely' | 'review'

export type KeyedLead = ParsedLead & {
  dedupeKey: string
  dedupeStrategy: DedupeStrategy
}

export type DedupeReport = {
  totalParsed: number
  uniqueKept: number
  duplicatesFound: number
  duplicatesRemoved: number
  strategyBreakdown: Record<string, number>
}

export type DedupeResult = {
  kept: KeyedLead[]
  /** Marked, not deleted, when the mode is `review`. */
  duplicates: Array<KeyedLead & { duplicateOfIndex: number }>
  report: DedupeReport
}

/** lowercase → NFKD → strip diacritics → keep [a-z0-9] → collapse. */
export function slug(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

/**
 * One-way key from identifying material.
 *
 * ⚠️ EVERY strategy goes through this. Dedupe keys OUTLIVE the lead rows they
 * came from — `purge_job_leads` copies them into `lead_keys`, which is kept for
 * the life of the account — so a key that embedded a readable name and employer
 * meant personal data survived a deletion the user was told was complete. Keys
 * are only ever compared for equality, so hashing costs nothing.
 *
 * These are PSEUDONYMOUS, not anonymous: a stable hash of a person's identifier
 * still singles that person out. It carries no readable personal data, which is
 * the point, but it remains personal data under the GDPR and the privacy policy
 * describes it that way. Do not call it "anonymous" anywhere.
 *
 * ⚠️ The material strings below are reproduced verbatim in migration
 * 0031_hash_dedupe_keys.sql, which rewrote the keys that already existed.
 * Change one without the other and cross-upload duplicate detection breaks
 * silently.
 */
function hashedKey(prefix: string, material: string): string {
  const digest = createHash('sha256').update(material).digest('hex').slice(0, 32)
  return `${prefix}:${digest}`
}

/**
 * Resolves the dedupe key.
 *
 * Priority order matters — earlier strategies are stronger identity claims:
 *
 *   1. linkedin_url_canonical — the member URN. Stable across saves, verified
 *      30/30 unique on real pages. Nearly always available.
 *   2. salesnav_id            — same identifier from the Sales Nav URL.
 *   3. name_company           — weaker; two people can share both.
 *   4. name_title_company     — adds the title to disambiguate.
 *   5. row_hash               — guarantees a key always exists. Only exact
 *      duplicates collide, so this never over-merges distinct people.
 */
export function resolveKey(lead: ParsedLead): {
  key: string
  strategy: DedupeStrategy
} {
  if (lead.memberUrn) {
    return { key: hashedKey('li', lead.memberUrn), strategy: 'linkedin_url_canonical' }
  }

  if (lead.salesNavUrl) {
    const m = /\/sales\/lead\/([A-Za-z0-9_-]+)/.exec(lead.salesNavUrl)
    if (m?.[1]) return { key: hashedKey('li', m[1]), strategy: 'salesnav_id' }
  }

  const name = slug(lead.fullName)
  const company = slug(lead.companyName)
  const title = slug(lead.jobTitle)

  if (name && company && title) {
    return {
      key: hashedKey('nt', `${name}|${title}|${company}`),
      strategy: 'name_title_company',
    }
  }
  if (name && company) {
    return { key: hashedKey('nc', `${name}|${company}`), strategy: 'name_company' }
  }

  // Always-available fallback. Hash of every non-null normalised field.
  const material = [
    lead.fullName, lead.jobTitle, lead.companyName, lead.location,
    lead.personBlurb, lead.tenureInRole, lead.tenureInCompany,
  ]
    .map((v) => (v ?? '').trim())
    .join('')

  return { key: hashedKey('rh', material), strategy: 'row_hash' }
}

/** Strategies considered strong enough to call an EXACT duplicate. */
const EXACT_STRATEGIES: ReadonlySet<DedupeStrategy> = new Set([
  'linkedin_url_canonical',
  'salesnav_id',
  'row_hash',
])

/**
 * Applies the chosen mode.
 *
 * ⚠️ NEVER DELETES SILENTLY. `review` marks and keeps; every mode returns a
 * full report. Hard deletion is always an explicit user action elsewhere.
 *
 * @param existingKeys keys already in the user's database, for cross-job dedupe
 */
export function dedupeLeads(
  leads: readonly ParsedLead[],
  mode: DedupeMode,
  existingKeys: ReadonlySet<string> = new Set(),
): DedupeResult {
  const keyed: KeyedLead[] = leads.map((lead) => {
    const { key, strategy } = resolveKey(lead)
    return { ...lead, dedupeKey: key, dedupeStrategy: strategy }
  })

  const strategyBreakdown: Record<string, number> = {}
  for (const l of keyed) {
    strategyBreakdown[l.dedupeStrategy] = (strategyBreakdown[l.dedupeStrategy] ?? 0) + 1
  }

  if (mode === 'keep_all') {
    return {
      kept: keyed,
      duplicates: [],
      report: {
        totalParsed: keyed.length,
        uniqueKept: keyed.length,
        duplicatesFound: 0,
        duplicatesRemoved: 0,
        strategyBreakdown,
      },
    }
  }

  const seen = new Map<string, number>()
  const kept: KeyedLead[] = []
  const duplicates: Array<KeyedLead & { duplicateOfIndex: number }> = []

  for (const lead of keyed) {
    const strongEnough =
      mode === 'remove_exact'
        ? EXACT_STRATEGIES.has(lead.dedupeStrategy)
        : true // remove_likely and review consider every strategy

    const priorIndex = seen.get(lead.dedupeKey)
    const isCrossJobDuplicate = existingKeys.has(lead.dedupeKey)
    const isDuplicate = strongEnough && (priorIndex !== undefined || isCrossJobDuplicate)

    if (!isDuplicate) {
      seen.set(lead.dedupeKey, kept.length)
      kept.push(lead)
      continue
    }

    duplicates.push({ ...lead, duplicateOfIndex: priorIndex ?? -1 })
  }

  // `review` keeps everything, flagged.
  const removed = mode === 'review' ? 0 : duplicates.length
  const finalKept = mode === 'review' ? [...kept, ...duplicates] : kept

  return {
    kept: finalKept,
    duplicates,
    report: {
      totalParsed: keyed.length,
      uniqueKept: mode === 'review' ? keyed.length : kept.length,
      duplicatesFound: duplicates.length,
      duplicatesRemoved: removed,
      strategyBreakdown,
    },
  }
}
