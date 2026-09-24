begin;

set local role service_role;

-- Empty arrays are the list-page empty state and must execute without an
-- untyped-array or permission failure.
select *
from public.email_campaign_enrollment_counts(gen_random_uuid(), array[]::uuid[]);

select *
from public.flow_run_counts(gen_random_uuid(), array[]::uuid[]);

reset role;

-- Historical callers may omit the request id; the database default keeps the
-- row valid while application requests supply the propagated edge id.
do $$
declare
  generated_id text;
begin
  insert into public.api_request_log (method, path, status)
  values ('GET', '/api/v1/smoke', 200)
  returning request_id into generated_id;

  if generated_id is null or length(generated_id) < 8 then
    raise exception 'api_request_log did not generate a request id';
  end if;
end
$$;

do $$
begin
  if to_regclass('public.crm_companies_name_trgm_idx') is null then
    raise exception 'company trigram index is missing';
  end if;
end
$$;

rollback;
