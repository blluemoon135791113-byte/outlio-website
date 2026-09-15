-- ---------------------------------------------------------------------------
-- 0133 — the opener and the pitch a rep writes for one prospect.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  Owner, 2026-09-15: "the user or the assigned person can add his or her   ║
-- ║  opener dm and a pitch dm in the pipeline section for each prospect and   ║
-- ║  then ai can analyze and when the user hit dm or strategy analysis it can ║
-- ║  get back with whats working and whats not and what to go with".         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ THIS IS NOT THE SAME THING AS A WORKFLOW STEP'S BODY, AND CONFLATING THEM
-- WOULD BREAK THE ANALYSIS THAT IS THE WHOLE POINT.
--
--   A step body is the campaign's copy: one message, applied to everybody in
--   that campaign, written once.
--
--   These are per-prospect: what THIS rep decided to say to THIS person. Two
--   reps working the same campaign write different openers, and the question
--   "what is working" is largely a question about that difference.
--
-- Storing them on `linkedin_workflow_steps` would force one row per prospect per
-- campaign and lose the authorship. Storing them as free text on `crm_contacts`
-- would lose the kind and the author too.
--
-- ⚠️ AND NOT THE SAME AS WHAT WAS SENT EITHER. `linkedin_tasks.body` records the
-- message actually prepared for a card, resolved per contact. These are the
-- rep's INTENT — the strategy they are choosing. The analysis reads both, and a
-- schema that could not tell them apart could not say whether a reply followed
-- the plan or a deviation from it.
-- ---------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'linkedin_prospect_message_kind') then
    /*
     * ⚠️ TWO VALUES, AND `FOLLOW_UP` IS ABSENT ON PURPOSE. The owner named an
     * opener and a pitch. Follow-ups already exist as workflow steps and as
     * task bodies, so adding a third value here would create a second place to
     * write the same thing — and the analysis would then have to decide which
     * copy was real.
     */
    create type public.linkedin_prospect_message_kind as enum ('OPENER', 'PITCH');
  end if;
end $$;

create table if not exists public.linkedin_prospect_messages (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  /*
   * ⚠️ `on delete cascade`. Unlike a workflow step, this row is ABOUT the
   * contact rather than pointed at by them — it has no meaning once the person
   * is gone, and §6.4's erasure must be able to remove it without a second
   * statement remembering that this table exists.
   */
  contact_id   uuid not null references public.crm_contacts(id) on delete cascade,

  kind         public.linkedin_prospect_message_kind not null,

  /*
   * ⚠️ NOT NULL AND NON-EMPTY. An empty draft is indistinguishable from no
   * draft, and the analysis counting blank rows as "this rep wrote an opener"
   * would make its per-rep comparison meaningless. Deleting the row is how you
   * say you have not written one.
   */
  body         text not null check (length(btrim(body)) between 1 and 8000),

  /*
   * ⚠️ WHO WROTE IT, AND IT IS LOAD-BEARING RATHER THAN AUDIT TRIM. The owner
   * wants a report "for each assigned users and overall as well", so the
   * grouping key has to be stored at write time. Deriving it later from
   * `crm_contacts.owner_user_id` would attribute a message to whoever owns the
   * contact TODAY — reassign a book of leads and every past message silently
   * changes author.
   *
   * `on delete restrict`: a departing rep's messages are the evidence their
   * numbers were based on. §6.4 erases SUBJECTS, not staff.
   */
  authored_by  uuid not null references auth.users(id) on delete restrict,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

/*
 * ⚠️ ONE OPENER AND ONE PITCH PER PROSPECT. The owner described exactly two
 * messages, and a history table would be a different feature with a different
 * question behind it ("how did this rep's approach change") — worth building
 * when asked for, not guessed at now.
 *
 * Scoped by workspace as well as contact: a contact belongs to one workspace, so
 * this is redundant for correctness and necessary for the index to serve the
 * workspace-scoped reads every query here performs.
 */
create unique index if not exists linkedin_prospect_messages_one_per_kind_idx
  on public.linkedin_prospect_messages (workspace_id, contact_id, kind);

/*
 * The analysis reads a whole workspace's messages grouped by author, so the
 * index it needs leads with the author rather than the contact.
 */
create index if not exists linkedin_prospect_messages_author_idx
  on public.linkedin_prospect_messages (workspace_id, authored_by);

alter table public.linkedin_prospect_messages enable row level security;

/*
 * Read-only to workspace members, matching `linkedin_campaigns` and
 * `linkedin_workflow_steps`. Every write goes through a server action that
 * gates first; the service role bypasses RLS and scopes by workspace in code.
 */
do $$ begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'linkedin_prospect_messages'
       and policyname = 'linkedin_prospect_messages_select_members'
  ) then
    create policy linkedin_prospect_messages_select_members
      on public.linkedin_prospect_messages
      for select to authenticated
      using (
        exists (
          select 1 from public.workspace_memberships m
           where m.workspace_id = linkedin_prospect_messages.workspace_id
             and m.user_id = auth.uid()
        )
      );
  end if;
end $$;

drop trigger if exists linkedin_prospect_messages_set_updated_at
  on public.linkedin_prospect_messages;
create trigger linkedin_prospect_messages_set_updated_at
  before update on public.linkedin_prospect_messages
  for each row
  execute function public.set_updated_at();

comment on table public.linkedin_prospect_messages is
  'The opener and pitch one rep wrote for one prospect. Distinct from a '
  'workflow step body (campaign-wide copy) and from linkedin_tasks.body (what '
  'was actually prepared) — the analysis compares all three (0133).';

comment on column public.linkedin_prospect_messages.authored_by is
  'Stored at write time, never derived from the contact owner: reassigning a '
  'book of leads must not silently rewrite who said what.';
