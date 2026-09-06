-- 0047 — attach a qualification profile to a research run
--
-- Which ICP a run was scored against is part of the run's identity: the same
-- research scored against two profiles gives two different qualified lists, and
-- a result nobody can trace back to a profile cannot be explained or reproduced.

alter table public.research_runs
  add column if not exists qualification_profile_id uuid;

-- Single-column FK, deliberately.
--
-- A composite `(qualification_profile_id, user_id)` reference would be the
-- stricter tenant guard, but ON DELETE SET NULL nulls EVERY referencing column
-- — including `user_id`, which is NOT NULL — so the delete would fail. The
-- column-scoped form, `ON DELETE SET NULL (qualification_profile_id)`, is
-- Postgres 15+ only and this migration is pasted by hand into an environment
-- whose exact version is not pinned here.
--
-- Cross-tenant safety therefore comes from `lib/intelligence/run.ts` loading
-- the profile with `getProfile(userId, …)`, which is the same rule every
-- service-role query in this codebase follows. Deleting a profile must not
-- delete the research history that was scored with it.
do $$ begin
  alter table public.research_runs
    add constraint research_runs_qualification_profile_fk
    foreign key (qualification_profile_id)
    references public.qualification_profiles(id)
    on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists research_runs_profile_idx
  on public.research_runs (qualification_profile_id);

comment on column public.research_runs.qualification_profile_id is
  'The ICP this run was scored against. NULL means research only, no scoring.';
