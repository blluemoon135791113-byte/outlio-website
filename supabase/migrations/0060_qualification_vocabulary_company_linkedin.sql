/*
 * Add `company_linkedin` to the qualification field allow-list.
 *
 * The CHECK constraint on `qualification_rules.field` IS the compliance
 * boundary (spec §44) and must move in lockstep with `RESEARCH_FIELDS` —
 * `tests/unit/qualification-vocabulary.test.ts` fails when the two drift.
 *
 * `company_linkedin` is the company's PUBLIC LinkedIn page address, stated by
 * the company on its own website. A business attribute; the page is NEVER
 * fetched (rules 1-2) — only recorded.
 *
 * Widening a CHECK cannot invalidate an existing row, so no data migration is
 * required.
 */

alter table public.qualification_rules
  drop constraint if exists qualification_rules_field_check;

alter table public.qualification_rules
  add constraint qualification_rules_field_check check (field in (
    -- company profile
    'company_domain', 'employee_count', 'industry', 'headquarters',
    'company_description', 'company_linkedin', 'specialties', 'business_model',
    'revenue_estimate',
    -- Companies House
    'company_number', 'company_status', 'company_type', 'jurisdiction',
    'incorporation_date', 'sic_codes', 'registered_office',
    'accounts_overdue', 'confirmation_statement_overdue', 'insolvency_history',
    -- GLEIF — global LEI registry (free, no key)
    'lei_number',
    -- SEC EDGAR
    'sec_cik', 'sec_legal_name', 'sec_entity_type', 'sec_sic',
    'sec_sic_description', 'sec_ein', 'sec_lei', 'sec_tickers', 'sec_exchanges',
    'sec_state_of_incorporation', 'sec_business_address', 'sec_website',
    'sec_former_names', 'sec_filing_history',
    -- US federal award spending (USAspending.gov)
    'federal_awards_total', 'federal_awards_count', 'federal_award_types',
    'federal_recipient_name',
    -- derived by Outlio from evidence history
    'employee_growth', 'tech_churn', 'company_age', 'funding_recency',
    -- funding
    'funding_round', 'funding_amount', 'funding_currency', 'funding_date',
    'funding_investors',
    -- activity and presence
    'tech_stack', 'product_launches', 'recent_news', 'hiring_signals',
    'competitors', 'website_signals', 'pricing_signals',
    'review_presence', 'review_rating', 'review_count', 'github_presence',
    -- the company's own accounts
    'social_profiles',
    -- contact and role attributes — professional characteristics only; no
    -- free source answers these today (see 0058's note).
    'person_seniority', 'person_department', 'person_social_profiles',
    'work_email', 'email_status', 'mobile_phone', 'phone_status'
  ));

comment on constraint qualification_rules_field_check on public.qualification_rules is
  'Compliance allow-list of professional and business attributes, kept in sync '
  'with RESEARCH_FIELDS by tests/unit/qualification-vocabulary.test.ts. '
  'Protected personal characteristics cannot be represented here.';
