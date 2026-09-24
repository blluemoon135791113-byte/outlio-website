-- 0143 smoke — list-page count aggregates, request-id propagation, company search index
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. `if <bad> then raise` skips silently
-- when <bad> is NULL — a missing row, a missing JSON key — and a printed `ok`
-- column fails nothing. So each check goes into `smoke_checks` through
-- `coalesce(…, false)`, and the gate at the end raises unless exactly the
-- expected number were recorded and every one is true. check-migration.sh
-- refuses a smoke file whose gate never reported SMOKE PASSED.
--
-- Run it with:
--   scripts/check-migration.sh supabase/migrations/0143_optimization_audit_hardening.sql \
--     supabase/migrations/smoke/0143_optimization_audit_hardening.smoke.sql
--
-- On macOS with PostgreSQL 16 the local engine needs `LC_ALL` set to a valid
-- locale, or the postmaster dies at startup with "became multithreaded".

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

-- The temp table is created by postgres; service_role must be able to record.
grant all on smoke_checks to service_role;
grant usage on sequence smoke_checks_n_seq to service_role;

-- ---------------------------------------------------------------------------
-- The count aggregates are SECURITY DEFINER and repeat tenant scope in SQL, so
-- who may call them IS the access control. Only the server (service_role) may.
-- ---------------------------------------------------------------------------
insert into smoke_checks (label, ok) values
  ('anon cannot execute email_campaign_enrollment_counts',
   coalesce(not has_function_privilege('anon',
     'public.email_campaign_enrollment_counts(uuid, uuid[])', 'execute'), false)),
  ('authenticated cannot execute email_campaign_enrollment_counts',
   coalesce(not has_function_privilege('authenticated',
     'public.email_campaign_enrollment_counts(uuid, uuid[])', 'execute'), false)),
  ('anon cannot execute flow_run_counts',
   coalesce(not has_function_privilege('anon',
     'public.flow_run_counts(uuid, uuid[])', 'execute'), false)),
  ('authenticated cannot execute flow_run_counts',
   coalesce(not has_function_privilege('authenticated',
     'public.flow_run_counts(uuid, uuid[])', 'execute'), false));

-- ---------------------------------------------------------------------------
-- Empty and NULL id arrays are the list-page empty state. They must execute as
-- service_role without an untyped-array or permission failure, and return
-- nothing rather than every row.
-- ---------------------------------------------------------------------------
set local role service_role;

insert into smoke_checks (label, ok)
select 'enrollment counts for an empty id array return no rows',
       coalesce(count(*) = 0, false)
from public.email_campaign_enrollment_counts(gen_random_uuid(), array[]::uuid[]);

insert into smoke_checks (label, ok)
select 'enrollment counts for a NULL id array return no rows',
       coalesce(count(*) = 0, false)
from public.email_campaign_enrollment_counts(gen_random_uuid(), null);

insert into smoke_checks (label, ok)
select 'flow run counts for an empty id array return no rows',
       coalesce(count(*) = 0, false)
from public.flow_run_counts(gen_random_uuid(), array[]::uuid[]);

insert into smoke_checks (label, ok)
select 'flow run counts for a NULL id array return no rows',
       coalesce(count(*) = 0, false)
from public.flow_run_counts(gen_random_uuid(), null);

reset role;

-- ---------------------------------------------------------------------------
-- Historical callers may omit the request id; the database default keeps the
-- row valid while application requests supply the propagated edge id. The
-- length constraint mirrors the proxy's VALID_REQUEST_ID bounds (8–128).
-- ---------------------------------------------------------------------------
do $$
declare
  v_generated text;
  v_short_rejected boolean := false;
begin
  insert into public.api_request_log (method, path, status)
  values ('GET', '/api/v1/smoke', 200)
  returning request_id into v_generated;

  insert into smoke_checks (label, ok)
  values ('api_request_log generates a request id of at least 8 chars when omitted',
          coalesce(length(v_generated) >= 8, false));

  -- THE CONTROL. Without it, a missing constraint would pass everything above.
  begin
    insert into public.api_request_log (method, path, status, request_id)
    values ('GET', '/api/v1/smoke', 200, 'short');
  exception when check_violation then
    v_short_rejected := true;
  end;

  insert into smoke_checks (label, ok)
  values ('api_request_log rejects a request id shorter than 8 chars', v_short_rejected);
end
$$;

-- ---------------------------------------------------------------------------
-- Indexes.
-- ---------------------------------------------------------------------------
insert into smoke_checks (label, ok) values
  ('api_request_log_request_id_idx exists',
   to_regclass('public.api_request_log_request_id_idx') is not null),
  ('crm_companies_name_trgm_idx exists',
   to_regclass('public.crm_companies_name_trgm_idx') is not null);

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 12;
  v_total    integer;
  v_failed   text;
begin
  select count(*),
         string_agg(label, '; ' order by n) filter (where ok is not true)
    into v_total, v_failed
    from smoke_checks;

  -- ⚠️ THE COUNT IS PART OF THE TEST. A check that never ran records nothing,
  -- so it would pass by being absent. Adding or removing a check means
  -- changing this number, on purpose.
  if v_total <> v_expected then
    raise exception 'SMOKE FAILED: expected % checks, recorded %', v_expected, v_total;
  end if;

  if v_failed is not null then
    raise exception 'SMOKE FAILED: %', v_failed;
  end if;

  raise notice 'SMOKE PASSED: % of % checks', v_total, v_expected;
end $$;

rollback;
