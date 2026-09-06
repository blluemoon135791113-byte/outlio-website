-- 0086 — the message engine (M5 Phase 14)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  AT-MOST-ONCE, DELIBERATELY. THIS IS THE CENTRAL DECISION OF THE PHASE.   ║
-- ║                                                                           ║
-- ║  Exactly-once delivery is not achievable across a network boundary. The   ║
-- ║  choice is really between:                                                ║
-- ║                                                                           ║
-- ║    at-least-once  — retry when unsure. Needs provider-side dedupe to be   ║
-- ║                     safe, and SMTP HAS NO DEDUPE VERB. Hand the same      ║
-- ║                     message to the same server twice and it is delivered  ║
-- ║                     twice, identical Message-ID or not (proven in         ║
-- ║                     tests/integration/email-smtp.test.ts).                ║
-- ║                                                                           ║
-- ║    at-most-once   — never retry when unsure. A message may be lost.       ║
-- ║                                                                           ║
-- ║  For COLD OUTBOUND the costs are wildly asymmetric. A duplicate email is  ║
-- ║  a prospect who marks you as spam, a domain reputation hit, and a         ║
-- ║  complaint rate that threatens every other mailbox on that domain. A      ║
-- ║  missed email is recoverable — the sequence's next step goes out anyway.  ║
-- ║                                                                           ║
-- ║  So a message whose claim expires mid-flight goes to `needs_verification` ║
-- ║  and is NEVER automatically requeued. That is what makes "kill and retry  ║
-- ║  produces exactly one delivered message" (M5 criterion 3) true: the       ║
-- ║  retry finds the row already out of the queue and does not re-send it.    ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'email_message_status') then
    create type public.email_message_status as enum (
      'queued',
      'sending',
      'sent',
      'failed',
      'cancelled',
      -- ⚠️ TERMINAL AND MANUAL. The worker died between handing the message to
      -- the provider and recording the result, so whether it was delivered is
      -- genuinely unknown. Requeueing would risk a duplicate; marking it sent
      -- would fabricate a delivery. A human decides.
      'needs_verification',
      -- Never left the queue: the recipient was suppressed.
      'suppressed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'email_suppression_reason') then
    create type public.email_suppression_reason as enum (
      'unsubscribed',
      'hard_bounce',
      'complaint',
      'manual',
      'invalid_address'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- email_suppressions
--
-- ⚠️ CHECKED BEFORE EVERY SEND, INCLUDING TRANSACTIONAL ONES. A person who
-- asked not to be contacted did not ask "except when the email is important".
-- ---------------------------------------------------------------------------

create table if not exists public.email_suppressions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,

  -- Lowercased by the app. The unique index below is what actually enforces
  -- one suppression per address per workspace.
  email         text not null check (email = lower(email)),
  reason        public.email_suppression_reason not null,

  -- Free-text provenance: the campaign, the bounce code, the admin who added
  -- it. Never the message body.
  source        text,
  contact_id    uuid references public.crm_contacts(id) on delete set null,

  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null
);

create unique index if not exists email_suppressions_workspace_email_idx
  on public.email_suppressions (workspace_id, email);

alter table public.email_suppressions enable row level security;

drop policy if exists email_suppressions_select_member on public.email_suppressions;
create policy email_suppressions_select_member on public.email_suppressions
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

revoke all on table public.email_suppressions from public, anon, authenticated;
grant select on table public.email_suppressions to authenticated;
grant select, insert, update, delete on table public.email_suppressions to service_role;

comment on table public.email_suppressions is
  'Do-not-contact list, checked before EVERY send. There is no transactional '
  'exception: a person who unsubscribed did not ask to still receive the '
  'important ones.';

-- ---------------------------------------------------------------------------
-- email_messages
-- ---------------------------------------------------------------------------

create table if not exists public.email_messages (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,

  -- ⚠️ `on delete restrict`: a sent message must keep pointing at the mailbox
  -- that sent it. Disconnecting an account soft-deletes it precisely so this
  -- history survives.
  account_id          uuid not null references public.email_accounts(id) on delete restrict,
  contact_id          uuid references public.crm_contacts(id) on delete set null,

  -- Campaign/sequence/step are reserved for M6 and intentionally nullable, so
  -- Phase 14 can send without a campaign existing yet.
  campaign_id         uuid,
  sequence_id         uuid,
  step_index          integer,

  to_email            text not null check (to_email = lower(to_email)),

  /*
   * ⚠️ IMMUTABLE AFTER SEND, ENFORCED BY TRIGGER BELOW.
   *
   * M6 criterion 3 is that editing a template never mutates previously sent
   * message history. The cheapest way to guarantee that is to make the sent
   * row physically unwritable rather than to rely on every future code path
   * remembering not to touch it.
   */
  subject             text not null,
  body_text           text not null,
  body_html           text,

  status              public.email_message_status not null default 'queued',

  /*
   * ⚠️ THE IDEMPOTENCY KEY IS THE WHOLE GUARANTEE.
   *
   * Unique per workspace, so a caller that enqueues the same logical message
   * twice — a retried API call, a re-run flow step — gets one row and one
   * send. The engine never generates this: the CALLER supplies it, because
   * only the caller knows what "the same message" means.
   */
  idempotency_key     text not null,

  scheduled_at        timestamptz not null default now(),
  attempts            integer not null default 0,
  max_attempts        integer not null default 3,

  -- Claim bookkeeping. `claim_expires_at` is what the reaper reads.
  claimed_by          text,
  claimed_at          timestamptz,
  claim_expires_at    timestamptz,

  sent_at             timestamptz,
  provider_message_id text,
  thread_id           text,

  -- Stable code plus customer-safe text. Never a raw provider response.
  error_code          text,
  error_message       text,

  suppression_reason  public.email_suppression_reason,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists email_messages_idempotency_idx
  on public.email_messages (workspace_id, idempotency_key);

-- The queue read: due, still queued, ordered by when they were meant to go.
create index if not exists email_messages_due_idx
  on public.email_messages (scheduled_at)
  where status = 'queued';

-- The reaper read.
create index if not exists email_messages_claim_expiry_idx
  on public.email_messages (claim_expires_at)
  where status = 'sending';

create index if not exists email_messages_account_sent_idx
  on public.email_messages (account_id, sent_at desc)
  where status = 'sent';

create index if not exists email_messages_workspace_status_idx
  on public.email_messages (workspace_id, status);

drop trigger if exists email_messages_set_updated_at on public.email_messages;
create trigger email_messages_set_updated_at
  before update on public.email_messages
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Sent messages are frozen.
-- ---------------------------------------------------------------------------

create or replace function public.email_messages_guard_sent()
returns trigger
language plpgsql
as $$
begin
  /*
   * Once a message has gone out, its content is a historical fact. Only the
   * fields that describe what happened AFTER sending may still change — the
   * provider id arriving late, or a human resolving a needs_verification row.
   */
  if old.status = 'sent' then
    if new.subject   is distinct from old.subject
    or new.body_text is distinct from old.body_text
    or new.body_html is distinct from old.body_html
    or new.to_email  is distinct from old.to_email
    or new.account_id is distinct from old.account_id
    or new.sent_at   is distinct from old.sent_at
    or new.idempotency_key is distinct from old.idempotency_key then
      raise exception
        'A sent email cannot be modified (message %).', old.id
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists email_messages_guard_sent on public.email_messages;
create trigger email_messages_guard_sent
  before update on public.email_messages
  for each row execute function public.email_messages_guard_sent();

-- ---------------------------------------------------------------------------
-- claim_email_messages
--
-- ⚠️ THE SUPPRESSION CHECK LIVES HERE, INSIDE THE CLAIM.
--
-- Putting it in application code before the claim would leave a window in
-- which someone unsubscribes between the check and the send. Doing it in the
-- same statement that removes the row from the queue closes that window: a
-- suppressed recipient is transitioned straight to `suppressed` and is never
-- handed to a worker at all.
-- ---------------------------------------------------------------------------

create or replace function public.claim_email_messages(
  p_claimed_by      text,
  p_limit           integer default 10,
  p_claim_seconds   integer default 120
)
returns table (
  message_id   uuid,
  workspace_id uuid,
  account_id   uuid,
  to_email     text,
  subject      text,
  body_text    text,
  body_html    text,
  thread_id    text,
  idempotency_key text,
  attempts     integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
begin
  -- Suppressed recipients leave the queue without ever being claimed.
  update public.email_messages m
     set status = 'suppressed',
         suppression_reason = s.reason,
         error_code = 'SUPPRESSED',
         error_message = 'This address is on the do-not-contact list.'
    from public.email_suppressions s
   where m.status = 'queued'
     and m.scheduled_at <= now()
     and s.workspace_id = m.workspace_id
     and s.email = m.to_email;

  select array_agg(q.id)
    into v_ids
    from (
      select m.id
        from public.email_messages m
       where m.status = 'queued'
         and m.scheduled_at <= now()
         and m.attempts < m.max_attempts
       order by m.scheduled_at
       for update skip locked
       limit greatest(p_limit, 1)
    ) q;

  if v_ids is null then
    return;
  end if;

  /*
   * ⚠️ `attempts` MUST BE QUALIFIED. `RETURNS TABLE` declares an OUT parameter
   * of the same name, so a bare reference is ambiguous and raises at RUNTIME
   * rather than at creation — the exact trap that shipped broken in 0072 and
   * had to be fixed in 0073.
   */
  update public.email_messages m
     set status           = 'sending',
         claimed_by       = p_claimed_by,
         claimed_at       = now(),
         claim_expires_at = now() + make_interval(secs => greatest(p_claim_seconds, 30)),
         attempts         = m.attempts + 1
   where m.id = any(v_ids);

  return query
    select m.id, m.workspace_id, m.account_id, m.to_email, m.subject,
           m.body_text, m.body_html, m.thread_id, m.idempotency_key, m.attempts
      from public.email_messages m
     where m.id = any(v_ids);
end;
$$;

revoke all on function public.claim_email_messages(text, integer, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- reap_expired_email_claims
--
-- ⚠️ MOVES TO `needs_verification`, NEVER BACK TO `queued`.
--
-- This function is the at-most-once guarantee made concrete. A message in
-- `sending` past its claim expiry was handed to a worker that died. We cannot
-- know whether the provider accepted it, and SMTP gives us no way to ask.
-- Requeueing would risk a duplicate cold email — a spam complaint and a
-- reputation hit. So it stops here and a human decides.
-- ---------------------------------------------------------------------------

create or replace function public.reap_expired_email_claims()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.email_messages
     set status = 'needs_verification',
         error_code = 'CLAIM_EXPIRED',
         error_message =
           'The sender stopped before confirming this message. It may or may not have been delivered, so Outlio did not retry it.'
   where status = 'sending'
     and claim_expires_at is not null
     and claim_expires_at < now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.reap_expired_email_claims()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.email_messages enable row level security;

drop policy if exists email_messages_select_member on public.email_messages;
create policy email_messages_select_member on public.email_messages
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

revoke all on table public.email_messages from public, anon, authenticated;
grant select on table public.email_messages to authenticated;
grant select, insert, update, delete on table public.email_messages to service_role;

comment on table public.email_messages is
  'Outbound mail. Content is immutable once status = sent. A message whose '
  'claim expires becomes needs_verification and is NEVER auto-requeued: SMTP '
  'has no dedupe, and a duplicate cold email costs more than a missed one.';

comment on function public.claim_email_messages(text, integer, integer) is
  'Claims due messages with FOR UPDATE SKIP LOCKED, suppressing do-not-contact '
  'recipients in the same call so nobody can unsubscribe inside the gap '
  'between a check and a send.';
