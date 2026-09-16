-- ---------------------------------------------------------------------------
-- 0135 — LinkedIn campaigns, and the honest partial.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  §7.5 PHASE 18: "campaigns on an async operation ledger, reconciled — a   ║
-- ║  vendor outage must surface as a visible partial, never a silent one."    ║
-- ║                                                                           ║
-- ║  ⚠️ THERE IS NO VENDOR, AND THAT MAKES THE REQUIREMENT HARDER RATHER THAN ║
-- ║  SOFTER. Outlio never calls LinkedIn (rule 1): a human performs every     ║
-- ║  action in LinkedIn's own interface and comes back to say what happened.  ║
-- ║                                                                           ║
-- ║  So the thing an email campaign learns from an API response — did it      ║
-- ║  send? — is here a claim a person makes, or fails to make. The ledger     ║
-- ║  already models that: `OUTCOME_UNKNOWN` is distinct from `FAILED` and     ║
-- ║  keeps its quota slot, because an action we cannot rule out having        ║
-- ║  happened has to keep counting.                                          ║
-- ║                                                                           ║
-- ║  A campaign therefore CANNOT report a clean total. It reports what is     ║
-- ║  confirmed, what is outstanding, and what nobody can say — and the third  ║
-- ║  bucket is the one this phase exists to keep visible.                    ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ `linkedin_enrollments` AND `linkedin_tasks` ARE ALREADY THE LEDGER. This
-- adds the grouping and nothing else: no second copy of state, no per-campaign
-- counters. A stored count is a number that can disagree with the rows it
-- summarises, and the rows are the only thing an operator actually changed.
-- ---------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'linkedin_campaign_state') then
    /*
     * ⚠️ NO 'COMPLETED'. A campaign whose enrollments have all ended is
     * FINISHED — a word that does not imply every action succeeded. "Completed"
     * invites a reader to assume the work was done, and with OUTCOME_UNKNOWN in
     * the mix that is precisely the assumption nobody is entitled to make.
     *
     * ARCHIVED is separate from FINISHED so that putting a campaign away is not
     * a claim about how it went.
     */
    create type public.linkedin_campaign_state as enum (
      'DRAFT',
      'ACTIVE',
      'PAUSED',
      'FINISHED',
      'ARCHIVED'
    );
  end if;
end $$;

create table if not exists public.linkedin_campaigns (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  name         text not null check (length(btrim(name)) between 1 and 200),
  state        public.linkedin_campaign_state not null default 'DRAFT',

  /*
   * ⚠️ THE SENDER IS ON THE ENROLLMENT, NOT HERE, AND THAT IS DELIBERATE.
   * 0132 fixes a sender per enrollment because §4.10's budgets are per account
   * and "moving mid-sequence would make a conversation arrive from two
   * different people". A campaign-level sender would either duplicate that or
   * contradict it; a campaign may legitimately span several senders.
   */

  created_by   uuid not null references auth.users(id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  /*
   * ⚠️ WHEN IT WAS LAST RECONCILED, NOT WHAT THE RESULT WAS. The counts are
   * derived on read; storing them here would let a stale number outlive the
   * rows it came from. This records only that somebody looked.
   */
  reconciled_at timestamptz
);

create index if not exists linkedin_campaigns_workspace_idx
  on public.linkedin_campaigns (workspace_id, state);

/*
 * ⚠️ NULLABLE, BECAUSE ENROLLMENTS ALREADY EXIST WITHOUT ONE. Phase 10 shipped
 * enrolment from the contact page, and those are real records. A NOT NULL
 * column would fail to apply, and a backfill inventing a campaign for them
 * would invent a campaign nobody ran.
 *
 * `on delete set null`: deleting a campaign must not delete the history of what
 * was done to people under it. The enrolment outlives its grouping.
 */
alter table public.linkedin_enrollments
  add column if not exists campaign_id uuid
    references public.linkedin_campaigns(id) on delete set null;

create index if not exists linkedin_enrollments_campaign_idx
  on public.linkedin_enrollments (campaign_id)
  where campaign_id is not null;

alter table public.linkedin_campaigns enable row level security;

/*
 * Read-only to members of the workspace, matching `linkedin_enrollments`.
 * Every write goes through a server action that gates first; the service role
 * bypasses RLS and scopes by `workspace_id` in code.
 */
do $$ begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'linkedin_campaigns'
       and policyname = 'linkedin_campaigns_select_members'
  ) then
    create policy linkedin_campaigns_select_members
      on public.linkedin_campaigns
      for select to authenticated
      using (
        exists (
          select 1 from public.workspace_memberships m
           where m.workspace_id = linkedin_campaigns.workspace_id
             and m.user_id = auth.uid()
        )
      );
  end if;
end $$;

drop trigger if exists linkedin_campaigns_set_updated_at on public.linkedin_campaigns;
create trigger linkedin_campaigns_set_updated_at
  before update on public.linkedin_campaigns
  for each row
  execute function public.set_updated_at();

comment on table public.linkedin_campaigns is
  'Groups LinkedIn enrollments. Holds NO counts: progress is derived from '
  'linkedin_enrollments and linkedin_tasks on read, because a stored total can '
  'disagree with the rows an operator actually changed (0135).';

comment on column public.linkedin_campaigns.reconciled_at is
  'When progress was last computed, never what it said. A cached verdict would '
  'outlive the rows behind it.';
