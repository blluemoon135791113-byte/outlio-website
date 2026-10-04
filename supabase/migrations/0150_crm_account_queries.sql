-- ---------------------------------------------------------------------------
-- 0150 — Account workspace: the list, its filters, its live chip counts, and
--        the two tag writes
--
-- WHY SQL FUNCTIONS. The Accounts page filters by ICP and product (join
-- tables), by assignee (history table), sorts server-side, and shows a live
-- count on every chip "given the OTHER active filters". PostgREST can filter
-- through one embedded join but cannot GROUP BY, so the counts would mean
-- fetching every account id in the workspace into Node on every page view.
-- One shared predicate, `crm_account_matches`, keeps the list and the counts
-- from ever disagreeing about which accounts a filter selects.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  VISIBILITY IS AN ARGUMENT, AND THE FUNCTION ENFORCES IT.                 ║
-- ║                                                                           ║
-- ║  `p_view_all = false` restricts to accounts the viewer holds an open      ║
-- ║  assignment on, whatever the filters say — including `scope = all`. The   ║
-- ║  caller decides `p_view_all` from the account policy                      ║
-- ║  (lib/crm/account-access.ts); this function cannot be talked into         ║
-- ║  widening it by a filter value.                                           ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- FILTER LOGIC (approved spec): AND between groups; one value per group; an
-- ICP filter matches primary OR secondary; a product filter matches any tag.
--
-- p_filters keys, all optional, validated in TypeScript before the call:
--   scope     'mine' | 'all'
--   icp       crm_icp_types.id
--   product   crm_products.id
--   assignee  a user id, or 'unassigned'
--   status    crm_account_statuses.id
--   priority  'high' | 'medium' | 'low'
--   source    crm_record_source value
--   q         search text, ALREADY ESCAPED for ILIKE (% _ \) by the caller
--
-- ⚠️ IDS ARE COMPARED AS TEXT, deliberately. A malformed id in a bookmarked
-- URL then matches nothing instead of raising "invalid input syntax for type
-- uuid" out of a page render. The lookups stay indexed: each is keyed first on
-- company_id from the outer row.
--
-- ⚠️ VALIDATE BEFORE APPLYING:
--   scripts/check-migration.sh supabase/migrations/0150_crm_account_queries.sql \
--     supabase/migrations/smoke/0150_crm_account_queries.smoke.sql
--
-- ⚠️ APPLY THIS BEFORE MERGING THE CODE THAT CALLS IT. Every statement is
-- `create or replace` / grant / comment, so applying it twice is harmless.
--
-- ROLLBACK (functions only; no data):
--   drop function if exists public.crm_set_company_status(uuid, uuid, uuid, uuid);
--   drop function if exists public.crm_set_company_products(uuid, uuid, uuid[], uuid, boolean);
--   drop function if exists public.crm_set_company_icps(uuid, uuid, uuid, uuid[], uuid, boolean);
--   drop function if exists public.crm_account_facets(uuid, uuid, boolean, jsonb);
--   drop function if exists public.crm_list_accounts(uuid, uuid, boolean, jsonb, text, boolean, integer, integer);
--   drop function if exists public.crm_account_matches(uuid, uuid, boolean, jsonb, text);
-- ---------------------------------------------------------------------------

create or replace function public.crm_account_matches(
  p_workspace_id uuid,
  p_viewer       uuid,
  p_view_all     boolean,
  p_filters      jsonb,
  -- 'icp' or 'product': drop that group's filter, for its own chip counts.
  p_ignore       text default null
)
returns table (company_id uuid)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select co.id
    from public.crm_companies co
   where co.workspace_id = p_workspace_id
     and co.deleted_at is null
     -- Visibility, then the My/All toggle.
     and (
       (coalesce(p_view_all, false) and coalesce(p_filters ->> 'scope', 'all') <> 'mine')
       or exists (
         select 1 from public.crm_company_assignments a
          where a.company_id = co.id
            and a.user_id = p_viewer
            and a.unassigned_at is null
       )
     )
     and (
       coalesce(p_ignore, '') = 'icp'
       or p_filters ->> 'icp' is null
       or exists (
         select 1 from public.crm_company_icps i
          where i.company_id = co.id
            and i.icp_type_id::text = p_filters ->> 'icp'
       )
     )
     and (
       coalesce(p_ignore, '') = 'product'
       or p_filters ->> 'product' is null
       or exists (
         select 1 from public.crm_company_products p
          where p.company_id = co.id
            and p.product_id::text = p_filters ->> 'product'
       )
     )
     and (
       p_filters ->> 'assignee' is null
       or case
            when p_filters ->> 'assignee' = 'unassigned' then not exists (
              select 1 from public.crm_company_assignments a
               where a.company_id = co.id and a.unassigned_at is null
            )
            else exists (
              select 1 from public.crm_company_assignments a
               where a.company_id = co.id
                 and a.unassigned_at is null
                 and a.user_id::text = p_filters ->> 'assignee'
            )
          end
     )
     and (p_filters ->> 'status' is null or co.status_id::text = p_filters ->> 'status')
     and (p_filters ->> 'priority' is null or co.priority = p_filters ->> 'priority')
     and (p_filters ->> 'source' is null or co.source::text = p_filters ->> 'source')
     and (
       nullif(p_filters ->> 'q', '') is null
       or co.name         ilike '%' || (p_filters ->> 'q') || '%'
       or co.domain       ilike '%' || (p_filters ->> 'q') || '%'
       or co.headquarters ilike '%' || (p_filters ->> 'q') || '%'
       or co.summary      ilike '%' || (p_filters ->> 'q') || '%'
     )
$$;

-- ---------------------------------------------------------------------------
-- crm_list_accounts — one page, sorted, with everything a row renders
--
-- The tag, assignee and lead-count lookups run on the PAGE only (≤ 100 rows),
-- after sorting and limiting, never on the whole match set.
-- ---------------------------------------------------------------------------

-- Dropped first: `create or replace` cannot change a function's result columns,
-- and this keeps the file safe to re-apply if those columns ever change.
drop function if exists public.crm_list_accounts(uuid, uuid, boolean, jsonb, text, boolean, integer, integer);

create or replace function public.crm_list_accounts(
  p_workspace_id uuid,
  p_viewer       uuid,
  p_view_all     boolean,
  p_filters      jsonb,
  p_sort         text default 'name',
  p_desc         boolean default false,
  p_limit        integer default 25,
  p_offset       integer default 0
)
returns table (
  id                   uuid,
  name                 text,
  domain               text,
  linkedin_url         text,
  sales_navigator_url  text,
  headquarters         text,
  employee_count       integer,
  employee_count_range text,
  priority             text,
  status_id            uuid,
  source               text,
  owner_user_id        uuid,
  last_activity_at     timestamptz,
  created_at           timestamptz,
  lead_count           bigint,
  icps                 jsonb,
  product_ids          uuid[],
  assignee_ids         uuid[],
  total_count          bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with page as (
    select co.*, count(*) over () as total_count
      from public.crm_companies co
      join public.crm_account_matches(p_workspace_id, p_viewer, p_view_all, p_filters) m
        on m.company_id = co.id
     order by
       case when p_sort = 'name'          and not p_desc then lower(co.name) end asc  nulls last,
       case when p_sort = 'name'          and     p_desc then lower(co.name) end desc nulls last,
       case when p_sort = 'last_activity' and not p_desc then co.last_activity_at end asc  nulls last,
       case when p_sort = 'last_activity' and     p_desc then co.last_activity_at end desc nulls last,
       case when p_sort = 'created'       and not p_desc then co.created_at end asc,
       case when p_sort = 'created'       and     p_desc then co.created_at end desc,
       case when p_sort = 'employees'     and not p_desc then co.employee_count end asc  nulls last,
       case when p_sort = 'employees'     and     p_desc then co.employee_count end desc nulls last,
       case when p_sort = 'priority'      and not p_desc
            then case co.priority when 'high' then 3 when 'medium' then 2 when 'low' then 1 end end asc  nulls last,
       case when p_sort = 'priority'      and     p_desc
            then case co.priority when 'high' then 3 when 'medium' then 2 when 'low' then 1 end end desc nulls last,
       -- A stable tiebreaker, so equal keys cannot swap places between pages.
       co.id
     limit least(greatest(coalesce(p_limit, 25), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    page.id,
    page.name,
    page.domain,
    page.linkedin_url,
    page.sales_navigator_url,
    page.headquarters,
    page.employee_count,
    page.employee_count_range,
    page.priority,
    page.status_id,
    page.source::text,
    page.owner_user_id,
    page.last_activity_at,
    page.created_at,
    (select count(*) from public.crm_contacts c
      where c.workspace_id = p_workspace_id
        and c.primary_company_id = page.id
        and c.deleted_at is null),
    coalesce((select jsonb_agg(jsonb_build_object('id', i.icp_type_id, 'primary', i.is_primary)
                               order by i.is_primary desc, i.created_at)
                from public.crm_company_icps i where i.company_id = page.id), '[]'::jsonb),
    coalesce((select array_agg(p.product_id order by p.created_at)
                from public.crm_company_products p where p.company_id = page.id), '{}'::uuid[]),
    coalesce((select array_agg(a.user_id order by a.assigned_at, a.id)
                from public.crm_company_assignments a
               where a.company_id = page.id and a.unassigned_at is null), '{}'::uuid[]),
    page.total_count
  from page
  order by
    case when p_sort = 'name'          and not p_desc then lower(page.name) end asc  nulls last,
    case when p_sort = 'name'          and     p_desc then lower(page.name) end desc nulls last,
    case when p_sort = 'last_activity' and not p_desc then page.last_activity_at end asc  nulls last,
    case when p_sort = 'last_activity' and     p_desc then page.last_activity_at end desc nulls last,
    case when p_sort = 'created'       and not p_desc then page.created_at end asc,
    case when p_sort = 'created'       and     p_desc then page.created_at end desc,
    case when p_sort = 'employees'     and not p_desc then page.employee_count end asc  nulls last,
    case when p_sort = 'employees'     and     p_desc then page.employee_count end desc nulls last,
    case when p_sort = 'priority'      and not p_desc
         then case page.priority when 'high' then 3 when 'medium' then 2 when 'low' then 1 end end asc  nulls last,
    case when p_sort = 'priority'      and     p_desc
         then case page.priority when 'high' then 3 when 'medium' then 2 when 'low' then 1 end end desc nulls last,
    page.id
$$;

-- ---------------------------------------------------------------------------
-- crm_account_facets — the chip counts
--
-- Each ICP chip counts the accounts that match every active filter EXCEPT the
-- ICP one (so choosing "Hospital" does not zero out "TPA"), and the same for
-- products. `facet = 'icp_total'` / 'product_total' are the "All" chips.
-- ---------------------------------------------------------------------------

create or replace function public.crm_account_facets(
  p_workspace_id uuid,
  p_viewer       uuid,
  p_view_all     boolean,
  p_filters      jsonb
)
returns table (facet text, value_id uuid, account_count bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with by_icp as (
    select company_id from public.crm_account_matches(p_workspace_id, p_viewer, p_view_all, p_filters, 'icp')
  ),
  by_product as (
    select company_id from public.crm_account_matches(p_workspace_id, p_viewer, p_view_all, p_filters, 'product')
  )
  select 'icp'::text, i.icp_type_id, count(*)
    from by_icp m join public.crm_company_icps i on i.company_id = m.company_id
   group by i.icp_type_id
  union all
  select 'product'::text, p.product_id, count(*)
    from by_product m join public.crm_company_products p on p.company_id = m.company_id
   group by p.product_id
  union all
  select 'icp_total'::text, null::uuid, count(*) from by_icp
  union all
  select 'product_total'::text, null::uuid, count(*) from by_product
$$;

-- ---------------------------------------------------------------------------
-- Tag writes — one transaction each, with their activity
--
-- Replacing an account's ICPs is several statements (remove, add, move the
-- primary). As separate PostgREST calls a failure half way leaves the account
-- with no tags or no primary; here it is all or nothing, under the company row
-- lock, and the ACCOUNT_TAGS_CHANGED activity commits with it.
--
-- p_merge = false (an edit): the given set REPLACES the account's set.
-- p_merge = true  (an import's "merged into existing"): values are only ADDED,
--   nothing is removed, and an existing primary ICP is kept — p_primary only
--   becomes primary when the account had no ICP at all.
--
-- ⚠️ DISABLED VALUES. A value already on the account may stay (disabling never
-- strips tags), but a disabled value cannot be newly ADDED — the pickers hide
-- them and the server agrees.
-- ---------------------------------------------------------------------------

create or replace function public.crm_set_company_icps(
  p_workspace_id uuid,
  p_company_id   uuid,
  p_primary      uuid,
  p_secondary    uuid[],
  p_actor_id     uuid,
  p_merge        boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wanted   uuid[];
  v_current  uuid[];
  v_added    uuid[];
  v_removed  uuid[];
  v_primary  uuid;
  v_old_prim uuid;
begin
  perform 1 from public.crm_companies
   where id = p_company_id and workspace_id = p_workspace_id and deleted_at is null
   for update;
  if not found then
    raise exception 'crm_set_company_icps: no such account in workspace %', p_workspace_id
      using errcode = 'no_data_found';
  end if;

  v_wanted := array(
    select distinct x from unnest(array_prepend(p_primary, coalesce(p_secondary, '{}'))) as x
     where x is not null
  );

  if p_primary is null and cardinality(v_wanted) > 0 and not p_merge then
    raise exception 'crm_set_company_icps: a primary ICP is required when any ICP is set'
      using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(icp_type_id), '{}'), max(icp_type_id::text) filter (where is_primary)::uuid
    into v_current, v_old_prim
    from public.crm_company_icps
   where company_id = p_company_id;

  v_added := array(select x from unnest(v_wanted) x where not x = any (v_current));
  v_removed := case when p_merge then '{}'::uuid[]
                    else array(select x from unnest(v_current) x where not x = any (v_wanted)) end;

  if exists (
    select 1 from unnest(v_added) x
     where not exists (
       select 1 from public.crm_icp_types t
        where t.id = x and t.workspace_id = p_workspace_id and t.is_active
     )
  ) then
    raise exception 'crm_set_company_icps: an ICP type is unknown or disabled in this workspace'
      using errcode = 'check_violation';
  end if;

  v_primary := case
    when p_merge then coalesce(v_old_prim, p_primary, v_wanted[1])
    else p_primary
  end;

  delete from public.crm_company_icps
   where company_id = p_company_id and icp_type_id = any (v_removed);

  insert into public.crm_company_icps (workspace_id, company_id, icp_type_id, is_primary, created_by)
  select p_workspace_id, p_company_id, x, false, p_actor_id from unnest(v_added) x;

  -- Move the primary flag with two statements; the deferred check (0146) only
  -- looks once the transaction ends, so the moment with none is allowed.
  update public.crm_company_icps set is_primary = false
   where company_id = p_company_id and is_primary and icp_type_id is distinct from v_primary;
  update public.crm_company_icps set is_primary = true
   where company_id = p_company_id and icp_type_id = v_primary and not is_primary;

  if cardinality(v_added) > 0 or cardinality(v_removed) > 0
     or v_old_prim is distinct from v_primary then
    insert into public.crm_activities (
      workspace_id, company_id, activity_type, channel, actor_user_id, metadata
    )
    values (
      p_workspace_id, p_company_id, 'ACCOUNT_TAGS_CHANGED', 'manual', p_actor_id,
      jsonb_build_object(
        'kind', 'icp', 'added', to_jsonb(v_added), 'removed', to_jsonb(v_removed),
        'primary_from', v_old_prim, 'primary_to', v_primary,
        'mode', case when p_merge then 'merge' else 'replace' end
      )
    );
    return jsonb_build_object('changed', true, 'added', to_jsonb(v_added),
                              'removed', to_jsonb(v_removed), 'primary', v_primary);
  end if;

  return jsonb_build_object('changed', false, 'added', '[]'::jsonb, 'removed', '[]'::jsonb, 'primary', v_primary);
end;
$$;

create or replace function public.crm_set_company_products(
  p_workspace_id uuid,
  p_company_id   uuid,
  p_products     uuid[],
  p_actor_id     uuid,
  p_merge        boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wanted  uuid[];
  v_current uuid[];
  v_added   uuid[];
  v_removed uuid[];
begin
  perform 1 from public.crm_companies
   where id = p_company_id and workspace_id = p_workspace_id and deleted_at is null
   for update;
  if not found then
    raise exception 'crm_set_company_products: no such account in workspace %', p_workspace_id
      using errcode = 'no_data_found';
  end if;

  v_wanted := array(select distinct x from unnest(coalesce(p_products, '{}')) x where x is not null);

  select coalesce(array_agg(product_id), '{}') into v_current
    from public.crm_company_products where company_id = p_company_id;

  v_added := array(select x from unnest(v_wanted) x where not x = any (v_current));
  v_removed := case when p_merge then '{}'::uuid[]
                    else array(select x from unnest(v_current) x where not x = any (v_wanted)) end;

  if exists (
    select 1 from unnest(v_added) x
     where not exists (
       select 1 from public.crm_products p
        where p.id = x and p.workspace_id = p_workspace_id and p.is_active
     )
  ) then
    raise exception 'crm_set_company_products: a product is unknown or disabled in this workspace'
      using errcode = 'check_violation';
  end if;

  delete from public.crm_company_products
   where company_id = p_company_id and product_id = any (v_removed);
  insert into public.crm_company_products (workspace_id, company_id, product_id, created_by)
  select p_workspace_id, p_company_id, x, p_actor_id from unnest(v_added) x;

  if cardinality(v_added) > 0 or cardinality(v_removed) > 0 then
    insert into public.crm_activities (
      workspace_id, company_id, activity_type, channel, actor_user_id, metadata
    )
    values (
      p_workspace_id, p_company_id, 'ACCOUNT_TAGS_CHANGED', 'manual', p_actor_id,
      jsonb_build_object('kind', 'product', 'added', to_jsonb(v_added), 'removed', to_jsonb(v_removed),
                         'mode', case when p_merge then 'merge' else 'replace' end)
    );
  end if;

  return jsonb_build_object('changed', cardinality(v_added) > 0 or cardinality(v_removed) > 0,
                            'added', to_jsonb(v_added), 'removed', to_jsonb(v_removed));
end;
$$;

revoke all on function public.crm_set_company_icps(uuid, uuid, uuid, uuid[], uuid, boolean) from public, anon, authenticated;
grant execute on function public.crm_set_company_icps(uuid, uuid, uuid, uuid[], uuid, boolean) to service_role;
revoke all on function public.crm_set_company_products(uuid, uuid, uuid[], uuid, boolean) from public, anon, authenticated;
grant execute on function public.crm_set_company_products(uuid, uuid, uuid[], uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- crm_set_company_status — the status and its history row, together
--
-- 0123 records why this is a function: an update and its activity as two
-- statements either leave a status change with no history, or (activity
-- first) history asserting a change that never happened.
-- A disabled status cannot be newly chosen; the current one may be kept.
-- ---------------------------------------------------------------------------

create or replace function public.crm_set_company_status(
  p_workspace_id uuid,
  p_company_id   uuid,
  p_status_id    uuid,
  p_actor_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from uuid;
begin
  select status_id into v_from
    from public.crm_companies
   where id = p_company_id and workspace_id = p_workspace_id and deleted_at is null
   for update;
  if not found then
    raise exception 'crm_set_company_status: no such account in workspace %', p_workspace_id
      using errcode = 'no_data_found';
  end if;

  if v_from is not distinct from p_status_id then
    return jsonb_build_object('changed', false, 'from', v_from, 'to', p_status_id);
  end if;

  if not exists (
    select 1 from public.crm_account_statuses
     where id = p_status_id and workspace_id = p_workspace_id and is_active
  ) then
    raise exception 'crm_set_company_status: the status is unknown or disabled in this workspace'
      using errcode = 'check_violation';
  end if;

  update public.crm_companies set status_id = p_status_id
   where id = p_company_id and workspace_id = p_workspace_id;

  insert into public.crm_activities (workspace_id, company_id, activity_type, channel, actor_user_id, metadata)
  values (p_workspace_id, p_company_id, 'ACCOUNT_STATUS_CHANGED', 'manual', p_actor_id,
          jsonb_build_object('from', v_from, 'to', p_status_id));

  return jsonb_build_object('changed', true, 'from', v_from, 'to', p_status_id);
end;
$$;

revoke all on function public.crm_set_company_status(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_set_company_status(uuid, uuid, uuid, uuid) to service_role;

/*
 * ⚠️ SERVICE ROLE ONLY. These take the workspace, the viewer and the
 * visibility decision as ARGUMENTS and trust them — granted to
 * `authenticated`, any member could pass p_view_all = true, or another
 * workspace's id, and read it all.
 */
revoke all on function public.crm_account_matches(uuid, uuid, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.crm_account_matches(uuid, uuid, boolean, jsonb, text) to service_role;
revoke all on function public.crm_list_accounts(uuid, uuid, boolean, jsonb, text, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.crm_list_accounts(uuid, uuid, boolean, jsonb, text, boolean, integer, integer) to service_role;
revoke all on function public.crm_account_facets(uuid, uuid, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.crm_account_facets(uuid, uuid, boolean, jsonb) to service_role;

comment on function public.crm_account_matches(uuid, uuid, boolean, jsonb, text) is
  'The one predicate behind the Accounts list and its chip counts. p_view_all=false restricts to the viewer''s open assignments regardless of filters.';
