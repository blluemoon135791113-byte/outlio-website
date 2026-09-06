-- Phase 3 extension — official UK Companies House fields.
--
-- The evidence table is intentionally field-agnostic. This migration only
-- widens the qualification compliance allow-list so users may build ICP rules
-- from the new professional/business attributes.

alter table public.qualification_rules
  drop constraint if exists qualification_rules_field_check;

alter table public.qualification_rules
  add constraint qualification_rules_field_check check (field in (
    'company_domain', 'employee_count', 'industry', 'headquarters',
    'company_description', 'business_model', 'revenue_estimate',
    'company_number', 'company_status', 'company_type', 'jurisdiction',
    'incorporation_date', 'sic_codes', 'registered_office',
    'accounts_overdue', 'confirmation_statement_overdue', 'insolvency_history',
    'funding_round', 'funding_amount', 'funding_currency', 'funding_date',
    'funding_investors', 'tech_stack', 'product_launches', 'recent_news',
    'hiring_signals', 'competitors', 'website_signals', 'pricing_signals',
    'review_presence', 'review_rating', 'review_count', 'github_presence',
    'work_email', 'email_status', 'mobile_phone', 'phone_status'
  ));

comment on constraint qualification_rules_field_check on public.qualification_rules is
  'Compliance allow-list of professional and business attributes. Protected '
  'personal characteristics cannot be represented here.';
