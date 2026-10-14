-- Smoke test for 0157 — a page can be marked purged and fingerprinted, the
-- fingerprint must be an object, and a purged page stays listed (deleted_at
-- untouched).
--
-- Run with:
--   scripts/check-migration.sh supabase/migrations/0157_uploaded_page_lifecycle.sql \
--     supabase/migrations/smoke/0157_uploaded_page_lifecycle.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@example.com');
insert into public.extraction_jobs (id) values ('f1000000-0000-4000-8000-000000000001');
insert into public.uploaded_files (id, user_id, extraction_job_id, original_filename, storage_path, byte_size, content_sha256)
values (
  'e1000000-0000-4000-8000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'f1000000-0000-4000-8000-000000000001',
  'page.html',
  '11111111-1111-1111-1111-111111111111/f1000000-0000-4000-8000-000000000001/a.html',
  774000,
  repeat('a', 64)
);

create or replace function pg_temp.refused(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when check_violation then
  return true;
end $$;

insert into smoke_checks (label, ok)
select 'new columns start empty', content_purged_at is null and parse_census is null
from public.uploaded_files where id = 'e1000000-0000-4000-8000-000000000001';

update public.uploaded_files
   set content_purged_at = now(),
       parse_census = '{"pageType":"lead_search","rows":25,"credentialsScrubbed":0}'::jsonb
 where id = 'e1000000-0000-4000-8000-000000000001';

insert into smoke_checks (label, ok)
select 'a purged page keeps its row, hash and listing (deleted_at untouched)',
       content_purged_at is not null and deleted_at is null and content_sha256 = repeat('a', 64)
from public.uploaded_files where id = 'e1000000-0000-4000-8000-000000000001';

insert into smoke_checks (label, ok)
select 'a non-object fingerprint is refused',
       pg_temp.refused($q$update public.uploaded_files set parse_census = '[1,2]'::jsonb
                         where id = 'e1000000-0000-4000-8000-000000000001'$q$);

insert into smoke_checks (label, ok)
select 'the purge index exists',
       exists (select 1 from pg_indexes where indexname = 'uploaded_files_purge_due_idx');

do $$
declare
  v_expected constant int := 4;
  v_total  int;
  v_failed text;
begin
  select count(*), string_agg(label, '; ') filter (where not ok)
    into v_total, v_failed
    from smoke_checks;

  if v_total <> v_expected then
    raise exception 'SMOKE FAILED: expected % checks, recorded %', v_expected, v_total;
  end if;

  if v_failed is not null then
    raise exception 'SMOKE FAILED: %', v_failed;
  end if;

  raise notice 'SMOKE PASSED: % of % checks', v_total, v_expected;
end $$;

rollback;
