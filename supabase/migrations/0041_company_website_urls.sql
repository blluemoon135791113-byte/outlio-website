-- Keep LinkedIn's company page separate from the company's external website.
alter table public.extracted_leads
  add column if not exists company_website_url text;

comment on column public.extracted_leads.company_url is
  'LinkedIn Sales Navigator company-page URL captured from the lead row.';
comment on column public.extracted_leads.company_website_url is
  'External company website URL, only when exposed by the source page UI.';
