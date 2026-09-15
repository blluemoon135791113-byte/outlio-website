-- ---------------------------------------------------------------------------
-- 0129 — What was later seen to happen, recorded against a person.
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  §7.5 PHASE 19: "reuse the Phase 9 lesson — an inbound message is only a  ║
-- ║  reply if WE ACTUALLY CONTACTED THEM, or the same false-reply bug returns ║
-- ║  on a new channel."                                                       ║
-- ║                                                                           ║
-- ║  That bug is not hypothetical here. `email_events` still holds 261 rows   ║
-- ║  of which 254 ARE FALSE `replied` EVENTS — an entire mailbox recorded as  ║
-- ║  prospect replies against two messages ever sent. A naive reply rate      ║
-- ║  computes 254/2 and renders 12,700%.                                     ║
-- ║                                                                           ║
-- ║  ⚠️ THE LINKEDIN SHAPE IS DIFFERENT AND THE RISK IS NOT. Outlio never     ║
-- ║  reads linkedin.com (rule 1), so nothing is scanned and no mailbox can be ║
-- ║  mistaken for a conversation. A reply is a sentence a PERSON types into a ║
-- ║  form. The failure is therefore not a bad parser — it is a recorded claim ║
-- ║  about somebody we never messaged.                                        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ SEPARATE FROM `linkedin_tasks`, AND THAT SEPARATION IS THE POINT. 0125
-- already refuses an Observation as a task outcome, in the enum AND in the
-- service: `TaskOutcome` is what the operator DID, an Observation is what they
-- later SAW. Collapsing them lets "mark request sent" mark acceptance — and
-- acceptance gates the first DM, so the collapse sends a message into a
-- connection that was never made.
-- ---------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'linkedin_observation_kind') then
    /*
     * Mirrors `Observation` in `lib/linkedin/outcomes.ts`. The enum is the
     * second wall: the service refuses an unknown kind, and so does the column,
     * because a vocabulary enforced in one place is a vocabulary that drifts.
     */
    create type public.linkedin_observation_kind as enum (
      'CONNECTION_ACCEPTANCE_RECORDED',
      'INBOX_REVIEW_RECORDED',
      'REPLY_RECORDED',
      'MEETING_BOOKED_RECORDED',
      'MEETING_HELD_RECORDED'
    );
  end if;
end $$;

create table if not exists public.linkedin_observations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  contact_id    uuid not null references public.crm_contacts(id) on delete cascade,

  /*
   * ⚠️ NULLABLE, BECAUSE AN OBSERVATION IS ABOUT A PERSON, NOT A TASK. Somebody
   * may reply weeks after an enrolment ended, or to a message sent outside any
   * enrolment. Requiring a task would force the recorder to pick one, and a
   * picked-to-satisfy-the-schema link is a fact nobody established.
   */
  enrollment_id uuid references public.linkedin_enrollments(id) on delete set null,

  kind          public.linkedin_observation_kind not null,

  /*
   * ⚠️ WHAT MADE IT ACCEPTABLE, STORED WITH IT. `hasEverContacted` decides
   * whether a recorded reply is plausible; recording only the verdict would
   * leave a row nobody can re-examine when the rule changes. This says which
   * task was the evidence — or that the evidence was an unconfirmed one.
   */
  evidence_task_id uuid references public.linkedin_tasks(id) on delete set null,
  evidence_was_unconfirmed boolean not null default false,

  /** Free text the operator typed. Never parsed, never matched against. */
  note          text check (note is null or length(note) <= 2000),

  observed_at   timestamptz not null default now(),
  recorded_by   uuid not null references auth.users(id) on delete restrict,
  created_at    timestamptz not null default now()
);

create index if not exists linkedin_observations_contact_idx
  on public.linkedin_observations (workspace_id, contact_id, observed_at desc);

create index if not exists linkedin_observations_kind_idx
  on public.linkedin_observations (workspace_id, kind, observed_at desc);

/*
 * ⚠️ NO UNIQUE CONSTRAINT ON (contact, kind). A person can reply twice, and a
 * second reply is a real event. De-duplicating here would silently drop the
 * follow-up that said "actually, yes" after the one that said "not now".
 */

alter table public.linkedin_observations enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'linkedin_observations'
       and policyname = 'linkedin_observations_select_members'
  ) then
    create policy linkedin_observations_select_members
      on public.linkedin_observations
      for select to authenticated
      using (
        exists (
          select 1 from public.workspace_memberships m
           where m.workspace_id = linkedin_observations.workspace_id
             and m.user_id = auth.uid()
        )
      );
  end if;
end $$;

comment on table public.linkedin_observations is
  'What was later SEEN to happen to a contact on LinkedIn, recorded by a person. '
  'Never a task outcome: 0125 refuses Observations there because "mark request '
  'sent" must not be able to mark acceptance (0129).';

comment on column public.linkedin_observations.evidence_was_unconfirmed is
  'True when the only outreach that could have reached this person had '
  'OUTCOME_UNKNOWN. The reply is still recorded — §4.17 says an unknown outcome '
  'is one we cannot rule out having been received — but any metric built on '
  'these rows can exclude them rather than inheriting the doubt silently.';
