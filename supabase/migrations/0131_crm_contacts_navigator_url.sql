-- ---------------------------------------------------------------------------
-- 0131 — A contact has two LinkedIn addresses, and Outlio was keeping one.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  Owner, 2026-09-15: "right now outlio on crm is giving linkedin Sales     ║
-- ║  navigator profile url i need navigator url there as well and linkedin    ║
-- ║  profile url as well".                                                    ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ THE CAUSE IS ONE LINE, AND IT IS A COALESCE. `lib/crm/ingest.ts` promoted a
-- lead into a contact with:
--
--     linkedInUrl: lead.linkedin_url ?? lead.sales_navigator_url
--
-- `extracted_leads` holds BOTH columns. `crm_contacts` had one. So whichever
-- URL lost the coalesce was discarded at promotion — and on a Sales Navigator
-- save, which is Outlio's primary input, `linkedin_url` is frequently NULL,
-- because Navigator does not expose the public slug. The contact therefore ends
-- up holding a `/sales/lead/…` address in a column named `linkedin_url`, which
-- is exactly what the owner is looking at.
--
-- ⚠️ THE TWO ARE NOT INTERCONVERTIBLE, AND THAT IS WHY THIS IS A COLUMN RATHER
-- THAN A PARSER FIX. §4.5 forbids converting Sales Navigator identifiers to
-- public profile slugs by guessing, and `profile-reference.ts` keeps the two
-- `kind`s distinct for the same reason: they are different addresses for the
-- same person, and neither can be derived from the other.
--
-- ⚠️ NO BACKFILL, AND THE ABSENCE IS DELIBERATE. The information to split
-- existing rows correctly is still in `extracted_leads`, but only for contacts
-- that came from the lead engine — CSV imports, extension captures and manual
-- entry have no such source row. A backfill would therefore fix some contacts,
-- leave others, and leave nobody able to tell which. `lib/crm/ingest.ts` now
-- writes both columns going forward; historic rows keep whatever single URL they
-- have, which remains correct — just incomplete.
-- ---------------------------------------------------------------------------

alter table public.crm_contacts
  add column if not exists sales_navigator_url text;

/*
 * ⚠️ NO CHECK CONSTRAINT ON THE SHAPE. The value is attacker-influenced (it came
 * out of uploaded HTML) and the defence is `profileReference()`, an ALLOWLIST of
 * read-only paths applied at render. A regex here would look like validation,
 * pass `javascript:` on any Postgres that treats the pattern loosely, and invite
 * a future reader to render the column without the allowlist because "the
 * database already checks it".
 */

comment on column public.crm_contacts.sales_navigator_url is
  'The /sales/lead/… address, kept SEPARATE from linkedin_url. §4.5 forbids '
  'deriving a public slug from a Navigator identifier, so neither column can '
  'stand in for the other (0131).';

comment on column public.crm_contacts.linkedin_url is
  'The public /in/… address. Before 0131 this column also received Navigator '
  'URLs via a coalesce in ingest, so historic rows may hold either.';
