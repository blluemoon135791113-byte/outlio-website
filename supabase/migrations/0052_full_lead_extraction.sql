/*
 * Everything a saved page actually carries, plus enriched contact details.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  MEASURED, NOT GUESSED.                                                  ║
 * ║                                                                          ║
 * ║  These columns come from an attribute census of a real saved page. Each  ║
 * ║  one was seen rendered; nothing here is aspirational.                    ║
 * ║                                                                          ║
 * ║  ⚠️ EMAIL AND PHONE ARE NOT ON THE PAGE. A Sales Navigator results page  ║
 * ║  contains ZERO email addresses and ZERO `tel:` links — verified. Those    ║
 * ║  two columns are filled by the enrichment providers, never by the        ║
 * ║  parser, and `contact_enriched_at` records when that happened so an      ║
 * ║  empty email can be told apart from one nobody has looked for yet.       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

alter table public.extracted_leads
  -- ---- from the row itself -------------------------------------------------
  /** "1st" / "2nd" / "3rd". Degree of separation from the searcher. */
  add column if not exists connection_degree text,
  /** LinkedIn's own "Reachable" badge — open profile or shared connection. */
  add column if not exists is_reachable boolean,
  /** How many of the user's saved lists this lead already sits in. */
  add column if not exists list_count integer check (list_count is null or list_count >= 0),
  /** Free text: "No activity", "Posted 2d ago", … Kept verbatim. */
  add column if not exists last_activity text,
  /** The date the lead entered the list, as the page displayed it. */
  add column if not exists added_to_list_at date,

  -- ---- from the company hovercard -----------------------------------------
  /** e.g. "Software Development". */
  add column if not exists company_industry text,
  /**
   * A RANGE as LinkedIn renders it — "2-10 employees" — not a number.
   * Storing 2 or 10 would invent a precision the page does not have.
   */
  add column if not exists company_size text,
  add column if not exists company_headquarters text,

  -- ---- enrichment, never the parser ---------------------------------------
  add column if not exists work_email text,
  add column if not exists email_status text,
  add column if not exists mobile_phone text,
  add column if not exists phone_status text,
  /**
   * When contact lookup last ran for this lead.
   *
   * ⚠️ THIS IS WHAT MAKES AN EMPTY EMAIL READABLE. NULL means nobody has
   * looked; a timestamp with no email means we looked and there is none to
   * find. Without it the two are indistinguishable and the lead gets paid for
   * again on every run.
   */
  add column if not exists contact_enriched_at timestamptz;

comment on column public.extracted_leads.company_size is
  'Headcount RANGE exactly as LinkedIn rendered it, e.g. "2-10 employees". '
  'Never parsed into a number — the page does not carry that precision.';

comment on column public.extracted_leads.contact_enriched_at is
  'When contact enrichment last ran. NULL means never looked; a timestamp '
  'with an empty work_email means looked and found nothing.';

/*
 * Finding the leads that still need contact lookup.
 *
 * Partial: once a lead is enriched it never matches again, so the index stays
 * proportional to the work outstanding rather than to the table.
 */
create index if not exists extracted_leads_needs_contact_idx
  on public.extracted_leads (user_id, created_at)
  where contact_enriched_at is null;
