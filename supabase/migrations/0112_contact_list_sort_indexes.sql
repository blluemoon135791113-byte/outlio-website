-- 0112 — an index for the sort the contact list actually offers
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  THE CONTACT LIST OFFERS EXACTLY TWO SORTS. ONE OF THEM HAD NO INDEX.    ║
-- ║                                                                           ║
-- ║  `CONTACT_SORTS` (lib/crm/contacts-list.ts:67) is `full_name` and          ║
-- ║  `created_at`. `crm_contacts_workspace_created_idx` serves the second.    ║
-- ║  Nothing served the first.                                                ║
-- ║                                                                           ║
-- ║  MEASURED ON STAGING AT 100,000 CONTACTS, 2026-09-04:                     ║
-- ║                                                                           ║
-- ║      Limit                                                                ║
-- ║        Gather Merge                                                       ║
-- ║          Sort  (Sort Key: full_name, top-N heapsort)                      ║
-- ║            Parallel Seq Scan on crm_contacts  (rows=50000 loops=2)        ║
-- ║                                                                           ║
-- ║  Every one of the workspace's rows read, on every page, to return 25.     ║
-- ║  p95 1149 ms against §7's 800 ms budget.                                  ║
-- ║                                                                           ║
-- ║  ⚠️ IT DID NOT LOOK BROKEN. An earlier run of the same benchmark measured  ║
-- ║  452 ms and PASSED — the plan was a full scan then too. Wall-clock alone  ║
-- ║  would have shipped this; the plan is what settled it.                    ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- ---------------------------------------------------------------------------
-- ⚠️ PARTIAL ON `deleted_at is null`, BECAUSE EVERY LIST QUERY CARRIES THAT
-- FILTER.
--
-- `listContacts` always appends `.is('deleted_at', null)`. A partial index
-- therefore covers every real query while excluding soft-deleted rows from the
-- index entirely — smaller to store, cheaper to maintain, and it cannot be
-- accidentally used for a query that wants deleted rows.
--
-- `workspace_id` leads because it is an equality predicate on every query;
-- `full_name` follows so Postgres can walk the index in order and stop at the
-- page size instead of sorting the workspace.
-- ---------------------------------------------------------------------------
create index concurrently if not exists crm_contacts_workspace_name_idx
  on public.crm_contacts (workspace_id, full_name)
  where deleted_at is null;

comment on index public.crm_contacts_workspace_name_idx is
  'Serves the full_name sort in CONTACT_SORTS. Without it the list does a '
  'parallel seq scan over the whole workspace on every page — measured at '
  '100k contacts, p95 1149ms against a 800ms budget (0112).';

-- ---------------------------------------------------------------------------
-- ⚠️ `concurrently`, AND THAT HAS A CONSEQUENCE FOR HOW THIS IS APPLIED.
--
-- `create index concurrently` cannot run inside a transaction block. Supabase's
-- SQL editor wraps statements in one, so this file must be applied with
-- `supabase db push` (which does not), or each statement run separately.
--
-- It is worth the awkwardness: a plain `create index` takes an ACCESS EXCLUSIVE
-- lock and blocks every read and write to crm_contacts until it completes. On a
-- table this size that is a visible outage for a cosmetic gain.
--
-- ROLLBACK: `drop index concurrently if exists public.crm_contacts_workspace_name_idx;`
-- The index is additive — dropping it restores the previous (slow) plan and
-- loses nothing.
-- ---------------------------------------------------------------------------
