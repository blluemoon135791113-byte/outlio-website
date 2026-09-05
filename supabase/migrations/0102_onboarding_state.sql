-- 0102 — first-run state (M9, onboarding)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  ONE COLUMN OF STATE, BECAUSE PROGRESS IS DERIVED AND NOT STORED.        ║
-- ║                                                                           ║
-- ║  The obvious design is a `completed_steps` array written as someone       ║
-- ║  clicks through. It rots immediately: a workspace that imported contacts  ║
-- ║  and then deleted them still reads as "contacts: done", and the checklist ║
-- ║  tells the customer they have finished something they demonstrably have   ║
-- ║  not. Worse, the two can never be reconciled -- nothing knows whether the ║
-- ║  flag or the data is right.                                               ║
-- ║                                                                           ║
-- ║  So every step is derived from the real thing it is about: contacts exist ║
-- ║  or they do not, a mailbox is connected or it is not. That is always true ║
-- ║  by construction and needs no backfill, no migration when a step changes, ║
-- ║  and no repair job.                                                       ║
-- ║                                                                           ║
-- ║  ⚠️ THE ONE THING THAT CANNOT BE DERIVED IS "I DO NOT WANT THIS".        ║
-- ║  Dismissal is a human intention with no trace in the data, so it is the   ║
-- ║  only thing stored here.                                                  ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.workspace_onboarding_state (
  workspace_id  uuid primary key references public.workspaces(id) on delete cascade,

  /*
   * Null means "still showing". Set when someone dismisses the checklist.
   * Dismissal hides it; it never claims the steps were completed.
   */
  dismissed_at  timestamptz,
  dismissed_by  uuid references auth.users(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists workspace_onboarding_set_updated_at on public.workspace_onboarding_state;
create trigger workspace_onboarding_set_updated_at
  before update on public.workspace_onboarding_state
  for each row execute function public.set_updated_at();

alter table public.workspace_onboarding_state enable row level security;

/*
 * Readable by any member -- the checklist is shown to everyone in the
 * workspace, so hiding its state from them would mean the UI could not render
 * without a service-role round trip on every page.
 */
drop policy if exists workspace_onboarding_select_member on public.workspace_onboarding_state;
create policy workspace_onboarding_select_member on public.workspace_onboarding_state
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

/*
 * ⚠️ WRITES GO THROUGH THE SERVER, not straight from the browser. Dismissing
 * is harmless, but it is still a workspace-wide change: one member hides the
 * checklist for everyone. The server action checks the role first.
 */
revoke all on table public.workspace_onboarding_state from anon;
grant select on table public.workspace_onboarding_state to authenticated;
grant select, insert, update, delete
  on table public.workspace_onboarding_state to service_role;

comment on table public.workspace_onboarding_state is
  'First-run checklist state. Only DISMISSAL is stored -- step completion is '
  'derived from the real data each time, so it cannot disagree with reality.';
