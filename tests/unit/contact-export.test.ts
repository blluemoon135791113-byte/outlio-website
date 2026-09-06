/**
 * The contact export, and the one rule that must never bend.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE MARKETING FILE MUST NOT CONTAIN A SUPPRESSED ADDRESS.               ║
 * ║                                                                           ║
 * ║  The sending pipeline honours `email_suppressions`. A CSV handed to        ║
 * ║  Mailchimp does not — so an unsubscribe that leaks into an export gets    ║
 * ║  undone, silently, in someone else's system. The customer finds out from  ║
 * ║  a spam complaint and a damaged sending domain days later, with nothing   ║
 * ║  on screen to connect it to a button they pressed.                        ║
 * ║                                                                           ║
 * ║  ⚠️ THE FILTER IS ALSO THE EASIEST THING TO LOSE. It is one `continue` in ║
 * ║  a loop that would still produce a perfectly valid-looking file without   ║
 * ║  it. Nothing else in the suite would notice.                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  MAX_EXPORT_ROWS,
  contactsToCsv,
  isContactExportKind,
  type ContactExportRow,
} from '@/lib/crm/contact-export'

const ROOT = join(__dirname, '..', '..')
const SOURCE = readFileSync(join(ROOT, 'lib', 'crm', 'contact-export.ts'), 'utf8')

function row(over: Partial<ContactExportRow> = {}): ContactExportRow {
  return {
    fullName: 'Ada Lovelace',
    firstName: 'Ada',
    lastName: 'Lovelace',
    jobTitle: 'Analyst',
    companyName: 'Analytical Engines',
    email: 'ada@example.com',
    phone: '+441234567890',
    location: 'London',
    linkedInUrl: 'https://linkedin.com/in/fabricated-1',
    ownerName: 'Owner One',
    source: 'lead_engine',
    createdAt: '2026-08-30T04:06:05.699906+00:00',
    ...over,
  }
}

describe('the kind parameter is an allow-list', () => {
  it('accepts only the two real kinds', () => {
    expect(isContactExportKind('crm')).toBe(true)
    expect(isContactExportKind('marketing')).toBe(true)
  })

  it('rejects anything else', () => {
    // The value comes from a URL. A route that trusted it would pick columns
    // from an undefined branch and export whatever fell out.
    for (const value of ['all', 'CRM', '', null, 'marketing ', '../']) {
      expect(isContactExportKind(value as string | null), String(value)).toBe(false)
    }
  })
})

describe('the marketing file is shaped for a mailing tool', () => {
  it('puts the address in the first column', () => {
    // Mailchimp and Brevo map column one by default.
    const header = contactsToCsv([row()], 'marketing').split('\n')[0]!
    expect(header.replace(/^﻿/, '').split(',')[0]).toBe('Email')
  })

  it('leaves an unknown value truly empty, never "N/A"', () => {
    /*
     * ⚠️ `toCsv` DEFAULTS TO "N/A", WHICH IS RIGHT FOR A HUMAN AND WRONG HERE.
     * An email platform merges the literal text, so the campaign opens with
     * "Hi N/A" — a mistake that reaches the customer's customer.
     */
    const csv = contactsToCsv([row({ firstName: null, companyName: null })], 'marketing')
    expect(csv).not.toContain('N/A')
  })

  it('keeps its header row stable when a column is empty on every row', () => {
    // `toCsv` drops all-empty columns by default. An import mapping built once
    // must keep working against a batch that happens to have no job titles.
    const csv = contactsToCsv([row({ jobTitle: null, companyName: null })], 'marketing')
    const header = csv.split('\n')[0]!
    expect(header).toContain('Job title')
    expect(header).toContain('Company')
  })

  it('carries the full name alongside the split parts', () => {
    /*
     * Splitting a name is a guess — "van der Berg" and "Muhammad Husnain Rafiq"
     * both defeat any rule — so the original must survive for a tool that
     * merges on the wrong field to be repointed.
     */
    const header = contactsToCsv([row()], 'marketing').split('\n')[0]!
    expect(header).toContain('Full name')
    expect(header).toContain('First name')
    expect(header).toContain('Last name')
  })
})

describe('the CRM file is shaped for a person', () => {
  it('reads the source in words, not as an enum', () => {
    const csv = contactsToCsv([row({ source: 'lead_engine' })], 'crm')
    expect(csv).toContain('lead engine')
    expect(csv).not.toContain('lead_engine')
  })

  it('keeps the LinkedIn URL as a plain column', () => {
    /*
     * CLAUDE.md fixes name and URL as SEPARATE columns and forbids
     * `=HYPERLINK()`. The original scraper wrote formulas into cells; that is
     * the exact thing `sanitizeCell` exists to prevent.
     */
    const csv = contactsToCsv([row()], 'crm')
    expect(csv).toContain('LinkedIn URL')
    expect(csv).not.toContain('=HYPERLINK')
  })
})

describe('a hostile value cannot become a formula', () => {
  it('neutralises a name that is an Excel command', () => {
    /*
     * The fixture CLAUDE.md requires. A lead controls their own LinkedIn
     * headline, so this string is genuinely reachable.
     */
    const csv = contactsToCsv([row({ fullName: `=cmd|'/c calc'!A1` })], 'crm')

    // Present, but not as something a spreadsheet will evaluate: every
    // occurrence is preceded by the apostrophe `sanitizeCell` adds.
    expect(csv).toContain('calc')
    expect(csv).not.toMatch(/(^|,)"?=cmd/m)
  })

  it('neutralises it in the marketing file too', () => {
    // Same data, different column set — the defence is in `sanitizeCell`, so
    // it must hold on both paths without either one remembering to ask.
    const csv = contactsToCsv([row({ firstName: '=1+1' })], 'marketing')
    expect(csv).not.toMatch(/(^|,)"?=1\+1/m)
  })
})

describe('the suppression filter', () => {
  /*
   * These read the source rather than running the query: the filter lives in a
   * database round trip that a unit test cannot reach, and the integration
   * suite needs a live Supabase. A structural assertion is weaker than an
   * executed one and far stronger than nothing — and this is the rule whose
   * silent removal is most costly.
   */
  it('excludes suppressed addresses from the marketing export', () => {
    expect(SOURCE).toContain("if (options.kind === 'marketing')")
    expect(SOURCE).toMatch(/if \(suppressedSet\.has\(email\.toLowerCase\(\)\)\) continue/)
  })

  it('skips contacts with no address rather than exporting a blank row', () => {
    expect(SOURCE).toMatch(/if \(!email\) continue/)
  })

  it('compares lowercased on both sides', () => {
    /*
     * ⚠️ `crm_contact_emails.address` KEEPS THE SOURCE'S CASE while
     * `email_suppressions.email` has a `= lower(email)` check. A
     * case-sensitive comparison would miss `Sam@Example.com` against a
     * suppression on `sam@example.com` and mail someone who unsubscribed.
     */
    expect(SOURCE).toMatch(/s\.email\.toLowerCase\(\)/)
    expect(SOURCE).toMatch(/email\.toLowerCase\(\)/)
  })

  it('fetches the suppression list unconditionally', () => {
    // Fetching it only for `marketing` is how it gets forgotten when a third
    // export kind is added.
    const fetchBlock = SOURCE.slice(SOURCE.indexOf('Promise.all(['), SOURCE.indexOf('])', SOURCE.indexOf('Promise.all([')))
    expect(fetchBlock).toContain("from('email_suppressions')")
    expect(fetchBlock).not.toContain('kind ===')
  })
})

describe('the export is bounded and says so', () => {
  it('caps at the same limit as the report export', () => {
    expect(MAX_EXPORT_ROWS).toBe(5_000)
  })

  it('counts exactly rather than estimating', () => {
    /*
     * ⚠️ THE CONTACTS LIST USES `estimated` AND THIS MUST NOT. There the count
     * drives a page number; here it decides whether the customer gets a
     * complete file or an error, so an estimate 0.2% low hands back a silently
     * truncated export.
     */
    expect(SOURCE).toContain("{ count: 'exact' }")
    expect(SOURCE).not.toContain("count: 'estimated'")
  })

  it('throws rather than silently truncating', () => {
    expect(SOURCE).toContain('ContactExportTooLargeError')
    expect(SOURCE).toMatch(/if \(total > MAX_EXPORT_ROWS\)/)
    // The message names the number, so "filter the list" is actionable.
    expect(SOURCE).toContain('total.toLocaleString()')
  })
})

describe('the route decides access, not the button', () => {
  const ROUTE = readFileSync(
    join(ROOT, 'app', '(product)', 'crm', 'contacts', 'export', 'route.ts'),
    'utf8',
  )

  it('checks the permission server-side', () => {
    // A route handler is reachable by typing a URL (CLAUDE.md rule 8).
    expect(ROUTE).toContain("assertWorkspacePermission('crm.contact.view')")
  })

  it('narrows a setter to their own contacts through the query', () => {
    /*
     * ⚠️ THE SERVICE ROLE BYPASSES RLS. Without this the route would hand a
     * setter the entire workspace's contact list as a file — a much larger
     * leak than the screen they are allowed to read.
     */
    expect(ROUTE).toContain("dataScope(ctx.role) === 'assigned'")
    expect(ROUTE).toContain('ownerUserId: scopedToSelf ? ctx.userId : null')
  })

  it('never caches personal data', () => {
    expect(ROUTE).toContain("'Cache-Control': 'no-store, private'")
  })

  it('returns a typed error, never a stack trace', () => {
    expect(ROUTE).toContain('toClientError')
  })
})
