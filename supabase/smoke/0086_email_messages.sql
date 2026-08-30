-- Smoke test for 0086 — the message engine (M5 Phase 14).
--
-- Proves the three claims that matter: a suppressed recipient never reaches a
-- worker, an expired claim is NEVER requeued, and a sent message cannot be
-- rewritten.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com')
on conflict do nothing;

insert into public.workspaces (id, name, owner_user_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Acme', '11111111-1111-1111-1111-111111111111')
on conflict do nothing;

insert into public.workspace_memberships (workspace_id, user_id, role)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner')
on conflict do nothing;

insert into public.email_accounts
  (id, workspace_id, provider, scope, owner_user_id, display_name, from_email, from_domain)
values ('e0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'smtp', 'workspace', '11111111-1111-1111-1111-111111111111',
        'Sales', 'sales@acme.example', 'acme.example');

-- ---------------------------------------------------------------------------
-- IDEMPOTENCY — the same key twice is one row, not two sends.
-- ---------------------------------------------------------------------------

insert into public.email_messages
  (workspace_id, account_id, to_email, subject, body_text, idempotency_key)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-000000000001',
        'prospect@buyer.example', 'Hello', 'body', 'key-alpha');

do $$
begin
  insert into public.email_messages
    (workspace_id, account_id, to_email, subject, body_text, idempotency_key)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-000000000001',
          'prospect@buyer.example', 'Hello again', 'body', 'key-alpha');
  raise exception 'FAIL: a duplicate idempotency key was accepted';
exception
  when unique_violation then
    raise notice 'PASS duplicate idempotency key rejected';
end
$$;

-- The same key in a DIFFERENT workspace is a different message.
insert into public.workspaces (id, name, owner_user_id)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Other', '11111111-1111-1111-1111-111111111111')
on conflict do nothing;

insert into public.email_accounts
  (id, workspace_id, provider, scope, owner_user_id, display_name, from_email, from_domain)
values ('e0000000-0000-0000-0000-000000000009', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        'smtp', 'workspace', '11111111-1111-1111-1111-111111111111',
        'Other sales', 'sales@other.example', 'other.example');

insert into public.email_messages
  (workspace_id, account_id, to_email, subject, body_text, idempotency_key)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'e0000000-0000-0000-0000-000000000009',
        'prospect@buyer.example', 'Hello', 'body', 'key-alpha');

select 'IDEMPOTENCY key is scoped per workspace' as check, count(*) = 2 as pass
from public.email_messages where idempotency_key = 'key-alpha';

-- ---------------------------------------------------------------------------
-- CRITERION 4 — a suppressed recipient is never claimed, for EVERY reason.
-- ---------------------------------------------------------------------------

insert into public.email_messages
  (workspace_id, account_id, to_email, subject, body_text, idempotency_key)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-000000000001',
   'unsub@buyer.example',    'x', 'b', 'k-unsub'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-000000000001',
   'bounced@buyer.example',  'x', 'b', 'k-bounce'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-000000000001',
   'complained@buyer.example','x','b', 'k-complaint'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-000000000001',
   'manual@buyer.example',   'x', 'b', 'k-manual'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-000000000001',
   'invalid@buyer.example',  'x', 'b', 'k-invalid');

insert into public.email_suppressions (workspace_id, email, reason) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'unsub@buyer.example',     'unsubscribed'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bounced@buyer.example',   'hard_bounce'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'complained@buyer.example','complaint'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'manual@buyer.example',    'manual'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'invalid@buyer.example',   'invalid_address');

-- Claim everything that is due.
create temporary table claimed on commit drop as
  select * from public.claim_email_messages('smoke-worker', 100, 120);

select 'SUPPRESSED never claimed, for all five reasons' as check,
       count(*) = 0 as pass
from claimed
where to_email in ('unsub@buyer.example', 'bounced@buyer.example',
                   'complained@buyer.example', 'manual@buyer.example',
                   'invalid@buyer.example');

select 'SUPPRESSED rows record which reason stopped them' as check,
       count(*) = 5 as pass,
       count(distinct suppression_reason) = 5 as all_reasons_distinct
from public.email_messages
where status = 'suppressed';

-- A suppression in ANOTHER workspace must not stop this one's mail.
select 'SUPPRESSION does not leak across workspaces' as check,
       count(*) = 1 as pass
from claimed
where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- ---------------------------------------------------------------------------
-- CRITERION 3 — an expired claim is NEVER requeued.
-- ---------------------------------------------------------------------------

-- Simulate a worker that died holding a claim.
update public.email_messages
   set claim_expires_at = now() - interval '5 minutes'
 where status = 'sending'
   and idempotency_key = 'key-alpha'
   and workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select 'REAPER moved the abandoned claim' as check,
       public.reap_expired_email_claims() = 1 as pass;

select 'ABANDONED message is needs_verification, NOT queued' as check,
       status = 'needs_verification' as pass,
       error_code = 'CLAIM_EXPIRED' as code_set
from public.email_messages
where idempotency_key = 'key-alpha'
  and workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- ...and a second claim pass must NOT pick it up again. This is the whole
-- at-most-once guarantee: retrying after a kill re-sends nothing.
create temporary table reclaimed on commit drop as
  select * from public.claim_email_messages('smoke-worker-2', 100, 120);

select 'RETRY AFTER KILL claims nothing — no second send' as check,
       count(*) = 0 as pass
from reclaimed
where idempotency_key = 'key-alpha';

-- ---------------------------------------------------------------------------
-- A sent message is frozen.
-- ---------------------------------------------------------------------------

update public.email_messages
   set status = 'sent', sent_at = now(), provider_message_id = '<abc@acme.example>'
 where idempotency_key = 'k-sent-target'
    or id = (select id from public.email_messages
              where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' limit 1);

do $$
begin
  update public.email_messages
     set subject = 'Rewritten after the fact'
   where status = 'sent';
  raise exception 'FAIL: a sent message was rewritten';
exception
  when check_violation then
    raise notice 'PASS sent message content is immutable';
end
$$;

do $$
begin
  update public.email_messages set body_text = 'different' where status = 'sent';
  raise exception 'FAIL: a sent body was rewritten';
exception
  when check_violation then
    raise notice 'PASS sent body is immutable';
end
$$;

-- But recording what happened AFTER the send is still allowed.
update public.email_messages
   set thread_id = 'thread-123', error_message = null
 where status = 'sent';

select 'POST-SEND metadata still writable' as check, true as pass;

-- ---------------------------------------------------------------------------
-- Claim exclusivity — two workers never get the same message.
-- ---------------------------------------------------------------------------

insert into public.email_messages
  (workspace_id, account_id, to_email, subject, body_text, idempotency_key)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-000000000001',
        'fresh@buyer.example', 'x', 'b', 'k-fresh');

create temporary table w1 on commit drop as
  select * from public.claim_email_messages('worker-1', 100, 120);
create temporary table w2 on commit drop as
  select * from public.claim_email_messages('worker-2', 100, 120);

select 'CLAIM is exclusive — worker 2 gets nothing worker 1 has' as check,
       not exists (select 1 from w1 join w2 using (message_id)) as pass;

rollback;
