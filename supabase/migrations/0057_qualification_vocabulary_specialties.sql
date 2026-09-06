/*
 * Add `specialties` to the qualification field allow-list.
 *
 * The CHECK constraint on `qualification_rules.field` IS the compliance
 * boundary (spec §44): a rule on a protected characteristic is impossible by
 * schema, not merely discouraged. That makes the constraint and
 * `RESEARCH_FIELDS` two hand-maintained lists that must move together —
 * `tests/unit/qualification-vocabulary.test.ts` fails when they drift.
 *
 * `specialties` is what a company lists about itself (its own focus areas and
 * offerings) — a business attribute with nothing personal in it.
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
    'company_description', 'specialties', 'business_model', 'revenue_estimate',
    -- Companies House
    'company_number', 'company_status', 'company_type', 'jurisdiction',
    'incorporation_date', 'sic_codes', 'registered_office',
    'accounts_overdue', 'confirmation_statement_overdue', 'insolvency_history',
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
    /*
     * Contact and role attributes — professional characteristics only.
     * See 0050 for why these are allowed at all.
     */
    'person_seniority', 'person_department', 'person_social_profiles',
    'work_email', 'email_status', 'mobile_phone', 'phone_status'
  ));

comment on constraint qualification_rules_field_check on public.qualification_rules is
  'Compliance allow-list of professional and business attributes, kept in sync '
  'with RESEARCH_FIELDS by tests/unit/qualification-vocabulary.test.ts. '
  'Protected personal characteristics cannot be represented here.';
