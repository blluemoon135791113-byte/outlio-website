-- ---------------------------------------------------------------------------
-- 0143 — clear the public profile URLs that were never real
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  WHAT THIS REMOVES, AND WHY IT IS NOT DATA LOSS.                          ║
-- ║                                                                           ║
-- ║  Until #46, `publicProfileUrl` built `linkedin.com/in/{urn}` whenever a    ║
-- ║  Sales Navigator row carried no public anchor — which is almost every row. ║
-- ║  The urn came from `urn:li:fs_salesProfile:(ACwAA…)`: a SALES PROFILE      ║
-- ║  entity, not the MEMBER urn (`ACoAAA…`) that `/in/` resolves. Every URL    ║
-- ║  built that way addresses nothing.                                        ║
-- ║                                                                           ║
-- ║  The parser stopped minting them. It cannot retract the ones already       ║
-- ║  written, so every contact created before that fix still shows a profile   ║
-- ║  link that fails on click. This is the retraction.                        ║
-- ║                                                                           ║
-- ║  ⚠️ NOTHING IS LOST. The identifier survives in `sales_navigator_url` on   ║
-- ║  the same row, in the path it actually belongs to, and the contact screen  ║
-- ║  already renders it — it buckets links by WHAT THE URL IS rather than by   ║
-- ║  which column holds it. After this runs, those contacts show one working   ║
-- ║  Sales Navigator link instead of one working link and one dead one.       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ RUN THE COUNTS IN STEP 1 FIRST, ON THEIR OWN. They are the blast radius.
-- If the numbers are not what you expect, stop: this UPDATE is not reversible
-- without a restore, because the value it clears cannot be recomputed.
--
-- Validate against a throwaway Postgres before running here:
--   scripts/check-migration.sh supabase/migrations/0143_clear_fabricated_profile_urls.sql
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- STEP 1 — COUNT FIRST. Run this alone and read it before going further.
-- ---------------------------------------------------------------------------
--
--   select 'extracted_leads' as table_name, count(*) as fabricated
--     from public.extracted_leads
--    where linkedin_url ~ '^https://www\.linkedin\.com/in/ACw[A-Za-z0-9_-]{17,}/?$'
--   union all
--   select 'crm_contacts', count(*)
--     from public.crm_contacts
--    where linkedin_url ~ '^https://www\.linkedin\.com/in/ACw[A-Za-z0-9_-]{17,}/?$';
--
-- And confirm nothing real is caught — this must return 0 rows:
--
--   select linkedin_url
--     from public.crm_contacts
--    where linkedin_url ~ '^https://www\.linkedin\.com/in/ACw[A-Za-z0-9_-]{17,}/?$'
--      and linkedin_url !~ '^https://www\.linkedin\.com/in/ACw[A-Za-z0-9+/=_-]+/?$'
--    limit 20;

begin;

-- ---------------------------------------------------------------------------
-- STEP 2 — the retraction.
--
-- ⚠️ THE PATTERN IS DELIBERATELY NARROW, AND EVERY PART OF IT EARNS ITS PLACE:
--
--   `^https://www\.linkedin\.com/in/`  the exact shape the parser emitted, so a
--                                      hand-entered or imported URL in another
--                                      form is never touched
--   `ACw`                              the SALES PROFILE prefix only. `ACo` is a
--                                      MEMBER urn and DOES resolve at /in/ — the
--                                      browser extension captures real ones, and
--                                      clearing those would destroy working links
--   `[A-Za-z0-9_-]{17,}`               urn length. A real vanity slug is lowercase
--                                      and hyphenated; a 20+ character mixed-case
--                                      string beginning ACw is not a person's
--                                      chosen handle
--   `/?$`                              anchored at both ends, so a longer URL that
--                                      merely contains this substring is excluded
--
-- ⚠️ `sales_navigator_url` IS NOT TOUCHED ANYWHERE IN THIS FILE. It holds the
-- real, working address and is the entire reason this is safe.
-- ---------------------------------------------------------------------------

update public.extracted_leads
   set linkedin_url = null
 where linkedin_url ~ '^https://www\.linkedin\.com/in/ACw[A-Za-z0-9_-]{17,}/?$';

-- ⚠️ `crm_contacts.linkedin_url` LEGITIMATELY HOLDS `/sales/lead/…` ADDRESSES
-- on many rows: `lib/crm/ingest.ts` coalesces the two for identity matching, so
-- a Navigator save lands its address here when no public one exists. The
-- `/in/ACw` anchor above is what keeps those untouched.
update public.crm_contacts
   set linkedin_url = null
 where linkedin_url ~ '^https://www\.linkedin\.com/in/ACw[A-Za-z0-9_-]{17,}/?$';

-- ---------------------------------------------------------------------------
-- STEP 3 — prove it worked before committing.
--
-- Both counts must be 0. If either is not, `rollback;` instead of `commit;`.
-- ---------------------------------------------------------------------------

do $$
declare
  v_leads    bigint;
  v_contacts bigint;
begin
  select count(*) into v_leads
    from public.extracted_leads
   where linkedin_url ~ '^https://www\.linkedin\.com/in/ACw[A-Za-z0-9_-]{17,}/?$';

  select count(*) into v_contacts
    from public.crm_contacts
   where linkedin_url ~ '^https://www\.linkedin\.com/in/ACw[A-Za-z0-9_-]{17,}/?$';

  if v_leads <> 0 or v_contacts <> 0 then
    -- ⚠️ RAISES RATHER THAN WARNS, so the transaction aborts instead of
    -- committing a half-done retraction that nobody notices.
    raise exception
      'fabricated URLs remain after the update: % in extracted_leads, % in crm_contacts',
      v_leads, v_contacts;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- AFTERWARDS
--
-- Contacts whose only address was the fabricated one now have `linkedin_url`
-- NULL and `sales_navigator_url` set. The contact screen renders the Navigator
-- link and shows the public profile as missing, which is what it is — a missing
-- field, recorded as missing, rather than a link that fails on click.
--
-- ⚠️ THIS DOES NOT BACKFILL ANYTHING. A real public profile URL can only come
-- from a page that actually exposed one; deriving it from the urn is what
-- caused this, and §4.5 forbids converting one identifier into the other.
-- ---------------------------------------------------------------------------
