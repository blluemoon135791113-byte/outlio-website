-- ---------------------------------------------------------------------------
-- 0149 — Account workspace, step 6 of 6: account permissions, per role and per person
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  A SECOND, NARROWER POLICY — NOT A REPLACEMENT FOR THE FIRST.            ║
-- ║                                                                           ║
-- ║  lib/workspaces/permissions.ts stays exactly as it is: a pure, total      ║
-- ║  role ranking that decides every crm.* / email.* / flow.* question and    ║
-- ║  is tested role × permission. The CRM module gate there still runs FIRST. ║
-- ║                                                                           ║
-- ║  The nine account permissions below are the only ones an admin can edit   ║
-- ║  per role and override per person, because that is what was asked for.    ║
-- ║  The decision stays a PURE function (lib/crm/account-permissions.ts) that ║
-- ║  receives these rows as input; this file only stores them.                ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- THE OWNER IS NOT CONFIGURABLE. There are no owner rows, and the check below
-- refuses one: the owner always holds every account permission, so no edit to
-- this table can lock a workspace out of its own settings.
--
-- FAIL CLOSED. A missing row means DENIED, never "use a default from code".
-- The seed writes the full matrix — granted AND denied — so the settings page
-- shows every cell and nothing is implied.
--
-- ⚠️ THE PERMISSION LIST IS REPEATED IN A CHECK CONSTRAINT as a shape guard.
-- The TypeScript list in lib/crm/account-permissions.ts is the source of
-- truth; a unit test (build step 2) asserts the two match, so adding a
-- permission without a migration fails the suite rather than the database.
--
-- ⚠️ VALIDATE BEFORE APPLYING:
--   scripts/check-migration.sh supabase/migrations/0149_crm_account_permissions.sql \
--     supabase/migrations/smoke/0149_crm_account_permissions.smoke.sql
--
-- ROLLBACK (no existing table is modified):
--   drop trigger if exists workspaces_seed_account_permissions on public.workspaces;
--   drop function if exists public.crm_seed_account_permissions_trigger();
--   drop function if exists public.crm_seed_account_permissions(uuid);
--   drop table if exists public.crm_account_permission_overrides, public.crm_account_role_defaults;
-- ---------------------------------------------------------------------------

create table if not exists public.crm_account_role_defaults (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role         public.workspace_role not null check (role <> 'owner'),
  permission   text not null check (permission in (
    'accounts.view_all',
    'accounts.create',
    'accounts.edit',
    'accounts.edit_icp_tags',
    'accounts.edit_product_tags',
    'accounts.assign',
    'accounts.delete',
    'accounts.import',
    'config.manage'
  )),
  granted      boolean not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null,

  primary key (workspace_id, role, permission)
);

drop trigger if exists crm_account_role_defaults_set_updated_at on public.crm_account_role_defaults;
create trigger crm_account_role_defaults_set_updated_at
  before update on public.crm_account_role_defaults
  for each row execute function public.set_updated_at();

/*
 * Per-person exceptions: "give Sam accounts.create without making Sam a
 * manager". Keyed to the MEMBERSHIP, so leaving the workspace removes them —
 * a returning member starts from their role, not from privileges granted to a
 * previous stint.
 */
create table if not exists public.crm_account_permission_overrides (
  workspace_id uuid not null,
  user_id      uuid not null,
  permission   text not null check (permission in (
    'accounts.view_all',
    'accounts.create',
    'accounts.edit',
    'accounts.edit_icp_tags',
    'accounts.edit_product_tags',
    'accounts.assign',
    'accounts.delete',
    'accounts.import',
    'config.manage'
  )),
  granted      boolean not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null,

  primary key (workspace_id, user_id, permission),
  constraint crm_account_permission_overrides_member_fk
    foreign key (workspace_id, user_id)
    references public.workspace_memberships (workspace_id, user_id)
    on delete cascade
);

drop trigger if exists crm_account_permission_overrides_set_updated_at on public.crm_account_permission_overrides;
create trigger crm_account_permission_overrides_set_updated_at
  before update on public.crm_account_permission_overrides
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The seed — the defaults agreed for the account workspace:
--
--   admin    everything
--   manager  everything except accounts.delete and config.manage
--   setter   edit fields/summary/notes/status and both tag sets; sees only
--            accounts assigned to them
--   viewer   nothing beyond reading accounts assigned to them
-- ---------------------------------------------------------------------------

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
           when 'setter'  then p.permission in ('accounts.edit', 'accounts.edit_icp_tags',
                                                'accounts.edit_product_tags')
           else false
         end
    from (values ('admin'), ('manager'), ('setter'), ('viewer')) as v(role)
   cross join (values
      ('accounts.view_all'),
      ('accounts.create'),
      ('accounts.edit'),
      ('accounts.edit_icp_tags'),
      ('accounts.edit_product_tags'),
      ('accounts.assign'),
      ('accounts.delete'),
      ('accounts.import'),
      ('config.manage')
   ) as p(permission)
  on conflict do nothing;
end;
$$;

create or replace function public.crm_seed_account_permissions_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.crm_seed_account_permissions(new.id);
  return new;
end;
$$;

drop trigger if exists workspaces_seed_account_permissions on public.workspaces;
create trigger workspaces_seed_account_permissions
  after insert on public.workspaces
  for each row execute function public.crm_seed_account_permissions_trigger();

revoke all on function public.crm_seed_account_permissions(uuid) from public, anon, authenticated;
grant execute on function public.crm_seed_account_permissions(uuid) to service_role;
revoke all on function public.crm_seed_account_permissions_trigger() from public, anon, authenticated;

do $$
declare
  v_id uuid;
begin
  for v_id in select id from public.workspaces order by id loop
    perform public.crm_seed_account_permissions(v_id);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- RLS
--
-- Members may read the defaults (the UI needs them to decide which controls to
-- show — the SERVER still decides). An override names a person, so only that
-- person and the workspace's owner/admins can read it.
-- ---------------------------------------------------------------------------

alter table public.crm_account_role_defaults enable row level security;
drop policy if exists crm_account_role_defaults_select_member on public.crm_account_role_defaults;
create policy crm_account_role_defaults_select_member on public.crm_account_role_defaults
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

alter table public.crm_account_permission_overrides enable row level security;
drop policy if exists crm_account_permission_overrides_select on public.crm_account_permission_overrides;
create policy crm_account_permission_overrides_select on public.crm_account_permission_overrides
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.workspace_role_of(workspace_id) in ('owner', 'admin')
    or public.is_admin()
  );

do $$
declare
  t text;
begin
  foreach t in array array['crm_account_role_defaults', 'crm_account_permission_overrides']
  loop
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role', t
    );
  end loop;
end
$$;

comment on table public.crm_account_role_defaults is
  'Editable per-role defaults for the nine account permissions. Owner is always granted and has no rows. Missing row = denied.';
comment on table public.crm_account_permission_overrides is
  'Per-member grants/denials of account permissions that win over the role default. Removed with the membership.';
