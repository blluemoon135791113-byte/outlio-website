/**
 * Reading company evidence, one shape at a time.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ EVERY FIELD HAS A DIFFERENT `value_json` SHAPE, AND A WRONG READER     ║
 * ║  FAILS SILENTLY.                                                          ║
 * ║                                                                           ║
 * ║      funding_round   {"round":"Pre seed"}                                 ║
 * ║      tech_stack      {"detected":[{"name":"Cloudflare"},…]}               ║
 * ║      recent_news     {"articles":[{"url":…,"title":…}]}                   ║
 * ║      social_profiles {"profiles":["https://…"]}                           ║
 * ║                                                                           ║
 * ║  There is no generic `value` key. A reader that assumes one returns null  ║
 * ║  for all of them, the section renders empty, and 358 tech-stack rows sit  ║
 * ║  in production looking exactly like a company nobody researched. That is  ║
 * ║  how this data became invisible in the first place — it was never a       ║
 * ║  crash, it was a lookup that quietly missed.                              ║
 * ║                                                                           ║
 * ║  ⚠️ THE FIXTURES BELOW ARE REAL SHAPES FROM PRODUCTION, with fabricated    ║
 * ║  values. Inventing a convenient shape would test the reader against my    ║
 * ║  own assumption rather than against the database.                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import {
  companyWebsite,
  formatEvidenceItem,
  GROUPS,
  linkedInSlug,
  type EvidenceRow,
} from '@/lib/crm/company-details'

function row(field: string, value_json: Record<string, unknown>): EvidenceRow {
  return {
    field,
    value_json,
    source_provider: 'crunchbase',
    source_url: 'https://www.crunchbase.com/organization/fabricated',
    retrieved_at: '2026-09-01T00:00:00.000Z',
    confidence: 0.9,
  }
}

describe('the shapes that actually exist in production', () => {
  it('reads funding_round from `round`', () => {
    expect(formatEvidenceItem(row('funding_round', { round: 'Pre seed' }))?.text).toBe('Pre seed')
  })

  it('reads tech_stack from `detected[].name`', () => {
    const item = formatEvidenceItem(
      row('tech_stack', {
        coverage: 'vendor_detected',
        detected: [
          { id: 'cloudflare', name: 'Cloudflare', category: 'CDN' },
          { id: 'hubspot', name: 'HubSpot', category: 'CRM' },
        ],
      }),
    )
    expect(item?.text).toBe('Cloudflare, HubSpot')
  })

  it('reads recent_news into links', () => {
    const item = formatEvidenceItem(
      row('recent_news', {
        articles: [{ url: 'https://example.com/story', title: 'They raised a round' }],
      }),
    )
    expect(item?.links).toEqual([
      { label: 'They raised a round', url: 'https://example.com/story' },
    ])
  })

  it('reads social_profiles into links labelled by host', () => {
    const item = formatEvidenceItem(
      row('social_profiles', { profiles: ['https://www.linkedin.com/company/fabricated'] }),
    )
    expect(item?.links?.[0]?.label).toBe('linkedin.com')
  })

  it('reads company_linkedin from `value`, not from `url`', () => {
    // ⚠️ This field alone uses the generic `value` key. Assuming the others do
    // too — or that this one does not — is a one-word mistake that shows up as
    // a missing row rather than an error.
    const item = formatEvidenceItem(
      row('company_linkedin', { value: 'https://www.linkedin.com/company/fabricated' }),
    )
    expect(item?.links?.[0]?.url).toBe('https://www.linkedin.com/company/fabricated')
  })

  it('reads a revenue estimate as a RANGE, not a single number', () => {
    const item = formatEvidenceItem(
      row('revenue_estimate', { min: 25000000, max: 50000000, currency: 'USD' }),
    )
    // Collapsing a range to one figure would state more precision than the
    // provider gave us.
    expect(item?.text).toContain('–')
    expect(item?.text).toContain('$25,000,000')
    expect(item?.text).toContain('$50,000,000')
  })

  it('reads hiring_signals as a count when there is one', () => {
    expect(formatEvidenceItem(row('hiring_signals', { hiring: true, openRoles: 11 }))?.text).toBe(
      '11 open roles',
    )
    expect(formatEvidenceItem(row('hiring_signals', { hiring: true, openRoles: 1 }))?.text).toBe(
      '1 open role',
    )
  })
})

describe('the scanner itself', () => {
  it('every field the query asks for is one the formatter can read', () => {
    /*
     * ⚠️ THE NON-VACUITY CHECK FOR THIS MODULE. `companyDetails` queries
     * `Object.keys(GROUPS)`. If a field were listed there and unhandled by
     * `formatEvidenceItem`, it would be fetched over the network, dropped on the
     * floor, and never appear — with a GROUPS entry claiming otherwise.
     */
    const unreadable = Object.keys(GROUPS).filter(
      (field) => formatEvidenceItem(row(field, sampleFor(field))) === null,
    )
    expect(
      unreadable,
      `GROUPS lists ${unreadable.join(', ')}, which formatEvidenceItem returns null for. ` +
        `Those rows are queried and silently discarded.`,
    ).toEqual([])
  })

  it('and the formatter refuses a field nobody asked for', () => {
    // The other direction: a `default` that returned something would render
    // fields the query never fetches, in a shape nobody checked.
    expect(formatEvidenceItem(row('some_future_field', { value: 'x' }))).toBeNull()
  })
})

/** A minimal well-formed `value_json` per field, for the coverage check above. */
function sampleFor(field: string): Record<string, unknown> {
  switch (field) {
    case 'funding_round':
      return { round: 'Seed' }
    case 'funding_amount':
      return { amount: 500000, currency: 'USD' }
    case 'funding_date':
      return { raisedAt: '2025-10-09T00:00:00' }
    case 'funding_recency':
      return { raisedAt: '2026-07-04', monthsAgo: 1, window: 'last_3_months' }
    case 'revenue_estimate':
      return { min: 1, max: 2, currency: 'USD' }
    case 'tech_stack':
      return { detected: [{ name: 'Cloudflare' }] }
    case 'recent_news':
      return { articles: [{ url: 'https://example.com/a', title: 'A' }] }
    case 'social_profiles':
      return { profiles: ['https://example.com/x'] }
    case 'company_linkedin':
      return { value: 'https://www.linkedin.com/company/x' }
    case 'hiring_signals':
      return { hiring: true, openRoles: 2 }
    case 'company_description':
      return { description: 'A company.' }
    case 'company_contact_email':
      return { email: 'hello@example.com' }
    case 'company_contact_phone':
      return { phone: '18005550100' }
    default:
      // ⚠️ NOT an empty object. A new GROUPS entry with no sample here must FAIL
      // the coverage test rather than pass it by accident.
      return { __no_sample_defined__: true }
  }
}

describe('a shape that has changed underneath us', () => {
  it('disappears rather than rendering a labelled blank', () => {
    /*
     * ⚠️ "Tech stack: " WITH NOTHING AFTER IT IS A STRONGER CLAIM THAN SILENCE.
     * It reads as "we looked and found nothing", when the truth is "we can no
     * longer read what we found". Rule 4 is about not asserting things we
     * cannot support, and that includes assertions of absence.
     */
    expect(formatEvidenceItem(row('tech_stack', { detected: [] }))).toBeNull()
    expect(formatEvidenceItem(row('tech_stack', { vendors: ['Cloudflare'] }))).toBeNull()
    expect(formatEvidenceItem(row('funding_round', { name: 'Seed' }))).toBeNull()
    expect(formatEvidenceItem(row('recent_news', { articles: [] }))).toBeNull()
    expect(formatEvidenceItem(row('company_description', { description: '   ' }))).toBeNull()
  })
})

describe('nothing is invented to make a value look complete', () => {
  it('does not default a missing currency to dollars', () => {
    /*
     * ⚠️ THE SHARPEST RULE-4 EDGE IN THIS FILE. Production holds 7
     * `funding_amount` rows and 7 `funding_currency` rows — and they are
     * SEPARATE observations. Rendering a bare 500000 as "$500,000" invents a
     * currency, and it is invisibly wrong: a €500k round shown as $500k looks
     * completely normal and is off by a fifth.
     */
    const item = formatEvidenceItem(row('funding_amount', { amount: 500000 }))
    expect(item?.text).toBe('500,000')
    expect(item?.text).not.toContain('$')
  })

  it('keeps an unrecognised currency code instead of dropping the amount', () => {
    const item = formatEvidenceItem(row('funding_amount', { amount: 1000, currency: 'ZZZ' }))
    expect(item?.text).toContain('1,000')
    expect(item?.text).toContain('ZZZ')
  })

  it('says when a date is an ANNOUNCEMENT, not a raise', () => {
    // The provider distinguishes them and they can be months apart. Presenting
    // one as the other is a small inaccuracy that matters during diligence.
    const announced = formatEvidenceItem(
      row('funding_date', { raisedAt: '2025-10-09T00:00:00', isAnnouncementDate: true }),
    )
    const raised = formatEvidenceItem(
      row('funding_date', { raisedAt: '2025-10-09T00:00:00', isAnnouncementDate: false }),
    )
    expect(announced?.label).toBe('Announced')
    expect(raised?.label).toBe('Raised on')
  })

  it('drops a date it cannot parse rather than showing "Invalid Date"', () => {
    expect(formatEvidenceItem(row('funding_date', { raisedAt: 'last spring' }))).toBeNull()
  })

  it('recomputes funding recency instead of trusting the stored months', () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ `monthsAgo` IS A DERIVATION FROZEN AT WRITE TIME, AND 205 ROWS IN  ║
     * ║  PRODUCTION CARRY ONE — more than every other funding field combined.  ║
     * ║                                                                        ║
     * ║  This fixture is the real shape of a row written in February 2026:     ║
     * ║  `monthsAgo: 1`, `window: "last_3_months"`. Rendering those verbatim   ║
     * ║  tells a rep the company raised last month. It did not; that was       ║
     * ║  seven months ago, and "recently funded" is the strongest buying       ║
     * ║  signal this product sells.                                            ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    const item = formatEvidenceItem(
      row('funding_recency', {
        window: 'last_3_months',
        raisedAt: '2026-02-12',
        monthsAgo: 1,
        isAnnouncementDate: true,
      }),
    )

    expect(item?.text, 'the stale stored value was shown verbatim').not.toContain('1 month ago')
    // Recomputed from `raisedAt` against the clock, so this stays true as time
    // passes rather than being pinned to a number that was right once.
    const expected = Math.round(
      (Date.now() - new Date('2026-02-12').getTime()) / (1000 * 60 * 60 * 24 * 30.44),
    )
    expect(item?.text).toContain(`${expected} months ago`)
    expect(item?.label).toBe('Funding announced')
  })

  it('does not claim a raise when the provider only saw an announcement', () => {
    expect(
      formatEvidenceItem(row('funding_recency', { raisedAt: '2026-07-04' }))?.label,
    ).toBe('Last raised')
  })
})

describe('URLs that arrived from a crawled page', () => {
  it('drops a javascript: article link and keeps the safe ones', () => {
    /*
     * ⚠️ STORED XSS WITH A FRIENDLY TITLE ON IT. These URLs are whatever a
     * fetched page supplied; this one would execute for every user who opens
     * the company. The safe article must survive — dropping the whole list on
     * one bad entry would hide real news because of one hostile row.
     */
    const item = formatEvidenceItem(
      row('recent_news', {
        articles: [
          { url: 'javascript:alert(document.cookie)', title: 'Click me' },
          { url: 'https://example.com/real', title: 'Real story' },
        ],
      }),
    )
    expect(item?.links).toEqual([{ label: 'Real story', url: 'https://example.com/real' }])
  })

  it('drops a data: social profile', () => {
    const item = formatEvidenceItem(
      row('social_profiles', {
        profiles: ['data:text/html,<script>alert(1)</script>', 'https://x.com/fabricated'],
      }),
    )
    expect(item?.links).toHaveLength(1)
    expect(item?.links?.[0]?.url).toContain('https://x.com/')
  })

  it('falls back to the URL when an article has no title', () => {
    const item = formatEvidenceItem(row('recent_news', { articles: [{ url: 'https://example.com/a' }] }))
    expect(item?.links?.[0]?.label).toBe('https://example.com/a')
  })
})

describe('companyWebsite', () => {
  it('adds the scheme a bare domain is missing', () => {
    /*
     * ⚠️ WITHOUT THIS, href="acme.com" IS A RELATIVE PATH. The browser resolves
     * it against the current page and navigates to /crm/companies/acme.com — a
     * 404 that looks like the product is broken, from a link that looks correct
     * in the markup.
     */
    expect(companyWebsite('acme.com')).toBe('https://acme.com/')
  })

  it('leaves an already-absolute URL alone', () => {
    expect(companyWebsite('https://acme.com/about')).toBe('https://acme.com/about')
  })

  it('refuses anything that is not a plain host', () => {
    expect(companyWebsite('javascript:alert(1)')).toBeNull()
    expect(companyWebsite('not a domain')).toBeNull()
    expect(companyWebsite('acme')).toBeNull()
    expect(companyWebsite('')).toBeNull()
    expect(companyWebsite(null)).toBeNull()
  })
})

describe('linkedInSlug', () => {
  /*
   * ⚠️ DISPLAY ONLY — the href keeps the whole URL. This exists because the
   * company header is a four-column grid and a raw LinkedIn URL wrapped out of
   * its cell and overlapped the Industry column beside it, turning two facts
   * into one unreadable one. Verified in the browser before and after.
   */
  it('takes the slug that identifies the company', () => {
    expect(linkedInSlug('https://www.linkedin.com/company/northwind-robotics')).toBe(
      'northwind-robotics',
    )
    expect(linkedInSlug('https://www.linkedin.com/company/northwind-robotics/')).toBe(
      'northwind-robotics',
    )
  })

  it('returns null when there is no slug, so the caller can label it', () => {
    // An empty string would render a link with no text — a control nobody can
    // see and a keyboard user cannot describe.
    expect(linkedInSlug('https://www.linkedin.com/company/')).toBeNull()
    expect(linkedInSlug('https://www.linkedin.com')).toBeNull()
    expect(linkedInSlug(null)).toBeNull()
  })

  it('goes through the URL validator like every other link on the page', () => {
    expect(linkedInSlug('javascript:alert(1)')).toBeNull()
  })
})
