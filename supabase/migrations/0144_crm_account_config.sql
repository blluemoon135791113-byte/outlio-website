-- ---------------------------------------------------------------------------
-- 0144 — Account workspace, step 1 of 6: the editable business vocabulary
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  NOTHING HERE IS A HARDCODED LIST, AND THAT IS THE POINT.                 ║
-- ║                                                                           ║
-- ║  ICP types ("Whom to Sell"), products ("What to Sell"), account statuses, ║
-- ║  lead roles and the title keywords that suggest them are ROWS, scoped to  ║
-- ║  a workspace and edited from Settings. The values below are a SEED: they  ║
-- ║  are what a workspace starts with, not what the code knows about. No      ║
-- ║  TypeScript branch may compare against a seeded name — renaming "TPA"     ║
-- ║  must change nothing but a label.                                         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- WHERE CODE NEEDS TO RECOGNISE A ROW, IT USES `system_key`, NEVER THE NAME.
-- Two behaviours need that: auto-moving an account from New to Assigned, and
-- classifying a lead with no matching title as Other. Those rows carry a
-- stable key, survive renaming, and cannot be deleted (a guard below refuses
-- it). Every other row is freely editable.
--
-- DISABLE, DON'T DELETE. `is_active = false` hides a value from pickers and
-- filter chips but keeps every account already tagged with it. Deletion is
-- only possible for a value nothing references: 0146 points the account tag
-- tables here with ON DELETE RESTRICT, so the database refuses the rest.
--
-- NEW WORKSPACES ARE SEEDED BY TRIGGER, not by application code, because
-- workspaces are created in two places (handle_new_user in 0070/0110, and the
-- 0070 backfill) and the one that forgets is the one whose Accounts page has
-- no filter chips.
--
-- ⚠️ VALIDATE BEFORE APPLYING:
--   scripts/check-migration.sh supabase/migrations/0144_crm_account_config.sql \
--     supabase/migrations/smoke/0144_crm_account_config.smoke.sql
--
-- ROLLBACK — only after 0149 → 0145 have been rolled back, in that order
-- (0145 points crm_companies.status_id here; 0146–0148 reference the rest):
--   drop trigger if exists workspaces_seed_account_config on public.workspaces;
--   drop function if exists public.crm_seed_account_config_trigger();
--   drop function if exists public.crm_seed_account_config(uuid);
--   drop table if exists public.crm_import_mappings, public.crm_account_settings,
--     public.crm_icp_allocation_targets, public.crm_lead_role_rules,
--     public.crm_lead_roles, public.crm_account_statuses, public.crm_products,
--     public.crm_icp_types;
--   drop function if exists public.crm_guard_system_config_row();
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- crm_icp_types — "Whom to Sell"
--
-- ⚠️ NOT `qualification_profiles`. lib/qualification scores leads against a
-- per-USER "ICP profile"; this is a per-WORKSPACE category an account is
-- tagged with. Different question, different scope, same three letters.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_icp_types (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 80),
  -- Stable URL value for the filter chip (?icp=tpa). Survives a rename, so a
  -- bookmarked view keeps working after "TPA" becomes "Third-Party Admin".
  slug         text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  unique (id, workspace_id)
);

drop trigger if exists crm_icp_types_set_updated_at on public.crm_icp_types;
create trigger crm_icp_types_set_updated_at
  before update on public.crm_icp_types
  for each row execute function public.set_updated_at();

create unique index if not exists crm_icp_types_name_uniq
  on public.crm_icp_types (workspace_id, lower(name));
create unique index if not exists crm_icp_types_slug_uniq
  on public.crm_icp_types (workspace_id, slug);
create index if not exists crm_icp_types_order_idx
  on public.crm_icp_types (workspace_id, sort_order);

-- ---------------------------------------------------------------------------
-- crm_products — "What to Sell"
--
-- `aliases` are extra spellings an import may use ("Practice Mgmt"). Import
-- matching is case-insensitive over full_name, short_name and aliases, and an
-- unmatched value is FLAGGED, never auto-created.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_products (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  full_name    text not null check (length(trim(full_name)) between 1 and 160),
  short_name   text not null check (length(trim(short_name)) between 1 and 60),
  slug         text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  aliases      text[] not null default '{}',
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  unique (id, workspace_id),
  constraint crm_products_aliases_bounded check (cardinality(aliases) <= 20)
);

drop trigger if exists crm_products_set_updated_at on public.crm_products;
create trigger crm_products_set_updated_at
  before update on public.crm_products
  for each row execute function public.set_updated_at();

create unique index if not exists crm_products_full_name_uniq
  on public.crm_products (workspace_id, lower(full_name));
create unique index if not exists crm_products_short_name_uniq
  on public.crm_products (workspace_id, lower(short_name));
create unique index if not exists crm_products_slug_uniq
  on public.crm_products (workspace_id, slug);
create index if not exists crm_products_order_idx
  on public.crm_products (workspace_id, sort_order);

-- ---------------------------------------------------------------------------
-- crm_account_statuses
--
-- ⚠️ NOT A PIPELINE. crm_pipelines / crm_pipeline_stages (0076) belong to
-- opportunities and have open/won/lost semantics that forecasting reads. An
-- account's working status is a different axis, kept out of that system so
-- neither can change the other's reports.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_account_statuses (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 60),
  slug         text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  -- 'new' and 'assigned' drive the auto-move on assignment (0147).
  system_key   text check (system_key is null or system_key in ('new', 'assigned')),
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  unique (id, workspace_id)
);

drop trigger if exists crm_account_statuses_set_updated_at on public.crm_account_statuses;
create trigger crm_account_statuses_set_updated_at
  before update on public.crm_account_statuses
  for each row execute function public.set_updated_at();

create unique index if not exists crm_account_statuses_name_uniq
  on public.crm_account_statuses (workspace_id, lower(name));
create unique index if not exists crm_account_statuses_slug_uniq
  on public.crm_account_statuses (workspace_id, slug);
create unique index if not exists crm_account_statuses_system_uniq
  on public.crm_account_statuses (workspace_id, system_key)
  where system_key is not null;
create index if not exists crm_account_statuses_order_idx
  on public.crm_account_statuses (workspace_id, sort_order);

-- ---------------------------------------------------------------------------
-- crm_lead_roles and crm_lead_role_rules
--
-- A lead's role at an account (Champion, Decision Maker, ...). The rules are
-- the keyword lists that SUGGEST a role from a job title; a person always has
-- the last word (0148 records manual choices, and auto-classification never
-- overwrites one).
--
-- RULE SEMANTICS, implemented once in lib/crm/lead-roles.ts:
--   a role is suggested when ANY active `title` keyword matches the title as
--   whole words, AND — only if the role has active `function` keywords — ANY
--   of those matches too. That second clause is how "Manager" means Champion
--   in Revenue Cycle without making every Office Manager a Champion.
--   No suggestion at all → the `other` role.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_lead_roles (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 60),
  slug         text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  -- 'other' is the no-match fallback the classifier needs to find by key.
  system_key   text check (
    system_key is null
    or system_key in ('champion', 'decision_maker', 'technical', 'other')
  ),
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  unique (id, workspace_id)
);

drop trigger if exists crm_lead_roles_set_updated_at on public.crm_lead_roles;
create trigger crm_lead_roles_set_updated_at
  before update on public.crm_lead_roles
  for each row execute function public.set_updated_at();

create unique index if not exists crm_lead_roles_name_uniq
  on public.crm_lead_roles (workspace_id, lower(name));
create unique index if not exists crm_lead_roles_slug_uniq
  on public.crm_lead_roles (workspace_id, slug);
create unique index if not exists crm_lead_roles_system_uniq
  on public.crm_lead_roles (workspace_id, system_key)
  where system_key is not null;

create table if not exists public.crm_lead_role_rules (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role_id      uuid not null,
  match_kind   text not null check (match_kind in ('title', 'function')),
  keyword      text not null check (length(trim(keyword)) between 1 and 60),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  constraint crm_lead_role_rules_role_fk
    foreign key (role_id, workspace_id)
    references public.crm_lead_roles (id, workspace_id)
    on delete cascade
);

drop trigger if exists crm_lead_role_rules_set_updated_at on public.crm_lead_role_rules;
create trigger crm_lead_role_rules_set_updated_at
  before update on public.crm_lead_role_rules
  for each row execute function public.set_updated_at();

create unique index if not exists crm_lead_role_rules_keyword_uniq
  on public.crm_lead_role_rules (workspace_id, role_id, match_kind, lower(keyword));

-- ---------------------------------------------------------------------------
-- crm_icp_allocation_targets — the ratio GUIDE
--
-- ⚠️ A GUIDE, NEVER A RULE. Nothing reads this to assign anyone. Totals that
-- do not reach 100% are a WARNING in the UI, which is why there is no check
-- constraint across rows here.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_icp_allocation_targets (
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  icp_type_id    uuid not null,
  target_percent numeric(5, 2) not null check (target_percent between 0 and 100),
  notes          text check (notes is null or length(notes) <= 500),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id) on delete set null,

  primary key (workspace_id, icp_type_id),
  constraint crm_icp_allocation_targets_icp_fk
    foreign key (icp_type_id, workspace_id)
    references public.crm_icp_types (id, workspace_id)
    on delete cascade
);

drop trigger if exists crm_icp_allocation_targets_set_updated_at on public.crm_icp_allocation_targets;
create trigger crm_icp_allocation_targets_set_updated_at
  before update on public.crm_icp_allocation_targets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- crm_account_settings
--
-- One row per workspace; absence means the column defaults, exactly as
-- crm_collision_settings (0079) works. A workspace that never opened the
-- settings page gets single-assignee accounts and `;` as the delimiter.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_account_settings (
  workspace_id             uuid primary key references public.workspaces(id) on delete cascade,
  allow_multiple_assignees boolean not null default false,
  -- Multi-value delimiter for What to Sell / Whom to Sell cells on import.
  import_delimiter         text not null default ';'
                           check (import_delimiter in (';', ',', '|')),
  /* Which account and lead fields extraction maps. Shape validated in
     TypeScript (lib/crm/account-settings.ts) on read AND write — a stored
     setting is untrusted input however it got there, the rule 0071 records
     for saved views. */
  extraction               jsonb not null default '{}'::jsonb,
  updated_at               timestamptz not null default now(),
  updated_by               uuid references auth.users(id) on delete set null,

  constraint crm_account_settings_extraction_is_object
    check (jsonb_typeof(extraction) = 'object')
);

drop trigger if exists crm_account_settings_set_updated_at on public.crm_account_settings;
create trigger crm_account_settings_set_updated_at
  before update on public.crm_account_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- crm_import_mappings — saved spreadsheet header → Outlio field mappings
-- ---------------------------------------------------------------------------

create table if not exists public.crm_import_mappings (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity       public.crm_custom_field_entity not null,
  name         text not null check (length(trim(name)) between 1 and 80),
  -- { "<source header>": "<outlio field>" }, validated in TypeScript.
  mapping      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  constraint crm_import_mappings_mapping_is_object check (jsonb_typeof(mapping) = 'object')
);

drop trigger if exists crm_import_mappings_set_updated_at on public.crm_import_mappings;
create trigger crm_import_mappings_set_updated_at
  before update on public.crm_import_mappings
  for each row execute function public.set_updated_at();

create unique index if not exists crm_import_mappings_name_uniq
  on public.crm_import_mappings (workspace_id, entity, lower(name));

-- ---------------------------------------------------------------------------
-- System rows cannot be deleted
--
-- Their `system_key` is how code finds "New", "Assigned" and "Other". Deleting
-- one would silently switch off the auto-move or leave unmatched titles with no
-- role. Renaming and reordering stay free; workspace deletion still cascades.
-- ---------------------------------------------------------------------------

create or replace function public.crm_guard_system_config_row()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.system_key is not null
     and exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    raise exception '%.% row "%" is a system row and cannot be deleted; disable or rename it instead',
      tg_table_schema, tg_table_name, old.name
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists crm_account_statuses_guard_system on public.crm_account_statuses;
create trigger crm_account_statuses_guard_system
  before delete on public.crm_account_statuses
  for each row execute function public.crm_guard_system_config_row();

drop trigger if exists crm_lead_roles_guard_system on public.crm_lead_roles;
create trigger crm_lead_roles_guard_system
  before delete on public.crm_lead_roles
  for each row execute function public.crm_guard_system_config_row();

-- ---------------------------------------------------------------------------
-- The seed
--
-- Idempotent: `on conflict do nothing` against the name/slug indexes, so
-- running it twice for one workspace adds nothing.
-- ---------------------------------------------------------------------------

create or replace function public.crm_seed_account_config(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.crm_icp_types (workspace_id, name, slug, sort_order)
  select p_workspace_id, v.name, v.slug, v.ord
    from (values
      ('TPA',                              'tpa',                     10),
      ('Insurance / Health Plan',          'insurance-health-plan',   20),
      ('Hospital / Health System',         'hospital-health-system',  30),
      ('Pharmacy',                         'pharmacy',                40),
      ('Provider Group',                   'provider-group',          50),
      ('RCM Company',                      'rcm-company',             60),
      ('Medical Practice',                 'medical-practice',        70),
      ('Self-Funded Employer',             'self-funded-employer',    80),
      ('Benefits Broker / Consultant',     'benefits-broker',         90),
      ('Digital Health / HealthTech',      'digital-health',         100),
      ('Government / Healthcare Program',  'government-program',     110),
      ('Other',                            'other',                  120)
    ) as v(name, slug, ord)
  on conflict do nothing;

  insert into public.crm_products (workspace_id, full_name, short_name, slug, aliases, sort_order)
  select p_workspace_id, v.full_name, v.short_name, v.slug, v.aliases, v.ord
    from (values
      ('Claim Automation & Benefit Structure Builder', 'Claim Automation',
         'claim-automation', '{}'::text[], 10),
      ('Revenue Cycle Management', 'RCM',
         'rcm', '{}'::text[], 20),
      ('Pharmacy Benefit Management', 'PBM',
         'pbm', '{}'::text[], 30),
      ('Practice Management', 'Practice Management',
         'practice-management', '{"Practice Mgmt"}'::text[], 40),
      ('FHIR API Gateway', 'FHIR Gateway',
         'fhir-gateway', '{}'::text[], 50),
      ('Corporate Employee Health Benefit Management for Self-Funded Plans',
         'Self-Funded Health Benefits',
         'self-funded-health-benefits', '{"Self-Funded"}'::text[], 60)
    ) as v(full_name, short_name, slug, aliases, ord)
  on conflict do nothing;

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

  /*
   * Keyword rules, joined to the role by system_key so a workspace that
   * already renamed a role still gets its rules attached to the right one.
   */
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

comment on function public.crm_seed_account_config(uuid) is
  'Seeds the account vocabulary (ICP types, products, statuses, lead roles, role '
  'keyword rules) for one workspace. Idempotent. Called by trigger on every new '
  'workspace and once for existing workspaces by 0144.';

create or replace function public.crm_seed_account_config_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.crm_seed_account_config(new.id);
  return new;
end;
$$;

drop trigger if exists workspaces_seed_account_config on public.workspaces;
create trigger workspaces_seed_account_config
  after insert on public.workspaces
  for each row execute function public.crm_seed_account_config_trigger();

revoke all on function public.crm_seed_account_config(uuid) from public, anon, authenticated;
grant execute on function public.crm_seed_account_config(uuid) to service_role;
revoke all on function public.crm_seed_account_config_trigger() from public, anon, authenticated;

-- Existing workspaces, once.
do $$
declare
  v_id uuid;
begin
  for v_id in select id from public.workspaces order by id loop
    perform public.crm_seed_account_config(v_id);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- RLS — members read; writes go through the service role behind the account
-- permission check (CLAUDE.md rule 8). Same shape as 0071.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_icp_types',
    'crm_products',
    'crm_account_statuses',
    'crm_lead_roles',
    'crm_lead_role_rules',
    'crm_icp_allocation_targets',
    'crm_account_settings',
    'crm_import_mappings'
  ]
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
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role', t
    );
  end loop;
end
$$;

comment on table public.crm_icp_types is
  '"Whom to Sell": workspace-editable account categories. Not qualification_profiles.';
comment on table public.crm_products is
  '"What to Sell": workspace-editable products. Imports match full_name, short_name or aliases, case-insensitively; unknown values are flagged, never created.';
comment on table public.crm_account_statuses is
  'Working status of an account. Separate from opportunity pipelines on purpose. system_key new/assigned drive the auto-move in 0147.';
comment on table public.crm_lead_role_rules is
  'Title/function keywords that SUGGEST a lead role. Applied by lib/crm/lead-roles.ts; never overrides a manual choice (0148).';
comment on table public.crm_icp_allocation_targets is
  'Admin-entered target share per ICP. A guide shown on the Allocation page; nothing assigns from it.';
