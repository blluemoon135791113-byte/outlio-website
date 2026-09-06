/*
 * Re-sync the qualification field allow-list with the research vocabulary.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS IS A REPAIR, NOT ONLY AN ADDITION.                                 ║
 * ║                                                                          ║
 * ║  `qualification_rules.field` is CHECK-constrained to the research         ║
 * ║  vocabulary — that constraint is the compliance boundary of spec §44,     ║
 * ║  making a rule on a protected characteristic impossible by schema rather  ║
 * ║  than merely discouraged.                                                ║
 * ║                                                                          ║
 * ║  But the constraint and `RESEARCH_FIELDS` are two lists maintained by     ║
 * ║  hand, and they had DRIFTED. Eleven fields shipped in TypeScript without  ║
 * ║  reaching the constraint: four USAspending fields, four derived trend     ║
 * ║  fields, and three harvested contact fields.                              ║
 * ║                                                                          ║
 * ║  The drift was invisible and pointed the wrong way. `ProfileManager.tsx`  ║
 * ║  offers every research field in its dropdown and `lib/qualification/      ║
 * ║  actions.ts` validates with `z.enum(RESEARCH_FIELDS)`, so choosing one of ║
 * ║  the eleven passed validation and then failed on a Postgres constraint    ║
 * ║  violation the user could do nothing about.                              ║
 * ║                                                                          ║
 * ║  `tests/unit/qualification-vocabulary.test.ts` now fails when the two     ║
 * ║  lists disagree, so the next field addition cannot repeat this.           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Widening a CHECK constraint cannot invalidate an existing row, so no data
 * migration is required. Every field below remains a business attribute.
 */

alter table public.qualification_rules
  drop constraint if exists qualification_rules_field_check;

alter table public.qualification_rules
  add constraint qualification_rules_field_check check (field in (
    -- company profile
    'company_domain', 'employee_count', 'industry', 'headquarters',
    'company_description', 'business_model', 'revenue_estimate',
    -- Companies House
    'company_number', 'company_status', 'company_type', 'jurisdiction',
    'incorporation_date', 'sic_codes', 'registered_office',
    'accounts_overdue', 'confirmation_statement_overdue', 'insolvency_history',
    -- SEC EDGAR
    'sec_cik', 'sec_legal_name', 'sec_entity_type', 'sec_sic',
    'sec_sic_description', 'sec_ein', 'sec_lei', 'sec_tickers', 'sec_exchanges',
    'sec_state_of_incorporation', 'sec_business_address', 'sec_website',
    'sec_former_names', 'sec_filing_history',
    -- US federal award spending (USAspending.gov) — missing until now
    'federal_awards_total', 'federal_awards_count', 'federal_award_types',
    'federal_recipient_name',
    -- derived by Outlio from evidence history — missing until now
    'employee_growth', 'tech_churn', 'company_age', 'funding_recency',
    -- funding
    'funding_round', 'funding_amount', 'funding_currency', 'funding_date',
    'funding_investors',
    -- activity and presence
    'tech_stack', 'product_launches', 'recent_news', 'hiring_signals',
    'competitors', 'website_signals', 'pricing_signals',
    'review_presence', 'review_rating', 'review_count', 'github_presence',
    -- the company's own accounts — missing until now
    'social_profiles',
    /*
     * Contact and role attributes.
     *
     * Seniority and department are PROFESSIONAL attributes — a person's rank and
     * function within a business. They carry no protected characteristic, and
     * spec §19 scores seniority as an ICP criterion.
     *
     * `person_social_profiles` is the individual's own published business
     * profiles, kept distinct from the company's `social_profiles` above.
     */
    'person_seniority', 'person_department', 'person_social_profiles',
    'work_email', 'email_status', 'mobile_phone', 'phone_status'
  ));

comment on constraint qualification_rules_field_check on public.qualification_rules is
  'Compliance allow-list of professional and business attributes, kept in sync '
  'with RESEARCH_FIELDS by tests/unit/qualification-vocabulary.test.ts. '
  'Protected personal characteristics cannot be represented here.';
