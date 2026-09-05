/*
 * Which Sales Navigator list or search a lead came from.
 *
 * Present in the saved page's <title> and its DOM — "Tech Leads 4 | Lead Lists
 * | Sales Navigator" — and previously discarded. It is the only per-lead record
 * of provenance once a file has been processed and deleted: without it, leads
 * from three different searches are indistinguishable in one export.
 */

alter table public.extracted_leads
  add column if not exists source_list text;

comment on column public.extracted_leads.source_list is
  'The Sales Navigator list or saved-search name the lead was captured from, '
  'read from the page title. Provenance for an exported row.';
