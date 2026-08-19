/*
 * What a Sales Navigator COMPANY page carries, and the people found on it.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ NOTHING NAVIGATES TO THESE PAGES, AND NOTHING EVER WILL.             ║
 * ║                                                                          ║
 * ║  CLAUDE.md rule 1 forbids automated navigation. These columns are filled ║
 * ║  only when the USER opens a company page during a session they started,  ║
 * ║  and the extension reads what LinkedIn rendered. A company nobody has    ║
 * ║  visited keeps NULLs, which the export writes as N/A.                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

alter table public.extracted_leads
  /** `linkedin.com/company/<slug>` — the public page, not the Sales Nav one. */
  add column if not exists company_public_linkedin_url text,
  /**
   * An EXACT headcount from the company page.
   *
   * Deliberately separate from `company_size`, which is the hover card's range
   * ("2-10 employees"). Collapsing them would lose the distinction between a
   * number LinkedIn stated and a bracket it estimated.
   */
  add column if not exists company_employee_count integer
    check (company_employee_count is null or company_employee_count >= 0),
  add column if not exists company_decision_maker_count integer
    check (company_decision_maker_count is null or company_decision_maker_count >= 0),
  add column if not exists company_investor_count integer
    check (company_investor_count is null or company_investor_count >= 0),
  /**
   * How this row entered the database.
   *
   * ⚠️ WITHOUT THIS, A DECISION MAKER FOUND ON A COMPANY PAGE IS
   * INDISTINGUISHABLE FROM A LEAD THE USER SEARCHED FOR. They are different
   * things: one was asked for, the other was discovered alongside it, and a
   * user exporting a list needs to be able to tell which is which.
   */
  add column if not exists lead_source text
    check (lead_source is null or lead_source in ('search', 'decision_maker', 'investor'));

comment on column public.extracted_leads.company_employee_count is
  'Exact headcount from the company page. company_size holds the hover '
  'card RANGE instead — the two are not interchangeable.';

comment on column public.extracted_leads.lead_source is
  'search = a row the user searched for. decision_maker / investor = a person '
  'discovered on a company page the user opened.';

alter table public.companies
  add column if not exists public_linkedin_url text,
  add column if not exists employee_count_exact integer
    check (employee_count_exact is null or employee_count_exact >= 0),
  add column if not exists decision_maker_count integer
    check (decision_maker_count is null or decision_maker_count >= 0),
  add column if not exists investor_count integer
    check (investor_count is null or investor_count >= 0),
  /** When a user last opened this company's page. NULL means never. */
  add column if not exists page_observed_at timestamptz;

create index if not exists extracted_leads_lead_source_idx
  on public.extracted_leads (user_id, lead_source)
  where lead_source is not null and lead_source <> 'search';
