-- 0114 — attach citations to values bridged before 0113 existed
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠️ RE-RUNNING THE BRIDGE DOES NOT FIX THESE. `attachContactEmails`       ║
-- ║  SKIPS AN ADDRESS THAT ALREADY EXISTS, so citations attach only to        ║
-- ║  values bridged from now on. Without this migration the existing rows     ║
-- ║  stay `unknown` forever.                                                  ║
-- ║                                                                           ║
-- ║  MEASURED ON PRODUCTION, 2026-09-05, BEFORE WRITING THIS:                 ║
-- ║                                                                           ║
-- ║      uncited emails                       64                              ║
-- ║        exactly one matching evidence row   8                              ║
-- ║        more than one match                 4                              ║
-- ║        no matching evidence                0                              ║
-- ║        contact has no source lead at all  52                              ║
-- ║                                                                           ║
-- ║  The 52 are ALREADY CORRECT and this migration must not touch them: no    ║
-- ║  `source_lead_id` means the contact never came from research, so          ║
-- ║  "entered" or "unknown" is the true answer, not a missing citation.       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ WHY THE "AMBIGUOUS" FOUR ARE SAFE, having argued they were not.
--
-- PHASE_3.md rejected re-deriving a contact's citation because a value match
-- "returns the wrong row when a value was observed twice". That objection is
-- about matching a value ACROSS THE CORPUS. Here the match is constrained to a
-- single `source_lead_id`, so the four multi-match rows are several evidence
-- rows that observed THE SAME ADDRESS FOR THE SAME LEAD. Every one of them is a
-- true citation; there is no wrong answer to choose.
--
-- The newest is taken, matching the bridge's own "newest first" rule.

do $$
declare
  cited    integer := 0;
  skipped  integer := 0;
begin
  with candidate as (
    select
      e.id as email_id,
      -- ⚠️ `distinct on` + `order by` picks the NEWEST observation per email.
      -- Without it a row with several true citations would produce several
      -- update rows and the result would depend on plan order.
      first_value(ev.id) over (
        partition by e.id
        order by ev.retrieved_at desc, ev.id
      ) as evidence_id
    from public.crm_contact_emails e
    join public.crm_contacts c
      on c.id = e.contact_id
     and c.workspace_id = e.workspace_id          -- same tenant, stated not assumed
    join public.extracted_leads l
      on l.id = c.source_lead_id
    join public.research_evidence ev
      on ev.entity_id = c.source_lead_id
     and ev.entity_type = 'person'
     and ev.field = 'work_email'
      -- ⚠️ THE VALUE MUST MATCH. A citation that explains a different address
      -- is a fabrication about provenance, which rule 4 treats no differently
      -- from fabricating the value.
     and lower(trim(ev.value_json ->> 'email')) = lower(trim(e.address))
      /*
       * ⚠️ AND THE EVIDENCE MUST BELONG TO THE SAME USER AS THE LEAD. Both
       * tables are user_id-keyed while crm_contact_emails is workspace_id-keyed;
       * this is the seam Phase 1 named, and without this predicate a lead id
       * colliding across users would attach another person's research.
       */
     and ev.user_id = l.user_id
    where e.evidence_id is null
      and e.deleted_at is null
  )
  update public.crm_contact_emails e
     set evidence_id = candidate.evidence_id
    from candidate
   where e.id = candidate.email_id
     -- Never overwrite a citation that already exists.
     and e.evidence_id is null;

  get diagnostics cited = row_count;

  select count(*) into skipped
    from public.crm_contact_emails
   where evidence_id is null
     and deleted_at is null;

  raise notice '0114: cited % email(s); % still uncited', cited, skipped;
  raise notice '0114: uncited rows are correct when the contact has no source_lead_id';
end $$;

-- The same for phone numbers, which have far fewer rows but the same history.
do $$
declare
  cited integer := 0;
begin
  with candidate as (
    select
      p.id as phone_id,
      first_value(ev.id) over (
        partition by p.id
        order by ev.retrieved_at desc, ev.id
      ) as evidence_id
    from public.crm_contact_phones p
    join public.crm_contacts c
      on c.id = p.contact_id
     and c.workspace_id = p.workspace_id
    join public.extracted_leads l
      on l.id = c.source_lead_id
    join public.research_evidence ev
      on ev.entity_id = c.source_lead_id
     and ev.entity_type = 'person'
     and ev.field in ('phone', 'mobile_phone', 'work_phone')
      -- `raw` is what the source gave us, so it is what the evidence should
      -- match. `e164` is our normalisation and may differ from the observation.
     and trim(ev.value_json ->> 'phone') = trim(p.raw)
     and ev.user_id = l.user_id
    where p.evidence_id is null
      and p.deleted_at is null
  )
  update public.crm_contact_phones p
     set evidence_id = candidate.evidence_id
    from candidate
   where p.id = candidate.phone_id
     and p.evidence_id is null;

  get diagnostics cited = row_count;
  raise notice '0114: cited % phone(s)', cited;
end $$;

-- ---------------------------------------------------------------------------
-- ⚠️ THE MIGRATION PROVES IT DID NO HARM.
--
-- The failure worth catching is not "cited too few" — leaving a row uncited is
-- the safe direction. It is citing a row with evidence that describes a
-- DIFFERENT value, which would look like provenance and be a lie.
-- ---------------------------------------------------------------------------
do $$
declare
  wrong integer;
begin
  select count(*) into wrong
    from public.crm_contact_emails e
    join public.research_evidence ev on ev.id = e.evidence_id
   where lower(trim(ev.value_json ->> 'email')) is distinct from lower(trim(e.address));

  if wrong > 0 then
    raise exception
      '0114 failed: % email(s) now cite evidence for a DIFFERENT address', wrong;
  end if;

  raise notice '0114: every citation matches the value it explains';
end $$;

-- ROLLBACK:
--   update public.crm_contact_emails set evidence_id = null;
--   update public.crm_contact_phones set evidence_id = null;
-- ⚠️ That also clears citations written by the bridge after 0113, which are
-- exact rather than re-derived. Prefer scoping a rollback by `updated_at` to
-- the window this migration ran in.
