-- ---------------------------------------------------------------------------
-- Account list jobs
-- ---------------------------------------------------------------------------
--
-- Account lists reuse `extraction_jobs` rather than getting a table of their
-- own. The queue, `claim_next_job`, `FOR UPDATE SKIP LOCKED`, attempt counts,
-- backoff and the stale-claim reaper are the hard parts of this pipeline and
-- are already correct here. A parallel `account_jobs` table would duplicate
-- every one of them and drift.
--
-- What differs is only the OUTPUT: a lead job yields people, an account job
-- yields companies, so the counters cannot share columns. Reporting "25 leads
-- kept" for a run that produced 25 companies would be a lie in the one place a
-- user checks what a run did.

alter table public.extraction_jobs
  add column if not exists kind text not null default 'lead_search',
  add column if not exists accounts_parsed int not null default 0,
  add column if not exists accounts_created int not null default 0,
  add column if not exists accounts_matched int not null default 0,
  add column if not exists accounts_unidentified int not null default 0;

-- ⚠️ THE DEFAULT IS `lead_search`, WHICH IS CORRECT FOR EVERY EXISTING ROW.
-- Account lists could not be ingested before this migration, so no historical
-- job can be one. A nullable column would have forced every reader to handle
-- "unknown kind", which is a state that has never existed.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'extraction_jobs_kind_check'
  ) then
    alter table public.extraction_jobs
      add constraint extraction_jobs_kind_check
      check (kind in ('lead_search', 'account_list'));
  end if;
end $$;

comment on column public.extraction_jobs.kind is
  'What this run ingests. lead_search yields people; account_list yields '
  'companies. Set by the worker from the detected page type, never by the '
  'client — the browser does not know what is inside the file it uploaded.';

comment on column public.extraction_jobs.accounts_unidentified is
  'Account rows carrying nothing that identifies a company. Recorded rather '
  'than dropped so "25 rows in, 18 companies out" is explainable.';

-- Counting a tenant's account runs without scanning their lead runs.
create index if not exists extraction_jobs_user_kind_idx
  on public.extraction_jobs (user_id, kind, created_at desc);
