-- 0113 — a discovered value keeps the citation that justifies it
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  CLAUDE.md RULE 4: a value may be stored only if it was LITERALLY         ║
-- ║  OBSERVED, "and the evidence row naming the provider and URL is kept as   ║
-- ║  its citation".                                                           ║
-- ║                                                                           ║
-- ║  The row is kept. The LINK is not.                                        ║
-- ║                                                                           ║
-- ║    research_evidence   source_provider, source_url, source_confidence,    ║
-- ║                        confidence, retrieved_at, research_run_id          ║
-- ║    crm_contact_emails  address, identity_key, is_primary, source          ║
-- ║                                                                           ║
-- ║  `source` is an ENUM, not a citation. Searching every column in the       ║
-- ║  database for %evidence%, %citation% or %source_url% returns nothing on   ║
-- ║  any crm_* table. So once `syncContactEvidenceToCrm` copies an address    ║
-- ║  into the CRM, the page it came from is unrecoverable.                    ║
-- ║                                                                           ║
-- ║  ⚠️ RE-DERIVING IT WOULD CROSS A TENANCY SEAM. `research_evidence` is     ║
-- ║  keyed by `user_id`; `crm_contact_emails` by `workspace_id`. Matching on  ║
-- ║  value + field + entity across that boundary is fragile, and silently     ║
-- ║  returns the WRONG row when a value was observed twice. DECISION-10       ║
-- ║  chose the foreign key over the guess.                                    ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- ---------------------------------------------------------------------------
-- ⚠️ NULLABLE, AND `ON DELETE SET NULL`.
--
-- NULLABLE because most rows genuinely have no citation: typed by hand,
-- CSV-imported, or bridged before this column existed. Backfilling them with a
-- guessed evidence row would be exactly the fabrication rule 4 forbids — a
-- plausible citation is worse than an absent one, because nobody can tell.
--
-- SET NULL because evidence expires. `research_evidence` carries `expires_at`
-- and is pruned; the ADDRESS remains true after its citation is collected. A
-- CASCADE would delete a contact's email because the page it was found on was
-- tidied up, and RESTRICT would make evidence unprunable.
--
-- ⚠️ SET NULL IS ONLY SAFE BECAUSE NEITHER TABLE IS APPEND-ONLY. Verified:
-- their only trigger is `set_updated_at`. On an append-only table, nulling a
-- foreign key is an UPDATE the guard rejects, which makes the referenced row
-- permanently undeletable — the bug 0091 half-fixed and 0109 finished.
-- ---------------------------------------------------------------------------
alter table public.crm_contact_emails
  add column if not exists evidence_id uuid
    references public.research_evidence(id) on delete set null;

alter table public.crm_contact_phones
  add column if not exists evidence_id uuid
    references public.research_evidence(id) on delete set null;

comment on column public.crm_contact_emails.evidence_id is
  'The research_evidence row this address was observed in, or NULL when it was '
  'entered by hand, imported, or bridged before 0113. NULL means "no citation", '
  'never "citation unknown" — crm_contacts.source distinguishes those.';

comment on column public.crm_contact_phones.evidence_id is
  'See crm_contact_emails.evidence_id (0113).';

-- ---------------------------------------------------------------------------
-- ⚠️ PARTIAL INDEX: only cited rows are worth indexing.
--
-- The lookup is always "give me the citation for this value", never "give me
-- every value with no citation" — and most rows have none, so a full index
-- would be mostly NULLs nobody queries.
-- ---------------------------------------------------------------------------
create index if not exists crm_contact_emails_evidence_idx
  on public.crm_contact_emails (evidence_id)
  where evidence_id is not null;

create index if not exists crm_contact_phones_evidence_idx
  on public.crm_contact_phones (evidence_id)
  where evidence_id is not null;

-- ---------------------------------------------------------------------------
-- ⚠️ THE MIGRATION PROVES ITSELF.
--
-- `add column if not exists` succeeds silently when the column is already
-- there, including when it is there with the WRONG type or no foreign key —
-- which would leave citations pointing nowhere while every check passed.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
begin
  select string_agg(t.name, ', ')
    into missing
    from (values ('crm_contact_emails'), ('crm_contact_phones')) as t(name)
   where not exists (
     select 1
       from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = t.name
        and c.column_name = 'evidence_id'
        and c.data_type = 'uuid'
   );

  if missing is not null then
    raise exception '0113 failed: evidence_id missing or not uuid on %', missing;
  end if;

  -- And it must actually reference research_evidence, not merely exist.
  select string_agg(t.name, ', ')
    into missing
    from (values ('crm_contact_emails'), ('crm_contact_phones')) as t(name)
   where not exists (
     select 1
       from pg_constraint con
       join pg_class rel on rel.oid = con.conrelid
       join pg_class ref on ref.oid = con.confrelid
      where con.contype = 'f'
        and rel.relname = t.name
        and ref.relname = 'research_evidence'
   );

  if missing is not null then
    raise exception
      '0113 failed: evidence_id on % does not reference research_evidence', missing;
  end if;

  raise notice '0113: contact values can now carry their citation';
end $$;

-- ROLLBACK:
--   alter table public.crm_contact_emails drop column if exists evidence_id;
--   alter table public.crm_contact_phones drop column if exists evidence_id;
-- Additive and lossy only of the citations recorded since it was applied; the
-- underlying research_evidence rows are untouched.
