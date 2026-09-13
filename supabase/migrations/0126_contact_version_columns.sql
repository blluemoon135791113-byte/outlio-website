-- ---------------------------------------------------------------------------
-- 0126 — Correcting which columns invalidate approved outreach content.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  0125's TRIGGER WAS WRONG IN BOTH DIRECTIONS, WHICH IS THE WORST SHAPE    ║
-- ║  FOR THIS PARTICULAR MECHANISM.                                           ║
-- ║                                                                           ║
-- ║  §4.7's version exists to invalidate APPROVED CONTENT: a drafted message   ║
-- ║  was written against a state, and preflight must refuse once that state    ║
-- ║  has moved. So the rule is not "did the row change" but "could the draft   ║
-- ║  now be wrong".                                                           ║
-- ║                                                                           ║
-- ║  MISSING, and these are the ones that matter:                             ║
-- ║                                                                           ║
-- ║    first_name  — `buildLinkedInContext` puts it in the greeting. A contact ║
-- ║                  corrected from "Ada" to "Adaeze" left a pending card      ║
-- ║                  reading "Hi Ada," and NOTHING invalidated it. That is     ║
-- ║                  precisely the failure the version was added to prevent,   ║
-- ║                  and the version did not cover it.                        ║
-- ║    linkedin_url — the profile the operator is told to open. If it changes, ║
-- ║                  the card points at somebody else.                        ║
-- ║    source      — decides the VERIFICATION level of the name. A row moving  ║
-- ║                  from `lead_engine` to `csv_import` demotes a verified     ║
-- ║                  greeting to a recorded one, which §4.9 treats as a        ║
-- ║                  different thing entirely.                                ║
-- ║    last_name, job_title, headline, linkedin_identity_key — same family.   ║
-- ║                                                                           ║
-- ║  PRESENT AND WRONG:                                                       ║
-- ║                                                                           ║
-- ║    owner_user_id — does not appear in any drafted message. The SENDER is   ║
-- ║                  on the enrollment, not the owner, so reassigning a book   ║
-- ║                  does not change who performs the action. Including it     ║
-- ║                  meant a routine bulk reassignment of 200 contacts         ║
-- ║                  silently invalidated every pending card for them, and the ║
-- ║                  operator saw "held: the contact changed" about a contact  ║
-- ║                  that had not changed in any way they could see.          ║
-- ║    timezone    — send timing, not content. Irrelevant to a LinkedIn note.  ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ OVER-INVALIDATING IS NOT THE SAFE SIDE HERE. A version that bumps on
-- everything makes every pending card stale after any edit, operators re-approve
-- constantly, and re-approval becomes the reflex it must never become — at which
-- point a genuinely stale draft gets waved through with the rest.
-- ---------------------------------------------------------------------------

create or replace function public.crm_contact_bump_version()
returns trigger
language plpgsql
as $$
begin
  /*
   * ⚠️ THE TEST IS "COULD THE APPROVED DRAFT NOW BE WRONG", not "did the row
   * change". `updated_at` moving on its own must not bump, or every touch
   * invalidates every pending task and the mechanism becomes noise.
   */
  if new.deleted_at             is distinct from old.deleted_at
     -- Named in the greeting, and in `name_suffix`.
     or new.first_name          is distinct from old.first_name
     or new.last_name           is distinct from old.last_name
     or new.full_name           is distinct from old.full_name
     -- Read into the render context; a stale role reads as a stale observation.
     or new.job_title           is distinct from old.job_title
     or new.headline            is distinct from old.headline
     -- The reference the operator is told to open (§4.13).
     or new.linkedin_url        is distinct from old.linkedin_url
     or new.linkedin_identity_key is distinct from old.linkedin_identity_key
     -- Company context in the drafted sentence.
     or new.primary_company_id  is distinct from old.primary_company_id
     /*
      * ⚠️ `source` CHANGES THE VERIFICATION, NOT THE VALUE. `lead_engine` is
      * VERIFIED because the row was parsed from a page the customer opened in
      * LinkedIn; anything else is USER_RECORDED. A demotion can make a greeting
      * that was allowed no longer allowed, with the text unchanged.
      */
     or new.source              is distinct from old.source
  then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

comment on function public.crm_contact_bump_version() is
  'Bumps crm_contacts.version when a change could invalidate approved outreach '
  'content. NOT on owner or timezone: neither appears in a draft, and '
  'over-invalidating trains operators to re-approve without reading (0126).';
