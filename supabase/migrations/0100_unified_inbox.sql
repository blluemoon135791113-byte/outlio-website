-- 0100 — the unified inbox (M8 Phase 26)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  REPLY SYNC ALREADY WORKS AND STORES NOTHING TO READ.                     ║
-- ║                                                                           ║
-- ║  `lib/email/reply-sync.ts` fetches inbound mail, classifies it, records a ║
-- ║  domain event, stops the sequence and writes a CRM activity -- and then   ║
-- ║  discards the message. That was right for M6, whose job was to STOP a     ║
-- ║  sequence when someone answers. An inbox needs the answer itself.         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ A SEPARATE TABLE FROM `email_messages`, NOT A `direction` COLUMN.
-- `email_messages` is the OUTBOUND QUEUE: it carries claim ownership, claim
-- expiry, attempts, idempotency keys and a send status, and the send worker
-- claims from it with FOR UPDATE SKIP LOCKED. Adding inbound rows to it would
-- mean every one of those queries needs `and direction = 'outbound'` forever,
-- and the first one that forgets either sends a received email back out or
-- stalls the queue behind rows no worker can ever complete.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'email_thread_status') then
    create type public.email_thread_status as enum ('open', 'resolved');
  end if;
  if not exists (select 1 from pg_type where typname = 'email_message_direction') then
    create type public.email_message_direction as enum ('inbound', 'outbound');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Threads
-- ---------------------------------------------------------------------------

create table if not exists public.email_threads (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  account_id    uuid not null references public.email_accounts(id) on delete cascade,

  /*
   * ⚠️ NULLABLE ON PURPOSE. Someone can reply from an address the CRM has
   * never seen -- a colleague CC'd in, a personal address, a forwarded thread.
   * Dropping it would lose a real reply; inventing a contact for it would
   * fabricate a record. It lands in the inbox unmatched, which is what the
   * "Unassigned" view is for.
   */
  contact_id    uuid references public.crm_contacts(id) on delete set null,

  /* The provider's own thread key. Unique per workspace: that is idempotency. */
  provider_thread_key text not null,

  subject       text,

  /*
   * ⚠️ DENORMALISED SO THE LIST QUERY STAYS ONE INDEXED SCAN. "Needs reply"
   * means the last message came in and nobody has answered -- derived per row
   * it is a correlated subquery over every message in every thread, which is
   * exactly the unbounded scan the brief forbids in a request path.
   */
  last_message_at  timestamptz not null default now(),
  last_direction   public.email_message_direction not null default 'inbound',
  message_count    integer not null default 0 check (message_count >= 0),

  status        public.email_thread_status not null default 'open',
  assigned_to   uuid references auth.users(id) on delete set null,

  /*
   * ⚠️ READ STATE IS SHARED, NOT PER-USER, and that is a product decision.
   * This is a TEAM inbox: "unread" should mean nobody has looked at it yet.
   * Per-user read state would make a shared queue of 100 threads show as 100
   * unread to each of five people, so the badge would measure attendance
   * rather than work outstanding. The cost is that "unread" cannot mean
   * "unread by me" -- if that is wanted later it is a join table, not a
   * change to this column.
   */
  read_at       timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint email_threads_provider_key_uniq unique (workspace_id, provider_thread_key)
);

/* The inbox list: newest first, within a workspace. */
create index if not exists email_threads_inbox_idx
  on public.email_threads (workspace_id, last_message_at desc, id desc);

/* "Mine" and the setter's own-data restriction. */
create index if not exists email_threads_assigned_idx
  on public.email_threads (workspace_id, assigned_to, last_message_at desc)
  where status = 'open';

create index if not exists email_threads_contact_idx
  on public.email_threads (workspace_id, contact_id)
  where contact_id is not null;

drop trigger if exists email_threads_set_updated_at on public.email_threads;
create trigger email_threads_set_updated_at
  before update on public.email_threads
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Inbound messages
-- ---------------------------------------------------------------------------

create table if not exists public.email_inbound_messages (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  thread_id     uuid not null references public.email_threads(id) on delete cascade,
  account_id    uuid not null references public.email_accounts(id) on delete cascade,

  /*
   * ⚠️ THE IDEMPOTENCY KEY. A re-sync after a crash re-reads the same UIDs,
   * and a duplicated inbound row would show the same reply twice in the inbox
   * and count it twice in every reply-rate metric derived from it.
   */
  provider_message_id text not null,

  from_email    text not null,
  subject       text,
  body_text     text,
  received_at   timestamptz not null,

  /*
   * The deterministic pre-filter's verdict, carried through from
   * `lib/email/auto-reply.ts`. Stored rather than recomputed so the inbox and
   * the reply-rate metrics can never disagree about what counted as a reply.
   */
  classification text not null default 'reply'
    check (classification in ('reply', 'auto_reply', 'bounce')),

  created_at    timestamptz not null default now(),

  constraint email_inbound_provider_id_uniq unique (workspace_id, provider_message_id)
);

create index if not exists email_inbound_thread_idx
  on public.email_inbound_messages (thread_id, received_at);

-- ---------------------------------------------------------------------------
-- Recording an inbound message
-- ---------------------------------------------------------------------------

/**
 * Files an inbound message into its thread, creating the thread if needed.
 *
 * ⚠️ ONE FUNCTION, ONE TRANSACTION, because the thread counters and the
 * message must not be able to disagree. Doing this as separate statements from
 * the application means a crash between them leaves a thread whose
 * `message_count` is wrong forever -- and `last_direction` wrong means a
 * thread silently drops out of "Needs reply", which is a reply nobody answers.
 *
 * Returns the thread id and whether the message was new, so the caller can
 * tell a genuine reply from a re-sync of one it has already handled.
 */
create or replace function public.email_record_inbound(
  p_workspace_id        uuid,
  p_account_id          uuid,
  p_provider_thread_key text,
  p_provider_message_id text,
  p_from_email          text,
  p_subject             text,
  p_body_text           text,
  p_received_at         timestamptz,
  p_classification      text,
  p_contact_id          uuid default null
)
returns table (thread_id uuid, is_new boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_id uuid;
  v_inserted  uuid;
begin
  /*
   * ⚠️ `on conflict ... do update` RATHER THAN `do nothing`, so that the
   * RETURNING clause always yields a row. With `do nothing` a thread that
   * already exists returns nothing at all, and the function would create a
   * duplicate on the next line while looking correct in every test that only
   * ever syncs once.
   */
  insert into public.email_threads (
    workspace_id, account_id, provider_thread_key, subject, contact_id,
    last_message_at, last_direction, message_count
  )
  values (
    p_workspace_id, p_account_id, p_provider_thread_key, p_subject, p_contact_id,
    p_received_at, 'inbound', 0
  )
  on conflict (workspace_id, provider_thread_key) do update
    set updated_at = now()
  returning id into v_thread_id;

  insert into public.email_inbound_messages (
    workspace_id, thread_id, account_id, provider_message_id,
    from_email, subject, body_text, received_at, classification
  )
  values (
    p_workspace_id, v_thread_id, p_account_id, p_provider_message_id,
    p_from_email, p_subject, p_body_text, p_received_at,
    coalesce(p_classification, 'reply')
  )
  on conflict (workspace_id, provider_message_id) do nothing
  returning id into v_inserted;

  if v_inserted is null then
    -- Already filed. The thread is NOT touched: re-marking it unread or
    -- bumping its timestamp on every re-sync would resurface answered threads.
    return query select v_thread_id, false;
    return;
  end if;

  update public.email_threads
  set
    message_count   = message_count + 1,
    last_message_at = greatest(last_message_at, p_received_at),
    last_direction  = 'inbound',
    /*
     * A new inbound message reopens a resolved thread. Someone replying after
     * "resolved" is precisely the case that must not be swallowed.
     */
    status          = 'open',
    read_at         = null,
    -- Fill in a contact if we learned one, but never overwrite a match a human
    -- may have made by hand.
    contact_id      = coalesce(contact_id, p_contact_id),
    subject         = coalesce(subject, p_subject)
  where id = v_thread_id;

  return query select v_thread_id, true;
end;
$$;

/**
 * Records that we replied, so the thread leaves "Needs reply".
 *
 * ⚠️ CALLED WHEN A SEND IS RECORDED, NOT WHEN ONE IS QUEUED. A queued message
 * that never sends would otherwise silently clear the flag, and the thread
 * would vanish from the one view whose job is to make sure someone answers.
 */
create or replace function public.email_thread_mark_outbound(
  p_workspace_id uuid,
  p_thread_key   text,
  p_sent_at      timestamptz
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.email_threads
  set
    last_direction  = 'outbound',
    last_message_at = greatest(last_message_at, p_sent_at),
    message_count   = message_count + 1
  where workspace_id = p_workspace_id
    and provider_thread_key = p_thread_key;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.email_threads enable row level security;
alter table public.email_inbound_messages enable row level security;

/*
 * ⚠️ MEMBERSHIP ONLY AT THE DATABASE LEVEL. The "a setter sees only threads
 * assigned to them" rule is NOT expressed here, deliberately: it depends on
 * `email.inbox.view.all`, which is an entitlement-and-role decision that lives
 * in the policy layer. Encoding half of it in SQL would give two places that
 * both partly decide access, and the SQL half would silently drift.
 * `lib/email/inbox.ts` applies the owner filter, and its tests prove it.
 */
drop policy if exists email_threads_select_member on public.email_threads;
create policy email_threads_select_member on public.email_threads
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

drop policy if exists email_inbound_select_member on public.email_inbound_messages;
create policy email_inbound_select_member on public.email_inbound_messages
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

revoke all on table public.email_threads from anon;
revoke all on table public.email_inbound_messages from anon;
grant select on table public.email_threads to authenticated;
grant select on table public.email_inbound_messages to authenticated;
grant select, insert, update, delete on table public.email_threads to service_role;
grant select, insert, update, delete on table public.email_inbound_messages to service_role;

revoke all on function public.email_record_inbound(
  uuid, uuid, text, text, text, text, text, timestamptz, text, uuid
) from public, anon, authenticated;
revoke all on function public.email_thread_mark_outbound(uuid, text, timestamptz)
  from public, anon, authenticated;

comment on table public.email_threads is
  'Unified inbox threads. Read state is SHARED, not per-user: this is a team '
  'inbox, so "unread" means nobody has looked at it yet.';

comment on table public.email_inbound_messages is
  'Received mail. Separate from email_messages because that table is the '
  'outbound send QUEUE, with claims and idempotency keys the send worker '
  'depends on.';
