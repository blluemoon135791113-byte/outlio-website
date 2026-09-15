-- Smoke test for 0086 — the message engine (M5 Phase 14).
--
-- Proves the three claims that matter: a suppressed recipient never reaches a
-- worker, an expired claim is NEVER requeued, and a sent message cannot be
-- rewritten.
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. The `select … as pass` rows here used
-- to fail nothing: an `f` printed and the harness exited 0. Each check now goes
-- into `smoke_checks` through `coalesce(…, false)`, and the gate at the end
-- raises unless exactly the expected number were recorded and every one is true.

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

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
declare
  v_rejected boolean := false;
begin
  begin
    insert into public.email_messages
      (workspace_id, account_id, to_email, subject, body_text, idempotency_key)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e0000000-0000-0000-0000-000000000001',
            'prospect@buyer.example', 'Hello again', 'body', 'key-alpha');
  exception
    when unique_violation then
      v_rejected := true;
  end;

  insert into smoke_checks (label, ok)
  values ('DUPLICATE idempotency key rejected', v_rejected);
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

insert into smoke_checks (label, ok)
select 'IDEMPOTENCY key is scoped per workspace', coalesce(count(*) = 2, false)
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

insert into smoke_checks (label, ok)
select 'CRITERION 4: SUPPRESSED never claimed, for all five reasons', coalesce(count(*) = 0, false)
from claimed
where to_email in ('unsub@buyer.example', 'bounced@buyer.example',
                   'complained@buyer.example', 'manual@buyer.example',
                   'invalid@buyer.example');

insert into smoke_checks (label, ok)
select 'SUPPRESSED rows: all five are marked suppressed', coalesce(count(*) = 5, false)
from public.email_messages
where status = 'suppressed';

insert into smoke_checks (label, ok)
select 'SUPPRESSED rows record which of the 5 reasons stopped them',
       coalesce(count(distinct suppression_reason) = 5, false)
from public.email_messages
where status = 'suppressed';

-- A suppression in ANOTHER workspace must not stop this one's mail.
insert into smoke_checks (label, ok)
select 'SUPPRESSION does not leak across workspaces', coalesce(count(*) = 1, false)
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

insert into smoke_checks (label, ok)
values ('REAPER moved the abandoned claim',
        coalesce(public.reap_expired_email_claims() = 1, false));

insert into smoke_checks (label, ok) values
  ('ABANDONED message is needs_verification, NOT queued',
   coalesce((select status = 'needs_verification' from public.email_messages
              where idempotency_key = 'key-alpha'
                and workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), false)),
  ('ABANDONED message carries CLAIM_EXPIRED',
   coalesce((select error_code = 'CLAIM_EXPIRED' from public.email_messages
              where idempotency_key = 'key-alpha'
                and workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), false));

-- ...and a second claim pass must NOT pick it up again. This is the whole
-- at-most-once guarantee: retrying after a kill re-sends nothing.
create temporary table reclaimed on commit drop as
  select * from public.claim_email_messages('smoke-worker-2', 100, 120);

insert into smoke_checks (label, ok)
select 'CRITERION 3: RETRY AFTER KILL claims nothing — no second send', coalesce(count(*) = 0, false)
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
declare
  v_rejected boolean := false;
begin
  begin
    update public.email_messages
       set subject = 'Rewritten after the fact'
     where status = 'sent';
  exception
    when check_violation then
      v_rejected := true;
  end;

  insert into smoke_checks (label, ok)
  values ('SENT message subject is immutable', v_rejected);
end
$$;

do $$
declare
  v_rejected boolean := false;
begin
  begin
    update public.email_messages set body_text = 'different' where status = 'sent';
  exception
    when check_violation then
      v_rejected := true;
  end;

  insert into smoke_checks (label, ok)
  values ('SENT message body is immutable', v_rejected);
end
$$;

-- But recording what happened AFTER the send is still allowed.
update public.email_messages
   set thread_id = 'thread-123', error_message = null
 where status = 'sent';

-- Was `select … true as pass`, which could not print anything else.
insert into smoke_checks (label, ok)
select 'POST-SEND metadata still writable',
       coalesce(count(*) > 0 and bool_and(thread_id = 'thread-123'), false)
from public.email_messages
where status = 'sent';

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

insert into smoke_checks (label, ok)
values ('CLAIM is exclusive — worker 2 gets nothing worker 1 has',
        not exists (select 1 from w1 join w2 using (message_id)));

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 14;
  v_total    integer;
  v_failed   text;
begin
  select count(*),
         string_agg(label, '; ' order by n) filter (where ok is not true)
    into v_total, v_failed
    from smoke_checks;

  -- ⚠️ THE COUNT IS PART OF THE TEST. A check that never ran records nothing,
  -- so it would pass by being absent. Adding or removing a check means
  -- changing this number, on purpose.
  if v_total <> v_expected then
    raise exception 'SMOKE FAILED: expected % checks, recorded %', v_expected, v_total;
  end if;

  if v_failed is not null then
    raise exception 'SMOKE FAILED: %', v_failed;
  end if;

  raise notice 'SMOKE PASSED: % of % checks', v_total, v_expected;
end $$;

rollback;
