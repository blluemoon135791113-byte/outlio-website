/**
 * Dedupe key privacy invariant — migration 0031.
 *
 * Dedupe keys OUTLIVE the lead rows they came from: `purge_job_leads` copies
 * them into `lead_keys`, which is retained for the life of the account. Three
 * of the four strategies used to embed identifying data in readable form, so a
 * user who cleared their data still had their prospects' names and employers in
 * our database indefinitely.
 *
 * The rule these tests defend: NO dedupe key may contain readable personal
 * data, ever, by any strategy. Keys are only compared for equality, so there is
 * no legitimate reason for one to be reversible.
 */
import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { resolveKey } from '@/lib/leads/dedupe'
import type { ParsedLead } from '@/lib/leads/parse'

function lead(over: Partial<ParsedLead>): ParsedLead {
  return {
    fullName: null,
    linkedinUrl: null,
    salesNavUrl: null,
    memberUrn: null,
    jobTitle: null,
    companyName: null,
    companyUrl: null,
    companyWebsiteUrl: null,
    location: null,
    personBlurb: null,
    tenureInRole: null,
    tenureInCompany: null,
    connectionDegree: null,
    isReachable: null,
    listCount: null,
    lastActivity: null,
    addedToListAt: null,
    sourceList: null,
    companyIndustry: null,
    companySize: null,
    companyHeadquarters: null,
    sourceRowIndex: 0,
    ...over,
  }
}

/** One lead per strategy, so every branch of resolveKey is covered. */
const IDENTIFYING = {
  name: 'Wilhelmina Vandersplat',
  title: 'Chief Revenue Officer',
  company: 'Zorbtech Industries',
  urn: 'ACwAAAFabricated9001',
}

const BY_STRATEGY: Array<[string, ParsedLead]> = [
  ['linkedin_url_canonical', lead({ memberUrn: IDENTIFYING.urn, fullName: IDENTIFYING.name })],
  [
    'salesnav_id',
    lead({
      salesNavUrl: `https://www.linkedin.com/sales/lead/${IDENTIFYING.urn},NAME_SEARCH,ab12`,
      fullName: IDENTIFYING.name,
    }),
  ],
  [
    'name_title_company',
    lead({
      fullName: IDENTIFYING.name,
      jobTitle: IDENTIFYING.title,
      companyName: IDENTIFYING.company,
    }),
  ],
  ['name_company', lead({ fullName: IDENTIFYING.name, companyName: IDENTIFYING.company })],
  ['row_hash', lead({ fullName: IDENTIFYING.name, location: 'Reykjavik' })],
]

describe('no dedupe key leaks personal data', () => {
  it.each(BY_STRATEGY)('%s produces an opaque key', (strategy, input) => {
    const { key, strategy: got } = resolveKey(input)
    expect(got).toBe(strategy)

    const haystack = key.toLowerCase()
    for (const secret of Object.values(IDENTIFYING)) {
      // Whole value, and each word of it — "vandersplat" must not survive
      // either, not just the full name.
      expect(haystack).not.toContain(secret.toLowerCase())
      for (const word of secret.split(/\s+/)) {
        expect(haystack).not.toContain(word.toLowerCase())
      }
    }
  })

  it.each(BY_STRATEGY)('%s is prefix + 32 hex characters', (_strategy, input) => {
    expect(resolveKey(input).key).toMatch(/^(li|nt|nc|rh):[0-9a-f]{32}$/)
  })

  it('never emits the legacy readable shapes', () => {
    for (const [, input] of BY_STRATEGY) {
      const { key } = resolveKey(input)
      expect(key).not.toContain('|')
      expect(key).not.toContain('li:lead:')
    }
  })
})

describe('hashing did not break duplicate detection', () => {
  it('gives the same person the same key across two saves', () => {
    const first = resolveKey(lead({ memberUrn: IDENTIFYING.urn }))
    const second = resolveKey(lead({ memberUrn: IDENTIFYING.urn, location: 'Oslo' }))
    expect(first.key).toBe(second.key)
  })

  it('separates two people who share a name but not an employer', () => {
    const a = resolveKey(lead({ fullName: 'Jane Roe', companyName: 'Acme' }))
    const b = resolveKey(lead({ fullName: 'Jane Roe', companyName: 'Umbrella' }))
    expect(a.key).not.toBe(b.key)
  })

  it('separates two people who share a name and employer but not a title', () => {
    const base = { fullName: 'Jane Roe', companyName: 'Acme' }
    const a = resolveKey(lead({ ...base, jobTitle: 'Analyst' }))
    const b = resolveKey(lead({ ...base, jobTitle: 'Director' }))
    expect(a.key).not.toBe(b.key)
  })

  it('matches the same lead reached by URN and by Sales Navigator URL', () => {
    const viaUrn = resolveKey(lead({ memberUrn: IDENTIFYING.urn }))
    const viaUrl = resolveKey(
      lead({ salesNavUrl: `https://www.linkedin.com/sales/lead/${IDENTIFYING.urn},NAME_SEARCH,x` }),
    )
    expect(viaUrn.key).toBe(viaUrl.key)
  })
})

describe('parity with migration 0031', () => {
  /** What the SQL computes: prefix || left(sha256(material), 32). */
  function sqlEquivalent(prefix: string, material: string): string {
    return `${prefix}:${createHash('sha256').update(material).digest('hex').slice(0, 32)}`
  }

  it('rewrites a legacy li:lead: key to the same value the code now emits', () => {
    // Legacy key was `li:lead:<urn>`; SQL hashes substr(key, 9) = the urn.
    expect(resolveKey(lead({ memberUrn: IDENTIFYING.urn })).key).toBe(
      sqlEquivalent('li', IDENTIFYING.urn),
    )
  })

  it('rewrites a legacy nt: key to the same value the code now emits', () => {
    // Legacy key was `nt:<name>|<title>|<company>` of slugged values.
    expect(
      resolveKey(
        lead({
          fullName: IDENTIFYING.name,
          jobTitle: IDENTIFYING.title,
          companyName: IDENTIFYING.company,
        }),
      ).key,
    ).toBe(sqlEquivalent('nt', 'wilhelminavandersplat|chiefrevenueofficer|zorbtechindustries'))
  })

  it('rewrites a legacy nc: key to the same value the code now emits', () => {
    expect(
      resolveKey(lead({ fullName: IDENTIFYING.name, companyName: IDENTIFYING.company })).key,
    ).toBe(sqlEquivalent('nc', 'wilhelminavandersplat|zorbtechindustries'))
  })

  it('leaves row_hash keys byte-identical, so 0031 correctly skips them', () => {
    /*
     * row_hash joins its fields with U+0001, NOT with the pipe that nt/nc use.
     * The character is invisible in most editors, so it is spelled out here:
     * get it wrong and every row_hash key silently changes, orphaning the
     * dedupe history of every affected lead.
     */
    const SEP = ''
    const material = ['Jane Roe', '', '', 'Oslo', '', '', ''].join(SEP)
    expect(resolveKey(lead({ fullName: 'Jane Roe', location: 'Oslo' })).key).toBe(
      sqlEquivalent('rh', material),
    )
  })

  it('uses a pipe for nt/nc, which is what migration 0031 keys its guard on', () => {
    // 0031 identifies unconverted nt/nc rows by the presence of a pipe. If the
    // separator ever changes, that WHERE clause stops matching and the rewrite
    // silently does nothing.
    const legacyNt = 'wilhelminavandersplat|chiefrevenueofficer|zorbtechindustries'
    expect(legacyNt).toContain('|')
    expect(
      resolveKey(
        lead({
          fullName: IDENTIFYING.name,
          jobTitle: IDENTIFYING.title,
          companyName: IDENTIFYING.company,
        }),
      ).key,
    ).toBe(sqlEquivalent('nt', legacyNt))
  })
})
