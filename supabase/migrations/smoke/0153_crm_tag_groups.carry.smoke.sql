-- Carry-over rehearsal for 0153 — does every retired row land in its new home?
--
-- ⚠️ RUN WITH 0152 AS THE MIGRATION, NOT 0153. This file builds data in the
-- PRE-0153 shape (ICP types, products, their links, a target, an override),
-- then applies 0153 itself with \i, then checks what came out. A smoke file
-- run after 0153 could only ever see the new shape.
--
--   scripts/check-migration.sh supabase/migrations/0152_crm_lead_role_writes.sql \
--     supabase/migrations/smoke/0153_crm_tag_groups.carry.smoke.sql
--
-- (The harness runs psql from the repository root, so the \i path resolves.)

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'sam@example.com');

-- A: has accounts (keeps the vocabulary). B: none (starts empty).
insert into public.workspaces (id, name, owner_user_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Healthcare', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'SaaS', '11111111-1111-1111-1111-111111111111');
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'setter');

insert into public.crm_companies (id, workspace_id, name, normalized_name)
values ('c1000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Acme Health', 'acme health');

-- Pre-0153 tagging: Hospital primary, Provider Group secondary, RCM product.
insert into public.crm_company_icps (workspace_id, company_id, icp_type_id, is_primary)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'c1000000-0000-4000-8000-000000000001'::uuid, id, slug = 'hospital-health-system'
  from public.crm_icp_types
 where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug in ('hospital-health-system', 'provider-group');
insert into public.crm_company_products (workspace_id, company_id, product_id)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'c1000000-0000-4000-8000-000000000001'::uuid, id
  from public.crm_products where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'rcm';
insert into public.crm_icp_allocation_targets (workspace_id, icp_type_id, target_percent)
select workspace_id, id, 40 from public.crm_icp_types
 where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and slug = 'tpa';
insert into public.crm_account_permission_overrides (workspace_id, user_id, permission, granted)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'accounts.edit_product_tags', false);

-- A pre-0153 free lead tag, written exactly as the old code writes one.
insert into public.crm_tags (workspace_id, name, normalized_name)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Hot Lead', 'hot lead');

-- The deferred primary-ICP check (0146) must fire before 0153 drops its table;
-- in production 0153 runs in its own transaction and there is nothing pending.
set constraints all immediate;

-- ===========================================================================
\i supabase/migrations/0153_crm_tag_groups.sql
-- ===========================================================================

-- 1. Only the workspace with accounts keeps the vocabulary, as two groups.
insert into smoke_checks (label, ok)
select 'healthcare vocabulary kept only where accounts exist',
       coalesce((select array_agg(slug order by sort_order) = array['whom-to-sell', 'what-to-sell']
                   from public.crm_tag_groups where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), false)
       and not exists (select 1 from public.crm_tag_groups where workspace_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

-- 2. All 12 + 6 values, as account tags in their group.
insert into smoke_checks (label, ok)
select 'all 12 ICP values and 6 products carried',
       coalesce((select count(*) = 12 from public.crm_tags t join public.crm_tag_groups g on g.id = t.group_id
                  where g.workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and g.slug = 'whom-to-sell'
                    and t.entity = 'company'), false)
       and coalesce((select count(*) = 6 from public.crm_tags t join public.crm_tag_groups g on g.id = t.group_id
                      where g.workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and g.slug = 'what-to-sell'), false);

-- 3. A product keeps its short name as the tag and its full name as the description.
insert into smoke_checks (label, ok)
select 'product short name is the tag, full name the description',
       coalesce((select name = 'Self-Funded Health Benefits'
                        and description = 'Corporate Employee Health Benefit Management for Self-Funded Plans'
                        and aliases = array['Self-Funded']
                   from public.crm_tags where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                    and slug = 'self-funded-health-benefits'), false);

-- 4. The account's tags came across, primary intact.
insert into smoke_checks (label, ok)
select 'account tags carried with the primary',
       coalesce((select string_agg(t.slug || ':' || ct.is_primary::text, ',' order by t.slug)
                   from public.crm_company_tags ct join public.crm_tags t on t.id = ct.tag_id
                  where ct.company_id = 'c1000000-0000-4000-8000-000000000001')
                = 'hospital-health-system:true,provider-group:false,rcm:false', false);

-- 5. The allocation target came across.
insert into smoke_checks (label, ok)
select 'allocation target carried',
       exists (select 1 from public.crm_tag_allocation_targets a join public.crm_tags t on t.id = a.tag_id
                where t.slug = 'tpa' and a.target_percent = 40);

-- 6. Permissions: one tag permission, granted where either was; the override kept.
insert into smoke_checks (label, ok)
select 'two tag permissions became one, defaults and override intact',
       coalesce((select bool_and(granted) from public.crm_account_role_defaults
                  where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                    and permission = 'accounts.edit_tags' and role in ('admin', 'manager', 'setter')), false)
       and coalesce((select not granted from public.crm_account_role_defaults
                      where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                        and permission = 'accounts.edit_tags' and role = 'viewer'), false)
       and coalesce((select not granted from public.crm_account_permission_overrides
                      where user_id = '22222222-2222-2222-2222-222222222222' and permission = 'accounts.edit_tags'), false)
       and not exists (select 1 from public.crm_account_role_defaults
                        where permission in ('accounts.edit_icp_tags', 'accounts.edit_product_tags'));

-- 7. The retired tables and functions are gone.
insert into smoke_checks (label, ok)
select 'retired tables and functions removed',
       to_regclass('public.crm_icp_types') is null
       and to_regclass('public.crm_products') is null
       and to_regclass('public.crm_company_icps') is null
       and to_regclass('public.crm_company_products') is null
       and to_regclass('public.crm_icp_allocation_targets') is null
       and to_regprocedure('public.crm_set_company_icps(uuid,uuid,uuid,uuid[],uuid,boolean)') is null;

-- 8. The old free lead tag is untouched and still a lead tag with no group.
insert into smoke_checks (label, ok)
select 'existing free lead tag untouched',
       exists (select 1 from public.crm_tags where normalized_name = 'hot lead'
                and entity = 'contact' and group_id is null and slug is null);

-- 9. A new workspace starts empty: statuses and roles, no tag groups.
insert into public.workspaces (id, name, owner_user_id)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Brand new', '11111111-1111-1111-1111-111111111111');
insert into smoke_checks (label, ok)
select 'a new workspace starts empty',
       not exists (select 1 from public.crm_tag_groups where workspace_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
       and (select count(*) = 9 from public.crm_account_statuses where workspace_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
       and (select count(*) = 4 from public.crm_lead_roles where workspace_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
       and (select count(*) = 8 from public.crm_account_role_defaults
             where workspace_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and role = 'setter');

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 9;
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
