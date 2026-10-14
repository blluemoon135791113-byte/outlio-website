-- ---------------------------------------------------------------------------
-- 0157 — uploaded pages are discarded once processed
--
-- Every saved Sales Navigator page (browser upload and extension capture
-- alike) was kept in the private `uploads` bucket forever: 230 pages / 179 MB
-- on 2026-10-14, each carrying the full name, title, location and blurb of
-- every person on it. Nothing reads a page again after it parses — leads and
-- the CSV come from the database — so the page was all risk and no use, and
-- at ~0.8 MB a page the free tier's 1 GB fills in ~1,000 more uploads.
--
-- From now on (lib/upload/page-lifecycle.ts):
--   · a page is removed from storage once its job has finished and it parsed;
--   · a page that FAILED to parse is kept 14 days (retry, and diagnosing a
--     LinkedIn markup change), then removed;
--   · what is kept instead is a fingerprint with no personal data.
--
-- Two columns, because `deleted_at` already means something else: the
-- dashboard and the Hubble run picker list a user's files WHERE deleted_at IS
-- NULL. Reusing it would make every processed upload vanish from history.
--
--   content_purged_at  when the stored page was removed (the row stays: its
--                      hash keeps duplicate detection working, its counts
--                      keep the history honest)
--   parse_census       page type, byte size, rows parsed, counts of the
--                      data-anonymize anchors the parsers rely on, and how
--                      many credential values were scrubbed. Counts only —
--                      never a value read off the page.
--
-- ⚠️ VALIDATE BEFORE APPLYING:
--   scripts/check-migration.sh supabase/migrations/0157_uploaded_page_lifecycle.sql \
--     supabase/migrations/smoke/0157_uploaded_page_lifecycle.smoke.sql
--
-- APPLY BEFORE DEPLOYING the code that writes these columns. The code marks a
-- page purged BEFORE removing it and skips removal if the mark fails, so code
-- deployed early removes nothing — it does not lose a page untracked.
--
-- ROLLBACK:
--   drop index if exists public.uploaded_files_purge_due_idx;
--   alter table public.uploaded_files
--     drop column if exists content_purged_at, drop column if exists parse_census;
-- ---------------------------------------------------------------------------

alter table public.uploaded_files
  add column if not exists content_purged_at timestamptz,
  add column if not exists parse_census jsonb;

alter table public.uploaded_files
  drop constraint if exists uploaded_files_parse_census_is_object;
alter table public.uploaded_files
  add constraint uploaded_files_parse_census_is_object
  check (parse_census is null or jsonb_typeof(parse_census) = 'object');

-- The sweep reads pages still held, oldest first.
create index if not exists uploaded_files_purge_due_idx
  on public.uploaded_files (created_at)
  where content_purged_at is null;
