-- Volume measurements — M9 Phase 28, criterion 2.
--
-- ⚠️ EVERY QUERY BELOW IS THE SHAPE THE PRODUCT ACTUALLY RUNS, copied from the
-- module named above it. A volume test that invents its own simpler queries
-- measures nothing: the risk is precisely that a real query has a filter or a
-- count the test forgot.
--
-- The assertion is on the PLAN, not the clock. Local wall-clock time says
-- little about Supabase's hardware; "uses an index and touches a bounded
-- number of rows" holds anywhere.

\timing off
\pset pager off

\echo ''
\echo '=== dataset ==='
select
  (select count(*) from public.crm_contacts)       as contacts,
  (select count(*) from public.crm_contact_emails) as emails;

-- ---------------------------------------------------------------------------
-- 1. The contacts list, page 1 — lib/crm/contacts-list.ts
-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 1. contacts list, page 1 (expect: index scan, 25 rows) ==='
explain (analyze, buffers, costs off)
select id, full_name, job_title, owner_user_id, created_at, primary_company_id
from public.crm_contacts
where workspace_id = '00000000-0000-0000-0000-0000000000aa'
  and deleted_at is null
order by created_at desc
limit 25 offset 0;

-- ---------------------------------------------------------------------------
-- 2. The SAME list, deep into the pages.
--
-- ⚠️ THE ONE THAT EXPOSES OFFSET. `range()` in PostgREST is OFFSET/LIMIT, and
-- OFFSET makes the database walk and discard every row it skips. Page 1 is
-- fast at any size; page 400 is where the cost shows up.
-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 2. contacts list, page 400 (expect: cost grows with the offset) ==='
explain (analyze, buffers, costs off)
select id, full_name, job_title, owner_user_id, created_at, primary_company_id
from public.crm_contacts
where workspace_id = '00000000-0000-0000-0000-0000000000aa'
  and deleted_at is null
order by created_at desc
limit 25 offset 10000;

-- ---------------------------------------------------------------------------
-- 3. The exact count PostgREST runs alongside EVERY page
--
-- ⚠️ `count: 'exact'` IS A SECOND QUERY, not a free extra column. PostgREST
-- issues it on every page request so the UI can render "1–25 of N".
-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 3. the exact count that accompanies every page ==='
explain (analyze, buffers, costs off)
select count(*)
from public.crm_contacts
where workspace_id = '00000000-0000-0000-0000-0000000000aa'
  and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 4. Search — the trigram index from 0080
-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 4. name search (expect: bitmap scan on crm_contacts_name_trgm_idx) ==='
explain (analyze, buffers, costs off)
select id, full_name
from public.crm_contacts
where workspace_id = '00000000-0000-0000-0000-0000000000aa'
  and deleted_at is null
  and full_name ilike '%Person 4242%'
order by created_at desc
limit 25;

\echo ''
\echo '=== 5. email search (expect: bitmap scan on the address trigram index) ==='
explain (analyze, buffers, costs off)
select contact_id
from public.crm_contact_emails
where workspace_id = '00000000-0000-0000-0000-0000000000aa'
  and address ilike '%person4242@%'
  and deleted_at is null
limit 100;

-- ---------------------------------------------------------------------------
-- 6. The inbox list — lib/email/inbox.ts
--
-- Keyset, so unlike (2) its cost must NOT grow with depth.
-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 6. inbox keyset page (expect: index scan, flat cost at any depth) ==='
explain (analyze, buffers, costs off)
select id, subject, last_message_at
from public.email_threads
where workspace_id = '00000000-0000-0000-0000-0000000000aa'
  and status = 'open'
  and (last_message_at, id) < (now(), '00000000-0000-0000-0000-000000000000'::uuid)
order by last_message_at desc, id desc
limit 26;

\echo ''
\echo '=== index usage summary ==='
select
  relname                as table,
  indexrelname           as index,
  idx_scan               as scans
from pg_stat_user_indexes
where schemaname = 'public'
  and relname in ('crm_contacts', 'crm_contact_emails', 'email_threads')
  and idx_scan > 0
order by relname, indexrelname;

\echo ''
\echo '=== sequential scans (a growing count here at volume is the warning sign) ==='
select relname as table, seq_scan, seq_tup_read
from pg_stat_user_tables
where schemaname = 'public'
  and relname in ('crm_contacts', 'crm_contact_emails', 'email_threads')
order by seq_tup_read desc;
