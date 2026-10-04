-- Smoke test for 0151 — after the transition, each address lives in exactly
-- one column, and a Navigator id cannot be written into the LinkedIn column.
--
-- Run with:
--   scripts/check-migration.sh supabase/migrations/0151_crm_navigator_out_of_linkedin.sql \
--     supabase/migrations/smoke/0151_crm_navigator_out_of_linkedin.smoke.sql

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@example.com');
insert into public.workspaces (id, name, owner_user_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'W', '11111111-1111-1111-1111-111111111111');

-- 1. The mirror is gone.
insert into smoke_checks (label, ok)
select 'mirror trigger retired',
       not exists (select 1 from pg_trigger where tgname = 'crm_companies_mirror_navigator_url');

-- 2. A Navigator id in the LinkedIn column is refused.
do $$
declare
  v_refused boolean := false;
begin
  begin
    insert into public.crm_companies (workspace_id, name, normalized_name, linkedin_url, normalized_linkedin_url)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Acme', 'acme',
            'https://www.linkedin.com/sales/company/1234', 'linkedin.com/sales/company/1234');
  exception when check_violation then
    v_refused := true;
  end;
  insert into smoke_checks (label, ok) values ('navigator id refused in the LinkedIn column', v_refused);
end $$;

-- 3. Both addresses, each in its own column, are accepted.
insert into public.crm_companies (workspace_id, name, normalized_name,
                                  linkedin_url, normalized_linkedin_url,
                                  sales_navigator_url, normalized_sales_navigator_url)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Beta', 'beta',
        'https://www.linkedin.com/company/beta', 'linkedin.com/company/beta',
        'https://www.linkedin.com/sales/company/55', 'linkedin.com/sales/company/55');
insert into smoke_checks (label, ok)
select 'public page and Navigator id coexist in their own columns',
       exists (select 1 from public.crm_companies
                where normalized_linkedin_url = 'linkedin.com/company/beta'
                  and normalized_sales_navigator_url = 'linkedin.com/sales/company/55');

-- 4. A Navigator-only account is a valid identity on its own.
insert into public.crm_companies (workspace_id, name, normalized_name, sales_navigator_url, normalized_sales_navigator_url)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Gamma', 'gamma',
        'https://www.linkedin.com/sales/company/77', 'linkedin.com/sales/company/77');
insert into smoke_checks (label, ok)
select 'navigator-only account accepted',
       exists (select 1 from public.crm_companies where normalized_sales_navigator_url = 'linkedin.com/sales/company/77');

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 4;
  v_total    integer;
  v_failed   text;
begin
  select count(n), string_agg(label, '; ' order by n) filter (where ok is not true)
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
