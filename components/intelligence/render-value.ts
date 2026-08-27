/**
 * Rendering a researched value.
 *
 * Shared by the Hubble result panel, the lead modal and the legacy console, so
 * one value shape cannot render three different ways.
 *
 * ⚠️ NEVER INVENTS PRECISION. Evidence values are provider-shaped objects; this
 * unwraps the ones we understand and falls back to compact JSON rather than
 * printing `[object Object]` or guessing at a field that is not there.
 */

/** Field key → column header. Anything unmapped falls back to the key. */
const COLUMN_LABELS: Record<string, string> = {
  company_domain: 'Website',
  employee_count: 'Employees',
  industry: 'Industry',
  headquarters: 'HQ',
  company_description: 'Description',
  business_model: 'Model',
  revenue_estimate: 'Revenue',
  company_number: 'Company number',
  company_status: 'Legal status',
  company_type: 'Company type',
  jurisdiction: 'Jurisdiction',
  incorporation_date: 'Incorporated',
  sic_codes: 'SIC codes',
  registered_office: 'Registered office',
  accounts_overdue: 'Accounts overdue',
  confirmation_statement_overdue: 'Statement overdue',
  insolvency_history: 'Insolvency history',
  sec_cik: 'SEC CIK',
  lei_number: 'LEI',
  sec_legal_name: 'SEC legal name',
  sec_entity_type: 'SEC entity type',
  sec_sic: 'SEC SIC',
  sec_sic_description: 'SEC industry',
  sec_ein: 'SEC EIN',
  sec_lei: 'SEC LEI',
  sec_tickers: 'Tickers',
  sec_exchanges: 'Exchanges',
  sec_state_of_incorporation: 'Incorporated in',
  sec_business_address: 'SEC business address',
  sec_website: 'SEC website',
  sec_former_names: 'Former names',
  sec_filing_history: 'Recent SEC filings',
  federal_awards_total: 'Federal awards',
  federal_awards_count: 'Federal award count',
  federal_award_types: 'Award types',
  federal_recipient_name: 'Federal recipient',
  employee_growth: 'Headcount trend',
  tech_churn: 'Tech changes',
  company_age: 'Age',
  funding_recency: 'Raised',
  // Two different things, so two different labels. "Socials" alone on both
  // columns would leave nobody able to tell whose account they were looking at.
  social_profiles: 'Company socials',
  company_linkedin: 'Company LinkedIn',
  specialties: 'Specialties',
  person_seniority: 'Seniority',
  person_department: 'Department',
  person_social_profiles: 'Personal socials',
  funding_round: 'Round',
  funding_amount: 'Amount',
  funding_currency: 'Currency',
  funding_date: 'Announced',
  funding_investors: 'Investors',
  tech_stack: 'Technology',
  product_launches: 'Launches',
  recent_news: 'News',
  hiring_signals: 'Hiring',
  competitors: 'Competitors',
  website_signals: 'Website signals',
  pricing_signals: 'Pricing',
  review_presence: 'Reviews',
  review_rating: 'Rating',
  review_count: 'Review count',
  github_presence: 'GitHub',
  work_email: 'Email',
  email_status: 'Email status',
  mobile_phone: 'Phone',
  phone_status: 'Phone status',
}


/** Field key → column header, falling back to a readable form of the key. */
export function columnLabel(field: string): string {
  return COLUMN_LABELS[field] ?? field.replace(/_/g, ' ')
}

/** Renders a researched value compactly without inventing precision. */
export function renderCellValue(value: unknown): string {
  if (value === null || value === undefined) return '—'

  if (typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>

    if (Array.isArray(record.filings)) {
      return record.filings
        .slice(0, 5)
        .map((item) => {
          if (!item || typeof item !== 'object') return String(item)
          const filing = item as Record<string, unknown>
          return [filing.form, filing.filingDate].filter(Boolean).join(' · ')
        })
        .join(', ')
    }
    if ('value' in record) {
      if (Array.isArray(record.value)) return record.value.map(String).join(', ')
      if (typeof record.value === 'boolean') return record.value ? 'Yes' : 'No'
      if (record.value !== null && record.value !== undefined) return String(record.value)
    }
    if (typeof record.count === 'number') return record.count.toLocaleString()
    if (typeof record.domain === 'string') return record.domain
    if (typeof record.url === 'string') return record.url
    if (record.address && typeof record.address === 'object') {
      const address = record.address as Record<string, unknown>
      if (typeof address.formatted === 'string') return address.formatted
    }
    if (Array.isArray(record.names)) {
      return record.names
        .map((item) =>
          item && typeof item === 'object' && 'name' in item
            ? String((item as { name: unknown }).name)
            : String(item),
        )
        .join(', ')
    }
    if (typeof record.industry === 'string') return record.industry
    if (typeof record.headquarters === 'string') return record.headquarters
    if (typeof record.round === 'string') return record.round
    if (typeof record.amount === 'number') {
      const currency = typeof record.currency === 'string' ? record.currency : ''
      return `${currency} ${record.amount.toLocaleString()}`.trim()
    }
    if (Array.isArray(record.detected)) {
      return record.detected
        .map((item) =>
          item && typeof item === 'object' && 'name' in item
            ? String((item as { name: unknown }).name)
            : String(item),
        )
        .join(', ')
    }
    if (record.hiring === true) {
      const roles = Array.isArray(record.roles) ? record.roles : []
      return roles.length > 0 ? `Yes — ${roles.join(', ')}` : 'Yes'
    }
    if (typeof record.articleCount === 'number') {
      return `${record.articleCount} article${record.articleCount === 1 ? '' : 's'}`
    }
    if (Array.isArray(record.investors)) return record.investors.join(', ')
    if (typeof record.announcedAt === 'string') return record.announcedAt.slice(0, 10)

    const first = Object.values(record)[0]
    return first === undefined ? '—' : String(first)
  }

  return String(value)
}
