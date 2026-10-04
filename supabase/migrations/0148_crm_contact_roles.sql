-- ---------------------------------------------------------------------------
-- 0148 — Account workspace, step 5 of 6: a lead's role(s) at their account
--
-- A lead (crm_contacts) can hold several roles at once — a VP of Revenue Cycle
-- who signs AND champions is both — so this is a join table, not a column.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  A PERSON'S CHOICE IS NEVER OVERWRITTEN BY A KEYWORD.                     ║
-- ║                                                                           ║
-- ║  `is_auto` says which rows the classifier suggested. But "manually set"   ║
-- ║  is a property of the LEAD, not of a row: a seller who removes every      ║
-- ║  suggested role has made a choice, and it leaves no row behind to carry   ║
-- ║  `is_auto = false`. So crm_contact_role_state.manual_at records it, and   ║
-- ║  lib/crm/lead-roles.ts skips any lead that has it — on a title change, on ║
-- ║  a re-run, always.                                                        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- No column is added to crm_contacts (CLAUDE.md: the lead system stays as it is).
--
-- ⚠️ VALIDATE BEFORE APPLYING:
--   scripts/check-migration.sh supabase/migrations/0148_crm_contact_roles.sql \
--     supabase/migrations/smoke/0148_crm_contact_roles.smoke.sql
--
-- ROLLBACK (no existing table is modified):
--   drop table if exists public.crm_contact_role_state, public.crm_contact_role_assignments;
-- ---------------------------------------------------------------------------

create table if not exists public.crm_contact_role_assignments (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id   uuid not null,
  role_id      uuid not null,
  is_auto      boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,

  primary key (contact_id, role_id),

  constraint crm_contact_role_assignments_contact_fk
    foreign key (contact_id, workspace_id)
    references public.crm_contacts (id, workspace_id)
    on delete cascade,
  -- RESTRICT: a role leads still hold is disabled, not deleted.
  constraint crm_contact_role_assignments_role_fk
    foreign key (role_id, workspace_id)
    references public.crm_lead_roles (id, workspace_id)
    on delete restrict
);

create index if not exists crm_contact_role_assignments_role_idx
  on public.crm_contact_role_assignments (workspace_id, role_id);

create table if not exists public.crm_contact_role_state (
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  contact_id          uuid primary key,
  -- Set the first time a person edits this lead's roles; the classifier then
  -- leaves the lead alone for good.
  manual_at           timestamptz,
  manual_by           uuid references auth.users(id) on delete set null,
  -- The title the current automatic roles were derived from, so a re-run can
  -- tell "title changed" from "nothing to do".
  auto_title          text,
  auto_classified_at  timestamptz,

  constraint crm_contact_role_state_contact_fk
    foreign key (contact_id, workspace_id)
    references public.crm_contacts (id, workspace_id)
    on delete cascade
);

do $$
declare
  t text;
begin
  foreach t in array array['crm_contact_role_assignments', 'crm_contact_role_state']
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

comment on table public.crm_contact_role_assignments is
  'A lead''s roles at their account (several allowed). is_auto marks classifier suggestions.';
comment on table public.crm_contact_role_state is
  'Per-lead classifier state. manual_at set → auto-classification never touches this lead again.';
