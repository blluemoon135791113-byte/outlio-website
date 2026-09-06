/*
 * Merging intelligence results back onto the extraction.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WHY A JSONB COLUMN AND NOT SIXTY-THREE COLUMNS.                         ║
 * ║                                                                          ║
 * ║  `RESEARCH_FIELDS` has 63 members and grows most weeks. A column per     ║
 * ║  field would mean a migration per field, and an export contract that     ║
 * ║  had to be widened in five CRM adapters each time.                       ║
 * ║                                                                          ║
 * ║  The eight core export columns are UNTOUCHED and always present, so a    ║
 * ║  CRM field mapping a customer already built keeps working. Merged        ║
 * ║  fields are appended after them.                                         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THIS IS A CACHE OF A DECISION, NOT A SOURCE OF TRUTH.
 *
 * `research_evidence` remains the record of what was found, by whom, and when.
 * This column holds the values a user explicitly chose to merge, so that an
 * export is a single read and does not have to re-resolve evidence, conflicts
 * and TTLs at export time.
 *
 * Each entry carries its own provenance so a stale or wrong value can always be
 * traced back:
 *
 *   {
 *     "work_email": {
 *       "value":      { "email": "sam@acme.com" },
 *       "provider":   "prospeo",
 *       "confidence": 0.9,
 *       "run_id":     "…uuid…",
 *       "merged_at":  "2026-08-16T…Z"
 *     }
 *   }
 */

alter table public.extracted_leads
  add column if not exists enrichment jsonb not null default '{}'::jsonb;

comment on column public.extracted_leads.enrichment is
  'Intelligence values the user merged onto this lead, keyed by research '
  'field, each with its own provenance. A cache of a decision — '
  'research_evidence remains the record of what was found.';

/*
 * A partial index, because most leads are never enriched.
 *
 * Indexing every row would carry the cost of the empty default on an account
 * that has never opened the intelligence console.
 */
create index if not exists extracted_leads_enrichment_idx
  on public.extracted_leads using gin (enrichment)
  where enrichment <> '{}'::jsonb;

/*
 * Merges enrichment onto leads the caller owns.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ `p_user_id` IS NOT OPTIONAL AND IS NOT A HINT.                        ║
 * ║                                                                          ║
 * ║  The worker and the merge action both hold the service role, which       ║
 * ║  bypasses RLS. The WHERE clause below is therefore the ONLY thing        ║
 * ║  standing between one tenant's research run and another tenant's leads.  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * `||` merges shallowly at the top level, which is what is wanted: re-running
 * research replaces a field's whole entry — value AND provenance together —
 * rather than leaving last week's provider name attached to this week's value.
 *
 * Returns the number of rows actually changed, so the caller can report
 * honestly instead of assuming its input was all applied.
 */
create or replace function public.merge_lead_enrichment(
  p_user_id    uuid,
  p_lead_ids   uuid[],
  p_enrichment jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_user_id is null then
    raise exception 'merge_lead_enrichment requires a user id';
  end if;

  if p_lead_ids is null or array_length(p_lead_ids, 1) is null then
    return 0;
  end if;

  update public.extracted_leads as leads
     -- `updated_at` is left to the existing extracted_leads_set_updated_at
     -- trigger; setting it here too would be a second source of the same fact.
     set enrichment = leads.enrichment || coalesce(
           p_enrichment -> leads.id::text,
           '{}'::jsonb
         )
   where leads.user_id = p_user_id
     and leads.id = any(p_lead_ids)
     -- Skip rows with nothing to merge, so `updated_at` is not churned and the
     -- returned count means "rows that actually changed".
     and p_enrichment ? leads.id::text;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.merge_lead_enrichment(uuid, uuid[], jsonb)
  from public, anon, authenticated;
grant execute on function public.merge_lead_enrichment(uuid, uuid[], jsonb)
  to service_role;

comment on function public.merge_lead_enrichment(uuid, uuid[], jsonb) is
  'Merges per-lead enrichment objects onto extracted_leads. Scoped by '
  'user_id in the WHERE clause because the service role bypasses RLS.';
