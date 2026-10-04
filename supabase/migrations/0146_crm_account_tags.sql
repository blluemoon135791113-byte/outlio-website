-- ---------------------------------------------------------------------------
-- 0146 — Account workspace, step 3 of 6: Whom to Sell, What to Sell, sources
--
-- "Whom to Sell" and "What to Sell" ARE these two join tables. They are not
-- also stored as text columns on the account, and must never be: a second copy
-- is a second classification system, and the two disagree the first time a
-- product is renamed. Accounts reference the vocabulary by id, so a rename in
-- Settings relabels every account at once.
--
-- ON DELETE RESTRICT from both join tables to the vocabulary is the rule
-- "a value can only be deleted while no account uses it", enforced by the
-- database rather than by remembering to check.
--
-- ⚠️ EXACTLY ONE PRIMARY ICP. A partial unique index caps it at one; a
-- DEFERRED constraint trigger requires at least one whenever the account has
-- any ICP at all. Deferred so a caller can swap the primary (unset A, set B)
-- inside one transaction without tripping the check half way.
--
-- ⚠️ VALIDATE BEFORE APPLYING:
--   scripts/check-migration.sh supabase/migrations/0146_crm_account_tags.sql \
--     supabase/migrations/smoke/0146_crm_account_tags.smoke.sql
--
-- ROLLBACK (no existing table is modified):
--   drop table if exists public.crm_company_sources, public.crm_company_products,
--     public.crm_company_icps;
--   drop function if exists public.crm_require_primary_icp();
--   drop function if exists public.crm_guard_company_sources();
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- crm_company_icps — Whom to Sell
-- ---------------------------------------------------------------------------

create table if not exists public.crm_company_icps (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id   uuid not null,
  icp_type_id  uuid not null,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  primary key (company_id, icp_type_id),

  constraint crm_company_icps_company_fk
    foreign key (company_id, workspace_id)
    references public.crm_companies (id, workspace_id)
    on delete cascade,
  constraint crm_company_icps_icp_fk
    foreign key (icp_type_id, workspace_id)
    references public.crm_icp_types (id, workspace_id)
    on delete restrict
);

create unique index if not exists crm_company_icps_primary_uniq
  on public.crm_company_icps (company_id) where is_primary;

-- Filter chips: "accounts tagged Hospital" and their live counts.
create index if not exists crm_company_icps_icp_idx
  on public.crm_company_icps (workspace_id, icp_type_id, company_id);

create or replace function public.crm_require_primary_icp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid := case tg_op when 'DELETE' then old.company_id else new.company_id end;
begin
  if exists (select 1 from public.crm_company_icps where company_id = v_company_id)
     and not exists (
       select 1 from public.crm_company_icps
        where company_id = v_company_id and is_primary
     ) then
    raise exception 'account % has ICP types but no primary one', v_company_id
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

drop trigger if exists crm_company_icps_require_primary on public.crm_company_icps;
create constraint trigger crm_company_icps_require_primary
  after insert or update or delete on public.crm_company_icps
  deferrable initially deferred
  for each row execute function public.crm_require_primary_icp();

-- ---------------------------------------------------------------------------
-- crm_company_products — What to Sell
-- ---------------------------------------------------------------------------

create table if not exists public.crm_company_products (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id   uuid not null,
  product_id   uuid not null,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  primary key (company_id, product_id),

  constraint crm_company_products_company_fk
    foreign key (company_id, workspace_id)
    references public.crm_companies (id, workspace_id)
    on delete cascade,
  constraint crm_company_products_product_fk
    foreign key (product_id, workspace_id)
    references public.crm_products (id, workspace_id)
    on delete restrict
);

create index if not exists crm_company_products_product_idx
  on public.crm_company_products (workspace_id, product_id, company_id);

-- ---------------------------------------------------------------------------
-- crm_company_sources — where an account's data came from
--
-- ⚠️ THE PARSED ROW, NOT THE PAGE. Uploaded HTML lives in private storage
-- under the retention sweep (0013) and is never rendered (rule 3). A source
-- row points at the extraction job that holds it and keeps the PARSED values
-- that job produced for this account — the evidence a person can read —
-- rather than a second, permanent copy of a LinkedIn page.
--
-- APPEND-ONLY, through the same guard as crm_activities: provenance that can
-- be edited after the fact is not provenance. Workspace deletion and erasure
-- still pass (see crm_guard_append_only in 0075).
-- ---------------------------------------------------------------------------

create table if not exists public.crm_company_sources (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  company_id        uuid not null,
  source_type       text not null check (
    source_type in ('html_upload', 'extension', 'spreadsheet_row', 'url', 'manual')
  ),
  extraction_job_id uuid references public.extraction_jobs(id) on delete set null,
  import_job_id     uuid,
  url               text check (url is null or url ~* '^https?://'),
  raw_payload       jsonb,
  imported_by       uuid references auth.users(id) on delete set null,
  imported_at       timestamptz not null default now(),

  constraint crm_company_sources_payload_is_object
    check (raw_payload is null or jsonb_typeof(raw_payload) = 'object'),
  -- One spreadsheet row or one parsed card, not a file. Bounded so an import
  -- cannot park megabytes per account.
  constraint crm_company_sources_payload_bounded
    check (raw_payload is null or pg_column_size(raw_payload) <= 65536),
  constraint crm_company_sources_company_fk
    foreign key (company_id, workspace_id)
    references public.crm_companies (id, workspace_id)
    on delete cascade,
  constraint crm_company_sources_import_fk
    foreign key (import_job_id, workspace_id)
    references public.crm_import_jobs (id, workspace_id)
    on delete set null (import_job_id)
);

create index if not exists crm_company_sources_company_idx
  on public.crm_company_sources (workspace_id, company_id, imported_at desc);

/*
 * ⚠️ NOT crm_guard_append_only AS-IS. That guard refuses every UPDATE, and
 * three references here are ON DELETE SET NULL — which IS an update. With the
 * stock guard, deleting an extraction job from the trash (0061), deleting a
 * user, or deleting a workspace whose import jobs cascade first would all fail
 * on this table. So the one update permitted is a referenced row disappearing:
 * a reference may become NULL and nothing else may change. The rest of the
 * logic is crm_guard_append_only's, restated because a trigger function cannot
 * be called from another one.
 */
create or replace function public.crm_guard_company_sources()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('outlio.erasure', true), '') = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE'
     and not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;

  if tg_op = 'UPDATE'
     and (new.extraction_job_id is null or new.extraction_job_id = old.extraction_job_id)
     and (new.import_job_id is null or new.import_job_id = old.import_job_id)
     and (new.imported_by is null or new.imported_by = old.imported_by)
     and new.id = old.id
     and new.workspace_id = old.workspace_id
     and new.company_id = old.company_id
     and new.source_type = old.source_type
     and new.url is not distinct from old.url
     and new.raw_payload is not distinct from old.raw_payload
     and new.imported_at = old.imported_at then
    return new;
  end if;

  raise exception
    '%.% is append-only; % is not permitted',
    tg_table_schema, tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function public.crm_guard_company_sources() from public, anon, authenticated;

drop trigger if exists crm_company_sources_append_only on public.crm_company_sources;
create trigger crm_company_sources_append_only
  before update or delete on public.crm_company_sources
  for each row execute function public.crm_guard_company_sources();

-- ---------------------------------------------------------------------------
-- RLS — members read; writes are service-role behind the permission check.
--
-- ⚠️ RLS GRANTS A MEMBER THE WHOLE WORKSPACE, as everywhere in the CRM.
-- "Employees see only assigned accounts" is applied to the QUERY in code
-- (lib/crm/account-permissions.ts), exactly as dataScope is for contacts.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['crm_company_icps', 'crm_company_products', 'crm_company_sources']
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

comment on table public.crm_company_icps is
  '"Whom to Sell" for an account. Exactly one primary whenever any exist. The only place this classification is stored.';
comment on table public.crm_company_products is
  '"What to Sell" for an account. The only place this classification is stored.';
comment on table public.crm_company_sources is
  'Append-only provenance for an account: the parsed row or card it came from, and the job or URL behind it. Never raw HTML.';
