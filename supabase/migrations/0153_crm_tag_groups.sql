-- ---------------------------------------------------------------------------
-- 0153 — Workspace tag groups (Phase A of the 2026-10-02 redesign)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  OWNER DECISION, 2026-10-02: OUTLIO'S CUSTOMERS SELL INTO 100+ INDUSTRIES. ║
-- ║                                                                           ║
-- ║  0144 gave every workspace the same healthcare vocabulary in two fixed    ║
-- ║  shapes (ICP types, products). That fits one customer. This replaces both ║
-- ║  with TAG GROUPS that each workspace defines for itself — "Industry",     ║
-- ║  "Product", "Region", anything — for accounts and for leads, each shown   ║
-- ║  as its own chip row.                                                     ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ONE TAG SYSTEM, NOT TWO. Values live in the EXISTING `crm_tags` (0071),
-- extended with `entity` (contact | company) and an optional `group_id`. A
-- lead tag with no group is exactly what every tag was before this migration,
-- and the code that writes those (workflows, bulk tagging, CSV) is narrowed to
-- `entity = 'contact' and group_id is null`, so its behaviour is unchanged.
--
-- WHAT IS RETIRED, AND WHY NOTHING IS LOST (production, 2026-10-02):
--   crm_icp_types, crm_products       → two groups, "Whom to Sell" and "What
--                                       to Sell", in workspaces that hold at
--                                       least one account (exactly one today);
--                                       every other workspace starts empty.
--   crm_company_icps/products         0 rows → crm_company_tags (copied anyway)
--   crm_icp_allocation_targets        0 rows → crm_tag_allocation_targets
--   accounts.edit_icp_tags / _product → accounts.edit_tags (granted wherever
--                                       either was; 0 per-person overrides)
--
-- ⚠️ VALIDATE BEFORE APPLYING:
--   scripts/check-migration.sh supabase/migrations/0153_crm_tag_groups.sql \
--     supabase/migrations/smoke/0153_crm_tag_groups.smoke.sql
--
-- ⚠️ APPLY BEFORE DEPLOYING THE CODE THAT READS IT — and note the reverse:
-- code from steps 2–4 reads crm_icp_types/crm_products and the old list
-- functions, which this drops. Apply this and deploy the Phase A code together.
--
-- ROLLBACK: not a drop-and-go. The retired tables would have to be re-created
-- from 0144/0146/0150 and their rows copied back from crm_tags /
-- crm_company_tags by group. Before any account is tagged that is a re-run of
-- those migrations; afterwards it is a data migration. Treat this as one-way
-- once accounts carry tags.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. crm_tag_groups
-- ---------------------------------------------------------------------------

create table if not exists public.crm_tag_groups (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity       text not null check (entity in ('company', 'contact')),
  name         text not null check (length(trim(name)) between 1 and 60),
  -- The URL key for this group's chip row (?tag=industry:saas). Survives a rename.
  slug         text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  -- One value per account can be marked primary (the old "primary ICP").
  has_primary  boolean not null default false,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  unique (id, workspace_id),
  unique (id, workspace_id, entity),
  constraint crm_tag_groups_primary_on_accounts
    check (not has_primary or entity = 'company')
);

drop trigger if exists crm_tag_groups_set_updated_at on public.crm_tag_groups;
create trigger crm_tag_groups_set_updated_at
  before update on public.crm_tag_groups
  for each row execute function public.set_updated_at();

create unique index if not exists crm_tag_groups_name_uniq
  on public.crm_tag_groups (workspace_id, entity, lower(name));
create unique index if not exists crm_tag_groups_slug_uniq
  on public.crm_tag_groups (workspace_id, entity, slug);
create index if not exists crm_tag_groups_order_idx
  on public.crm_tag_groups (workspace_id, entity, sort_order);

-- ---------------------------------------------------------------------------
-- 2. crm_tags becomes the value table for both entities
-- ---------------------------------------------------------------------------

alter table public.crm_tags
  add column if not exists entity      text not null default 'contact',
  add column if not exists group_id    uuid,
  add column if not exists slug        text,
  add column if not exists description text,
  add column if not exists aliases     text[] not null default '{}',
  add column if not exists sort_order  integer not null default 0,
  add column if not exists is_active   boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_tags_entity_valid') then
    alter table public.crm_tags
      add constraint crm_tags_entity_valid check (entity in ('company', 'contact'));
  end if;
  -- An account tag always belongs to a group; a free lead tag (the old kind) does not need one.
  if not exists (select 1 from pg_constraint where conname = 'crm_tags_company_grouped') then
    alter table public.crm_tags
      add constraint crm_tags_company_grouped check (entity = 'contact' or group_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_tags_grouped_slug') then
    alter table public.crm_tags
      add constraint crm_tags_grouped_slug check (
        (group_id is null and slug is null)
        or (group_id is not null and slug ~ '^[a-z0-9][a-z0-9-]{0,62}$')
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_tags_description_bounded') then
    alter table public.crm_tags
      add constraint crm_tags_description_bounded
        check (description is null or length(description) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_tags_aliases_bounded') then
    alter table public.crm_tags
      add constraint crm_tags_aliases_bounded check (cardinality(aliases) <= 20);
  end if;
  -- The group must be of the same entity: an account group cannot hold a lead tag.
  if not exists (select 1 from pg_constraint where conname = 'crm_tags_group_fk') then
    alter table public.crm_tags
      add constraint crm_tags_group_fk
        foreign key (group_id, workspace_id, entity)
        references public.crm_tag_groups (id, workspace_id, entity)
        on delete restrict;
  end if;
  -- Targets for the per-entity link tables below.
  if not exists (select 1 from pg_constraint where conname = 'crm_tags_id_ws_group_entity_key') then
    alter table public.crm_tags
      add constraint crm_tags_id_ws_group_entity_key unique (id, workspace_id, group_id, entity);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_tags_id_ws_entity_key') then
    alter table public.crm_tags
      add constraint crm_tags_id_ws_entity_key unique (id, workspace_id, entity);
  end if;
end
$$;

/*
 * ⚠️ THE NAME INDEX IS REPLACED, AND THE CODE THAT RELIED ON IT IS NARROWED IN
 * THE SAME RELEASE. It was (workspace, name): one "Fintech" per workspace.
 * Now one per (workspace, entity, group). Every legacy lookup by name already
 * filters `entity = 'contact' and group_id is null` in the Phase A code, which
 * is exactly the old set, so it still finds at most one row.
 */
drop index if exists public.crm_tags_name_uniq;
create unique index crm_tags_name_uniq
  on public.crm_tags (
    workspace_id, entity,
    coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid),
    normalized_name
  )
  where deleted_at is null;

create unique index if not exists crm_tags_group_slug_uniq
  on public.crm_tags (workspace_id, group_id, slug)
  where group_id is not null and deleted_at is null;

create index if not exists crm_tags_group_order_idx
  on public.crm_tags (workspace_id, group_id, sort_order)
  where group_id is not null and deleted_at is null;

/*
 * A lead may only carry LEAD tags. crm_contact_tags (0071) predates entities,
 * so it has no column to put in a foreign key; the guard is a trigger.
 */
create or replace function public.crm_contact_tags_entity_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.crm_tags t
     where t.id = new.tag_id and t.workspace_id = new.workspace_id and t.entity <> 'contact'
  ) then
    raise exception 'an account tag cannot be attached to a lead'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists crm_contact_tags_entity_guard on public.crm_contact_tags;
create trigger crm_contact_tags_entity_guard
  before insert or update of tag_id on public.crm_contact_tags
  for each row execute function public.crm_contact_tags_entity_guard();

-- ---------------------------------------------------------------------------
-- 3. crm_company_tags — an account's tags
-- ---------------------------------------------------------------------------

create table if not exists public.crm_company_tags (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id   uuid not null,
  tag_id       uuid not null,
  -- Carried so "one primary per group" can be a unique index, and so a tag can
  -- only be attached through its own group (the FK below checks all three).
  group_id     uuid not null,
  entity       text not null default 'company' check (entity = 'company'),
  is_primary   boolean not null default false,
  -- Who put it there. 'rule' and 'ai' are suggestions (Phase D); a person's
  -- choice is 'manual' and always wins.
  source       text not null default 'manual' check (source in ('manual', 'rule', 'ai', 'import')),
  confidence   numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  -- The quoted text a suggestion was based on. Never generated.
  evidence     text check (evidence is null or length(evidence) <= 500),
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  primary key (company_id, tag_id),

  constraint crm_company_tags_company_fk
    foreign key (company_id, workspace_id)
    references public.crm_companies (id, workspace_id)
    on delete cascade,
  -- RESTRICT: a value an account still holds is disabled, not deleted.
  constraint crm_company_tags_tag_fk
    foreign key (tag_id, workspace_id, group_id, entity)
    references public.crm_tags (id, workspace_id, group_id, entity)
    on delete restrict
);

create unique index if not exists crm_company_tags_primary_uniq
  on public.crm_company_tags (company_id, group_id) where is_primary;
create index if not exists crm_company_tags_tag_idx
  on public.crm_company_tags (workspace_id, tag_id, company_id);
create index if not exists crm_company_tags_group_idx
  on public.crm_company_tags (workspace_id, group_id, company_id);

/*
 * In a group that has a primary, an account with any value there has exactly
 * one primary. DEFERRED, so a primary can be swapped inside one transaction.
 */
create or replace function public.crm_company_tags_require_primary()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_company uuid := case tg_op when 'DELETE' then old.company_id else new.company_id end;
  v_group   uuid := case tg_op when 'DELETE' then old.group_id else new.group_id end;
begin
  if exists (select 1 from public.crm_tag_groups g where g.id = v_group and g.has_primary)
     and exists (select 1 from public.crm_company_tags where company_id = v_company and group_id = v_group)
     and not exists (
       select 1 from public.crm_company_tags
        where company_id = v_company and group_id = v_group and is_primary
     ) then
    raise exception 'account % has values in a group that needs a primary, but none is primary', v_company
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

drop trigger if exists crm_company_tags_require_primary on public.crm_company_tags;
create constraint trigger crm_company_tags_require_primary
  after insert or update or delete on public.crm_company_tags
  deferrable initially deferred
  for each row execute function public.crm_company_tags_require_primary();

-- ---------------------------------------------------------------------------
-- 4. crm_tag_allocation_targets — the ratio guide, by tag rather than by ICP
-- ---------------------------------------------------------------------------

create table if not exists public.crm_tag_allocation_targets (
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  tag_id         uuid not null,
  target_percent numeric(5, 2) not null check (target_percent between 0 and 100),
  notes          text check (notes is null or length(notes) <= 500),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id) on delete set null,

  primary key (workspace_id, tag_id),
  constraint crm_tag_allocation_targets_tag_fk
    foreign key (tag_id, workspace_id)
    references public.crm_tags (id, workspace_id)
    on delete cascade
);

drop trigger if exists crm_tag_allocation_targets_set_updated_at on public.crm_tag_allocation_targets;
create trigger crm_tag_allocation_targets_set_updated_at
  before update on public.crm_tag_allocation_targets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Carry the healthcare vocabulary into groups — only where accounts exist
-- ---------------------------------------------------------------------------

insert into public.crm_tag_groups (workspace_id, entity, name, slug, has_primary, sort_order)
select w.id, 'company', 'Whom to Sell', 'whom-to-sell', true, 10
  from public.workspaces w
 where exists (select 1 from public.crm_companies c where c.workspace_id = w.id and c.deleted_at is null)
on conflict do nothing;

insert into public.crm_tag_groups (workspace_id, entity, name, slug, has_primary, sort_order)
select w.id, 'company', 'What to Sell', 'what-to-sell', false, 20
  from public.workspaces w
 where exists (select 1 from public.crm_companies c where c.workspace_id = w.id and c.deleted_at is null)
on conflict do nothing;

insert into public.crm_tags
  (workspace_id, entity, group_id, name, normalized_name, slug, sort_order, is_active, created_by)
select t.workspace_id, 'company', g.id, t.name, lower(regexp_replace(trim(t.name), '\s+', ' ', 'g')),
       t.slug, t.sort_order, t.is_active, t.created_by
  from public.crm_icp_types t
  join public.crm_tag_groups g
    on g.workspace_id = t.workspace_id and g.entity = 'company' and g.slug = 'whom-to-sell'
on conflict do nothing;

-- Product short names are the tag; the full name is the description shown on hover.
insert into public.crm_tags
  (workspace_id, entity, group_id, name, normalized_name, slug, description, aliases,
   sort_order, is_active, created_by)
select p.workspace_id, 'company', g.id, p.short_name,
       lower(regexp_replace(trim(p.short_name), '\s+', ' ', 'g')),
       p.slug, left(p.full_name, 200), p.aliases, p.sort_order, p.is_active, p.created_by
  from public.crm_products p
  join public.crm_tag_groups g
    on g.workspace_id = p.workspace_id and g.entity = 'company' and g.slug = 'what-to-sell'
on conflict do nothing;

-- Assignments and targets (0 rows on 2026-10-02 — copied so the migration is
-- correct on any database, not just that one).
insert into public.crm_company_tags (workspace_id, company_id, tag_id, group_id, is_primary, created_at, created_by)
select ci.workspace_id, ci.company_id, t.id, t.group_id, ci.is_primary, ci.created_at, ci.created_by
  from public.crm_company_icps ci
  join public.crm_icp_types it on it.id = ci.icp_type_id
  join public.crm_tags t
    on t.workspace_id = ci.workspace_id and t.entity = 'company' and t.slug = it.slug
  join public.crm_tag_groups g on g.id = t.group_id and g.slug = 'whom-to-sell'
on conflict do nothing;

insert into public.crm_company_tags (workspace_id, company_id, tag_id, group_id, created_at, created_by)
select cp.workspace_id, cp.company_id, t.id, t.group_id, cp.created_at, cp.created_by
  from public.crm_company_products cp
  join public.crm_products pr on pr.id = cp.product_id
  join public.crm_tags t
    on t.workspace_id = cp.workspace_id and t.entity = 'company' and t.slug = pr.slug
  join public.crm_tag_groups g on g.id = t.group_id and g.slug = 'what-to-sell'
on conflict do nothing;

insert into public.crm_tag_allocation_targets (workspace_id, tag_id, target_percent, notes, updated_at, updated_by)
select a.workspace_id, t.id, a.target_percent, a.notes, a.updated_at, a.updated_by
  from public.crm_icp_allocation_targets a
  join public.crm_icp_types it on it.id = a.icp_type_id
  join public.crm_tags t on t.workspace_id = a.workspace_id and t.entity = 'company' and t.slug = it.slug
  join public.crm_tag_groups g on g.id = t.group_id and g.slug = 'whom-to-sell'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 6. Retire the fixed shapes
-- ---------------------------------------------------------------------------

drop function if exists public.crm_account_facets(uuid, uuid, boolean, jsonb);
drop function if exists public.crm_list_accounts(uuid, uuid, boolean, jsonb, text, boolean, integer, integer);
drop function if exists public.crm_account_matches(uuid, uuid, boolean, jsonb, text);
drop function if exists public.crm_set_company_icps(uuid, uuid, uuid, uuid[], uuid, boolean);
drop function if exists public.crm_set_company_products(uuid, uuid, uuid[], uuid, boolean);

drop table if exists public.crm_icp_allocation_targets;
drop table if exists public.crm_company_icps;
drop table if exists public.crm_company_products;
drop table if exists public.crm_icp_types;
drop table if exists public.crm_products;
drop function if exists public.crm_require_primary_icp();

/*
 * New workspaces: statuses and lead roles only. No industry vocabulary — every
 * workspace defines its own groups (owner decision: start empty).
 */
create or replace function public.crm_seed_account_config(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.crm_account_statuses (workspace_id, name, slug, system_key, sort_order)
  select p_workspace_id, v.name, v.slug, v.system_key, v.ord
    from (values
      ('New',             'new',             'new',      10),
      ('Assigned',        'assigned',        'assigned', 20),
      ('Researching',     'researching',     null,       30),
      ('Contacting',      'contacting',      null,       40),
      ('In Conversation', 'in-conversation', null,       50),
      ('Meeting',         'meeting',         null,       60),
      ('Opportunity',     'opportunity',     null,       70),
      ('Closed',          'closed',          null,       80),
      ('Not Relevant',    'not-relevant',    null,       90)
    ) as v(name, slug, system_key, ord)
  on conflict do nothing;

  insert into public.crm_lead_roles (workspace_id, name, slug, system_key, sort_order)
  select p_workspace_id, v.name, v.slug, v.system_key, v.ord
    from (values
      ('Champion',       'champion',       'champion',       10),
      ('Decision Maker', 'decision-maker', 'decision_maker', 20),
      ('Technical',      'technical',      'technical',      30),
      ('Other',          'other',          'other',          40)
    ) as v(name, slug, system_key, ord)
  on conflict do nothing;

  insert into public.crm_lead_role_rules (workspace_id, role_id, match_kind, keyword)
  select p_workspace_id, r.id, v.match_kind, v.keyword
    from (values
      ('decision_maker', 'title', 'VP'),
      ('decision_maker', 'title', 'Vice President'),
      ('decision_maker', 'title', 'Chief'),
      ('decision_maker', 'title', 'CEO'),
      ('decision_maker', 'title', 'CFO'),
      ('decision_maker', 'title', 'COO'),
      ('decision_maker', 'title', 'CMO'),
      ('decision_maker', 'title', 'President'),
      ('decision_maker', 'title', 'Head of'),
      ('decision_maker', 'title', 'Director'),
      ('decision_maker', 'title', 'Owner'),
      ('decision_maker', 'title', 'Founder'),
      ('technical',      'title', 'CIO'),
      ('technical',      'title', 'CTO'),
      ('technical',      'title', 'IT'),
      ('technical',      'title', 'Engineering'),
      ('technical',      'title', 'Architect'),
      ('technical',      'title', 'Integration'),
      ('technical',      'title', 'Interoperability'),
      ('technical',      'title', 'Data'),
      ('technical',      'title', 'Developer'),
      ('champion',       'title', 'Manager'),
      ('champion',       'title', 'Lead'),
      ('champion',       'title', 'Supervisor'),
      ('champion',       'title', 'Specialist'),
      ('champion',       'title', 'Coordinator'),
      ('champion',       'function', 'Revenue Cycle'),
      ('champion',       'function', 'Billing'),
      ('champion',       'function', 'Claims'),
      ('champion',       'function', 'Benefits'),
      ('champion',       'function', 'Pharmacy')
    ) as v(system_key, match_kind, keyword)
    join public.crm_lead_roles r
      on r.workspace_id = p_workspace_id
     and r.system_key = v.system_key
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. One tag permission instead of two
-- ---------------------------------------------------------------------------

do $$
declare
  c record;
begin
  for c in
    select conrelid::regclass::text as tbl, conname
      from pg_constraint
     where contype = 'c'
       and conrelid in ('public.crm_account_role_defaults'::regclass,
                        'public.crm_account_permission_overrides'::regclass)
       and pg_get_constraintdef(oid) like '%accounts.edit_icp_tags%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end
$$;

insert into public.crm_account_role_defaults (workspace_id, role, permission, granted)
select workspace_id, role, 'accounts.edit_tags', bool_or(granted)
  from public.crm_account_role_defaults
 where permission in ('accounts.edit_icp_tags', 'accounts.edit_product_tags')
 group by workspace_id, role
on conflict do nothing;

insert into public.crm_account_permission_overrides (workspace_id, user_id, permission, granted)
select workspace_id, user_id, 'accounts.edit_tags', bool_or(granted)
  from public.crm_account_permission_overrides
 where permission in ('accounts.edit_icp_tags', 'accounts.edit_product_tags')
 group by workspace_id, user_id
on conflict do nothing;

delete from public.crm_account_role_defaults
 where permission in ('accounts.edit_icp_tags', 'accounts.edit_product_tags');
delete from public.crm_account_permission_overrides
 where permission in ('accounts.edit_icp_tags', 'accounts.edit_product_tags');

alter table public.crm_account_role_defaults
  add constraint crm_account_role_defaults_permission_valid check (permission in (
    'accounts.view_all', 'accounts.create', 'accounts.edit', 'accounts.edit_tags',
    'accounts.assign', 'accounts.delete', 'accounts.import', 'config.manage'
  ));
alter table public.crm_account_permission_overrides
  add constraint crm_account_permission_overrides_permission_valid check (permission in (
    'accounts.view_all', 'accounts.create', 'accounts.edit', 'accounts.edit_tags',
    'accounts.assign', 'accounts.delete', 'accounts.import', 'config.manage'
  ));

create or replace function public.crm_seed_account_permissions(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.crm_account_role_defaults (workspace_id, role, permission, granted)
  select p_workspace_id, v.role::public.workspace_role, p.permission,
         case v.role
           when 'admin'   then true
           when 'manager' then p.permission not in ('accounts.delete', 'config.manage')
           when 'setter'  then p.permission in ('accounts.edit', 'accounts.edit_tags')
           else false
         end
    from (values ('admin'), ('manager'), ('setter'), ('viewer')) as v(role)
   cross join (values
      ('accounts.view_all'),
      ('accounts.create'),
      ('accounts.edit'),
      ('accounts.edit_tags'),
      ('accounts.assign'),
      ('accounts.delete'),
      ('accounts.import'),
      ('config.manage')
   ) as p(permission)
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. The list, filters and chip counts — over tags
--
-- p_filters.tags: an array of tag ids, ANDed. One value per group is a UI
-- rule, so a list of ids is the whole filter. An unknown id matches nothing.
-- ---------------------------------------------------------------------------

create or replace function public.crm_account_matches(
  p_workspace_id uuid,
  p_viewer       uuid,
  p_view_all     boolean,
  p_filters      jsonb,
  -- Drop this group's own filter, for that group's chip counts.
  p_ignore_group uuid default null
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
     and (
       (coalesce(p_view_all, false) and coalesce(p_filters ->> 'scope', 'all') <> 'mine')
       or exists (
         select 1 from public.crm_company_assignments a
          where a.company_id = co.id
            and a.user_id = p_viewer
            and a.unassigned_at is null
       )
     )
     and not exists (
       select 1
         from jsonb_array_elements_text(coalesce(p_filters -> 'tags', '[]'::jsonb)) f(tag_id)
        where not exists (
                select 1 from public.crm_tags t
                 where t.id::text = f.tag_id
                   and t.workspace_id = p_workspace_id
                   and t.group_id = p_ignore_group
              )
          and not exists (
                select 1 from public.crm_company_tags ct
                 where ct.company_id = co.id and ct.tag_id::text = f.tag_id
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
  tags                 jsonb,
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
       co.id
     limit least(greatest(coalesce(p_limit, 25), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    page.id, page.name, page.domain, page.linkedin_url, page.sales_navigator_url,
    page.headquarters, page.employee_count, page.employee_count_range, page.priority,
    page.status_id, page.source::text, page.owner_user_id, page.last_activity_at,
    page.created_at,
    (select count(*) from public.crm_contacts c
      where c.workspace_id = p_workspace_id
        and c.primary_company_id = page.id
        and c.deleted_at is null),
    coalesce((select jsonb_agg(jsonb_build_object(
                       'id', ct.tag_id, 'group_id', ct.group_id, 'primary', ct.is_primary,
                       'source', ct.source)
                     order by ct.is_primary desc, ct.created_at)
                from public.crm_company_tags ct where ct.company_id = page.id), '[]'::jsonb),
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

/*
 * Chip counts, every active account group at once. Each group's chips count the
 * accounts matching every OTHER active filter, so choosing a value in one row
 * does not zero the rest of that row. `tag_id` null is the group's "All" chip.
 */
create or replace function public.crm_account_facets(
  p_workspace_id uuid,
  p_viewer       uuid,
  p_view_all     boolean,
  p_filters      jsonb
)
returns table (group_id uuid, tag_id uuid, account_count bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select g.id, ct.tag_id, count(distinct m.company_id)
    from public.crm_tag_groups g
    cross join lateral public.crm_account_matches(p_workspace_id, p_viewer, p_view_all, p_filters, g.id) m
    left join public.crm_company_tags ct
      on ct.company_id = m.company_id and ct.group_id = g.id
   where g.workspace_id = p_workspace_id
     and g.entity = 'company'
     and g.is_active
   group by grouping sets ((g.id, ct.tag_id), (g.id))
  /*
   * ⚠️ An account with NO value in a group also produces a null tag_id in the
   * per-value grouping. Without this, that row and the group total would be
   * indistinguishable; only the total (GROUPING = 1) may carry a null.
   */
  having not (ct.tag_id is null and grouping(ct.tag_id) = 0)
$$;

-- ---------------------------------------------------------------------------
-- 9. Writing an account's values in one group — one transaction + activity
--
-- p_merge = false: these values REPLACE the group's values on the account.
-- p_merge = true:  values are only ADDED (an import, a bulk "add tag"); an
--   existing primary is kept, and p_primary only becomes primary when the
--   account had none in this group.
-- A disabled value may stay where it is; it cannot be newly added.
-- ---------------------------------------------------------------------------

create or replace function public.crm_set_company_tags(
  p_workspace_id uuid,
  p_company_id   uuid,
  p_group_id     uuid,
  p_primary      uuid,
  p_tag_ids      uuid[],
  p_actor_id     uuid,
  p_merge        boolean default false,
  p_source       text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group    public.crm_tag_groups%rowtype;
  v_wanted   uuid[];
  v_current  uuid[];
  v_added    uuid[];
  v_removed  uuid[];
  v_primary  uuid;
  v_old_prim uuid;
begin
  if p_source not in ('manual', 'import') then
    raise exception 'crm_set_company_tags: unknown source %', p_source using errcode = 'check_violation';
  end if;

  perform 1 from public.crm_companies
   where id = p_company_id and workspace_id = p_workspace_id and deleted_at is null
   for update;
  if not found then
    raise exception 'crm_set_company_tags: no such account in workspace %', p_workspace_id
      using errcode = 'no_data_found';
  end if;

  select * into v_group from public.crm_tag_groups
   where id = p_group_id and workspace_id = p_workspace_id and entity = 'company';
  if v_group.id is null then
    raise exception 'crm_set_company_tags: no such account tag group in workspace %', p_workspace_id
      using errcode = 'check_violation';
  end if;

  v_wanted := array(
    select distinct x from unnest(array_prepend(p_primary, coalesce(p_tag_ids, '{}'))) x where x is not null
  );

  select coalesce(array_agg(tag_id), '{}'), max(tag_id::text) filter (where is_primary)::uuid
    into v_current, v_old_prim
    from public.crm_company_tags
   where company_id = p_company_id and group_id = p_group_id;

  v_added := array(select x from unnest(v_wanted) x where not x = any (v_current));
  v_removed := case when p_merge then '{}'::uuid[]
                    else array(select x from unnest(v_current) x where not x = any (v_wanted)) end;

  if exists (
    select 1 from unnest(v_added) x
     where not exists (
       select 1 from public.crm_tags t
        where t.id = x and t.workspace_id = p_workspace_id and t.group_id = p_group_id
          and t.is_active and t.deleted_at is null
     )
  ) then
    raise exception 'crm_set_company_tags: a value is unknown, disabled, or not in this group'
      using errcode = 'check_violation';
  end if;

  v_primary := case
    when not v_group.has_primary then null
    when p_merge then coalesce(v_old_prim, p_primary, v_wanted[1])
    else coalesce(p_primary, case when cardinality(v_wanted) > 0 then v_wanted[1] end)
  end;

  delete from public.crm_company_tags
   where company_id = p_company_id and group_id = p_group_id and tag_id = any (v_removed);

  insert into public.crm_company_tags (workspace_id, company_id, tag_id, group_id, source, created_by)
  select p_workspace_id, p_company_id, x, p_group_id, p_source, p_actor_id from unnest(v_added) x;

  /*
   * A person (or an import) saying "this value" makes it theirs: a value a
   * rule or the AI suggested becomes a manual one when it is re-chosen.
   */
  if not p_merge then
    update public.crm_company_tags
       set source = p_source, confidence = null, evidence = null
     where company_id = p_company_id and group_id = p_group_id and source in ('rule', 'ai')
       and tag_id = any (v_wanted);
  end if;

  update public.crm_company_tags set is_primary = false
   where company_id = p_company_id and group_id = p_group_id and is_primary
     and tag_id is distinct from v_primary;
  update public.crm_company_tags set is_primary = true
   where company_id = p_company_id and group_id = p_group_id and tag_id = v_primary and not is_primary;

  if cardinality(v_added) > 0 or cardinality(v_removed) > 0 or v_old_prim is distinct from v_primary then
    insert into public.crm_activities (workspace_id, company_id, activity_type, channel, actor_user_id, metadata)
    values (
      p_workspace_id, p_company_id, 'ACCOUNT_TAGS_CHANGED', 'manual', p_actor_id,
      jsonb_build_object(
        'group', p_group_id, 'group_name', v_group.name,
        'added', to_jsonb(v_added), 'removed', to_jsonb(v_removed),
        'primary_from', v_old_prim, 'primary_to', v_primary,
        'mode', case when p_merge then 'merge' else 'replace' end, 'source', p_source
      )
    );
    return jsonb_build_object('changed', true, 'added', to_jsonb(v_added),
                              'removed', to_jsonb(v_removed), 'primary', v_primary);
  end if;

  return jsonb_build_object('changed', false, 'added', '[]'::jsonb, 'removed', '[]'::jsonb, 'primary', v_primary);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on function public.crm_account_matches(uuid, uuid, boolean, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.crm_account_matches(uuid, uuid, boolean, jsonb, uuid) to service_role;
revoke all on function public.crm_list_accounts(uuid, uuid, boolean, jsonb, text, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.crm_list_accounts(uuid, uuid, boolean, jsonb, text, boolean, integer, integer) to service_role;
revoke all on function public.crm_account_facets(uuid, uuid, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.crm_account_facets(uuid, uuid, boolean, jsonb) to service_role;
revoke all on function public.crm_set_company_tags(uuid, uuid, uuid, uuid, uuid[], uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.crm_set_company_tags(uuid, uuid, uuid, uuid, uuid[], uuid, boolean, text) to service_role;
revoke all on function public.crm_contact_tags_entity_guard() from public, anon, authenticated;
revoke all on function public.crm_company_tags_require_primary() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['crm_tag_groups', 'crm_company_tags', 'crm_tag_allocation_targets']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_member', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_workspace_member(workspace_id) or public.is_admin())',
      t || '_select_member', t
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end
$$;

comment on table public.crm_tag_groups is
  'Workspace-defined tag groups ("Industry", "Product", …) for accounts or leads. Each is a chip row.';
comment on table public.crm_company_tags is
  'An account''s tags. source = manual | import | rule | ai; a manual choice always wins (Phase D).';
comment on column public.crm_tags.group_id is
  'NULL = a free lead tag (every tag before 0153). Account tags always have a group.';
