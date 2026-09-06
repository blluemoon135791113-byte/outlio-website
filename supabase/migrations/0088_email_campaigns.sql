-- 0088 — campaigns, sequences and enrollments (M6 Phase 15)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  STEP STATE LIVES ON THE ENROLLMENT, NEVER ON THE CONTACT.               ║
-- ║                                                                           ║
-- ║  The constitution names this one directly: "no per-step fields on Contact ║
-- ║  (no `email_1_sent`)". The reason is not tidiness. A contact is ONE real  ║
-- ║  person who may be in three sequences at once, and columns like           ║
-- ║  `email_2_sent_at` can only describe one of them. The moment a second     ║
-- ║  campaign touches that person, every such column is ambiguous — and the   ║
-- ║  usual "fix" is to duplicate the contact, which destroys the canonical    ║
-- ║  identity the whole CRM is built on.                                     ║
-- ║                                                                           ║
-- ║  So: one row per (contact, campaign) enrollment, carrying its own step    ║
-- ║  pointer. A person in three sequences has three enrollments and still     ║
-- ║  exactly one contact record.                                             ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

do $$
begin
  /*
   * ⚠️ THESE ARE FOUR DIFFERENT PRODUCTS, NOT ONE WITH A LABEL.
   *
   * The brief insists they have "distinct behaviors, not one code path", and
   * the differences are real: a marketing broadcast MUST carry a one-click
   * unsubscribe and must NOT stop when someone replies (a reply to a
   * newsletter is not an objection). A sales sequence MUST stop on reply and
   * must not re-enroll someone mid-flight. Collapsing them into one engine
   * with feature flags is how a broadcast ends up silently halting, or a
   * sequence keeps mailing someone who already answered.
   *
   * The behaviours are enforced in `lib/email/campaign-policy.ts`; this enum
   * only names them.
   */
  if not exists (select 1 from pg_type where typname = 'email_campaign_type') then
    create type public.email_campaign_type as enum (
      'sales_sequence',
      'marketing_broadcast',
      'flow_driven',
      'manual'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'email_campaign_status') then
    create type public.email_campaign_status as enum (
      'draft', 'scheduled', 'running', 'paused', 'stopped', 'completed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'email_enrollment_status') then
    create type public.email_enrollment_status as enum (
      'active', 'paused', 'completed', 'stopped'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'email_stop_reason') then
    create type public.email_stop_reason as enum (
      'replied',
      'unsubscribed',
      'bounced',
      'complained',
      'suppressed',
      'manual',
      'campaign_stopped',
      -- The contact reached a goal the campaign was chasing (booked a call,
      -- opened an opportunity). Distinct from `replied` because it is a
      -- SUCCESS, and a report that conflates them cannot show a win rate.
      'goal_met'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- email_campaigns
-- ---------------------------------------------------------------------------

create table if not exists public.email_campaigns (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,

  name           text not null check (length(trim(name)) between 1 and 200),
  type           public.email_campaign_type not null,
  status         public.email_campaign_status not null default 'draft',

  -- The mailbox to send from. `restrict` so a campaign's history cannot be
  -- orphaned by disconnecting an account.
  account_id     uuid references public.email_accounts(id) on delete restrict,

  /*
   * ⚠️ THE TIMEZONE OF THE CAMPAIGN, NOT THE MAILBOX. A campaign aimed at one
   * market has a sending rhythm of its own; the mailbox's window still applies
   * on top, so this narrows rather than widens.
   */
  timezone       text,

  scheduled_at   timestamptz,
  started_at     timestamptz,
  completed_at   timestamptz,

  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index if not exists email_campaigns_workspace_status_idx
  on public.email_campaigns (workspace_id, status)
  where deleted_at is null;

drop trigger if exists email_campaigns_set_updated_at on public.email_campaigns;
create trigger email_campaigns_set_updated_at
  before update on public.email_campaigns
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- email_sequence_steps
-- ---------------------------------------------------------------------------

create table if not exists public.email_sequence_steps (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  campaign_id    uuid not null references public.email_campaigns(id) on delete cascade,

  -- 0-based, contiguous. Enforced by the unique index below.
  step_index     integer not null check (step_index >= 0),

  /*
   * ⚠️ THE WAIT IS BEFORE THE STEP, NOT AFTER IT. Storing "wait after sending"
   * makes the first step's wait meaningless and the last step's wait dead
   * data. "Wait this long, then send" composes: step 0 with wait 0 sends
   * immediately, and inserting a step never changes the meaning of its
   * neighbours.
   */
  wait_hours     integer not null default 0 check (wait_hours >= 0),

  subject        text not null,
  body_text      text not null,
  body_html      text,

  /*
   * Per-step override. NULL means "inherit the campaign's policy", which is
   * the type's default — so a sales sequence stops on reply everywhere without
   * anyone setting a flag on each step.
   */
  stop_on_reply  boolean,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists email_sequence_steps_order_idx
  on public.email_sequence_steps (campaign_id, step_index);

drop trigger if exists email_sequence_steps_set_updated_at on public.email_sequence_steps;
create trigger email_sequence_steps_set_updated_at
  before update on public.email_sequence_steps
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- email_enrollments
-- ---------------------------------------------------------------------------

create table if not exists public.email_enrollments (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  campaign_id       uuid not null references public.email_campaigns(id) on delete cascade,
  contact_id        uuid not null references public.crm_contacts(id) on delete cascade,

  /*
   * ⚠️ THE ADDRESS IS FROZEN AT ENROLLMENT. A contact may have several
   * addresses and may change them; the campaign must keep mailing the one it
   * started with, or a mid-sequence edit silently redirects step 3 to a
   * different mailbox from steps 1 and 2.
   */
  to_email          text not null check (to_email = lower(to_email)),

  status            public.email_enrollment_status not null default 'active',

  -- The step to send NEXT. 0 means nothing has gone out yet.
  current_step      integer not null default 0 check (current_step >= 0),
  next_action_at    timestamptz,

  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  stopped_at        timestamptz,
  stop_reason       public.email_stop_reason,

  -- Set when a reply arrives, so reporting can attribute the stop.
  replied_at        timestamptz,
  last_sent_at      timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  /*
   * ⚠️ A STOPPED ENROLLMENT MUST SAY WHY. "It stopped" with no reason is
   * unanswerable when a customer asks why a prospect went quiet, and it makes
   * criterion 5's reconciliation impossible: a stop with no reason cannot be
   * counted in any bucket.
   */
  constraint email_enrollments_stop_reason_required
    check (status <> 'stopped' or stop_reason is not null)
);

/*
 * ⚠️ ONE ACTIVE ENROLLMENT PER CONTACT PER CAMPAIGN.
 *
 * Partial on the live statuses so a person CAN be re-enrolled after a campaign
 * finished with them — re-enrollment is a legitimate decision — but cannot be
 * enrolled twice at once, which would send every step twice.
 */
create unique index if not exists email_enrollments_one_active_idx
  on public.email_enrollments (campaign_id, contact_id)
  where status in ('active', 'paused');

-- The scheduler's read: who is due next.
create index if not exists email_enrollments_due_idx
  on public.email_enrollments (next_action_at)
  where status = 'active';

create index if not exists email_enrollments_contact_idx
  on public.email_enrollments (contact_id, status);

create index if not exists email_enrollments_campaign_idx
  on public.email_enrollments (campaign_id, status);

-- Reply sync matches an inbound address back to live enrollments.
create index if not exists email_enrollments_email_idx
  on public.email_enrollments (workspace_id, to_email)
  where status in ('active', 'paused');

drop trigger if exists email_enrollments_set_updated_at on public.email_enrollments;
create trigger email_enrollments_set_updated_at
  before update on public.email_enrollments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Link messages to their enrollment and step.
--
-- `email_messages` already carries campaign_id / sequence_id / step_index as
-- reserved nullable columns (0086). Now they get a real referent.
-- ---------------------------------------------------------------------------

alter table public.email_messages
  add column if not exists enrollment_id uuid references public.email_enrollments(id) on delete set null;

create index if not exists email_messages_enrollment_idx
  on public.email_messages (enrollment_id)
  where enrollment_id is not null;

-- ---------------------------------------------------------------------------
-- stop_enrollments_for_email
--
-- ⚠️ ONE STATEMENT, BECAUSE A REPLY MUST STOP EVERY SEQUENCE AT ONCE.
--
-- M6 criterion 1 is that a reply stops the sequence within one sync cycle. A
-- person who replies to one campaign has answered; continuing to mail them
-- from a second sequence is the behaviour that makes people hate outbound.
-- Doing it row-by-row in application code would leave a window where step 3 of
-- another sequence goes out between the two updates.
-- ---------------------------------------------------------------------------

create or replace function public.stop_enrollments_for_email(
  p_workspace_id uuid,
  p_email        text,
  p_reason       public.email_stop_reason,
  p_campaign_id  uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.email_enrollments e
     set status      = 'stopped',
         stopped_at  = now(),
         stop_reason = p_reason,
         replied_at  = case when p_reason = 'replied' then now() else e.replied_at end,
         next_action_at = null
   where e.workspace_id = p_workspace_id
     and e.to_email = lower(p_email)
     and e.status in ('active', 'paused')
     and (p_campaign_id is null or e.campaign_id = p_campaign_id);

  get diagnostics v_count = row_count;

  /*
   * ⚠️ QUEUED MESSAGES ARE CANCELLED IN THE SAME CALL. Stopping the enrollment
   * is not enough: a message already sitting in `email_messages` with a future
   * scheduled_at would still be claimed and sent, which is precisely the
   * "they replied and got another email anyway" failure.
   */
  update public.email_messages m
     set status = 'cancelled',
         error_code = 'ENROLLMENT_STOPPED',
         error_message = 'The sequence stopped before this message was sent.'
    from public.email_enrollments e
   where m.enrollment_id = e.id
     and m.status = 'queued'
     and e.workspace_id = p_workspace_id
     and e.to_email = lower(p_email)
     and e.status = 'stopped'
     and (p_campaign_id is null or e.campaign_id = p_campaign_id);

  return v_count;
end;
$$;

revoke all on function public.stop_enrollments_for_email(uuid, text, public.email_stop_reason, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['email_campaigns', 'email_sequence_steps', 'email_enrollments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_member', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_workspace_member(workspace_id) or public.is_admin())',
      t || '_select_member', t
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end
$$;

comment on table public.email_enrollments is
  'One row per contact per campaign. Step state lives HERE and never on the '
  'contact: a person may be in three sequences at once, and a column like '
  'email_2_sent_at could only describe one of them.';

comment on function public.stop_enrollments_for_email(uuid, text, public.email_stop_reason, uuid) is
  'Stops every live enrollment for an address AND cancels its queued messages, '
  'in one call. Stopping the enrollment alone would still let an already-queued '
  'message go out after the person replied.';
