/**
 * Contacts found by automatic enrichment reach the CSV.
 *
 * Regression (job a6c2e8a3, 2026-10-29): `work_email` merges in under the
 * header "Work Email", which is also a core column fed by the lead row's own
 * `work_email` — never written by enrichment. The empty core value overwrote
 * the found one, so a found email and mobile were exported as blanks.
 * Fabricated values only.
 */
import { describe, expect, it } from 'vitest'

import { normalizeExportLead, toCanonicalExportRecord } from '@/lib/export/leads'

const base = {
  id: '4d318a4c-63f2-43e3-ac00-9579442af6a8',
  full_name: 'Jamie Rivera',
  linkedin_url: null,
  sales_navigator_url: 'https://www.linkedin.com/sales/lead/fabricated-1',
  job_title: 'Founder',
  company_name: 'Fabricated Labs',
  company_url: null,
  company_website_url: null,
  location: 'Leeds',
} as const

// The shapes stored on production leads (values fabricated).
const enrichment = {
  work_email: { value: { email: 'jamie@fabricated.example' }, provider: 'scout', sourceUrl: 'https://fabricated.example/team' },
  mobile_phone: {
    value: {
      phone: '+14155550132',
      sourceTitle: 'Team — Fabricated Labs',
      supportingSources: [{ url: 'https://fabricated.example/team', title: 'Team' }],
      identityConfidence: 0.82,
    },
  },
  company_contact_email: { value: { email: 'hello@fabricated.example', status: 'publicly_found' } },
  email_status: { value: { status: 'publicly_found', verificationMethod: 'none' } },
}

describe('enriched person contacts in the export', () => {
  it('exports a found work email and mobile when the lead row has none', () => {
    const record = toCanonicalExportRecord(
      normalizeExportLead({ ...base, enrichment, work_email: null, mobile_phone: null } as never),
    )
    expect(record['Work Email']).toBe('jamie@fabricated.example')
    expect(record['Mobile Phone']).toBe('+14155550132')
    expect(record['Company Contact Email']).toBe('hello@fabricated.example')
    expect(record['Email Status']).toBe('publicly_found')
  })

  it('keeps the value on the lead row when it has one', () => {
    const record = toCanonicalExportRecord(
      normalizeExportLead({ ...base, enrichment, work_email: 'captured@fabricated.example', mobile_phone: null } as never),
    )
    expect(record['Work Email']).toBe('captured@fabricated.example')
    expect(record['Mobile Phone']).toBe('+14155550132')
  })
})
