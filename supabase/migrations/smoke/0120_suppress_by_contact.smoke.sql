-- Smoke test for 0120 — does the contact predicate actually stop a send?
--
-- ⚠️ "APPLIES CLEANLY" DOES NOT PROVE THIS. `check_function_bodies` syntax-checks
-- a plpgsql body; it does not resolve table or column names inside it. A join on
-- a column that does not exist creates the function happily and fails the first
-- time a worker calls it — at which point the failure is in production, on the
-- send path, at the point that decides whether somebody who asked not to be
-- contacted gets contacted.
--
-- So this exercises the real function against real rows.

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- A workspace, an owner, a mail account, and one contact with TWO addresses.
-- Two addresses is the whole point: the suppression will name one and the
-- queued message will use the other.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com');

insert into public.workspaces (id, name, owner_user_id)
values ('22222222-2222-2222-2222-222222222222', 'Smoke', '11111111-1111-1111-1111-111111111111');

insert into public.crm_contacts (id, workspace_id, full_name)
values ('33333333-3333-3333-3333-333333333333',
        '22222222-2222-2222-2222-222222222222', 'Ada Okonkwo');

insert into public.email_accounts
  (id, workspace_id, owner_user_id, provider, from_email, from_name, status)
values ('44444444-4444-4444-4444-444444444444',
        '22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', 'smtp',
        'sender@example.com', 'Sender', 'ready');

-- The suppression names address ONE.
insert into public.email_suppressions (workspace_id, email, reason, contact_id)
values ('22222222-2222-2222-2222-222222222222',
        'ada.one@example.com', 'unsubscribed',
        '33333333-3333-3333-3333-333333333333');

-- The queued message uses address TWO, for the same person.
insert into public.email_messages
  (id, workspace_id, account_id, contact_id, to_email, subject, body_text,
   status, scheduled_at, idempotency_key)
values ('55555555-5555-5555-5555-555555555555',
        '22222222-2222-2222-2222-222222222222',
        '44444444-4444-4444-4444-444444444444',
        '33333333-3333-3333-3333-333333333333',
        'ada.two@example.com', 'Hello', 'Body',
        'queued', now() - interval '1 minute', 'smoke-key-1');

-- A second person with no suppression at all — the control. If this one also
-- ends up suppressed, the predicate is matching everything and the test above
-- would pass for the wrong reason.
insert into public.crm_contacts (id, workspace_id, full_name)
values ('66666666-6666-6666-6666-666666666666',
        '22222222-2222-2222-2222-222222222222', 'Marcus Bellweather');

insert into public.email_messages
  (id, workspace_id, account_id, contact_id, to_email, subject, body_text,
   status, scheduled_at, idempotency_key)
values ('77777777-7777-7777-7777-777777777777',
        '22222222-2222-2222-2222-222222222222',
        '44444444-4444-4444-4444-444444444444',
        '66666666-6666-6666-6666-666666666666',
        'marcus@example.com', 'Hello', 'Body',
        'queued', now() - interval '1 minute', 'smoke-key-2');

-- ---------------------------------------------------------------------------
-- Run the real claim function.
-- ---------------------------------------------------------------------------
create temporary table claimed as
  select * from public.claim_email_messages('smoke-worker', 10, 120);

do $$
declare
  v_status_suppressed text;
  v_status_control    text;
  v_claimed_count     int;
begin
  select status into v_status_suppressed
    from public.email_messages where id = '55555555-5555-5555-5555-555555555555';

  select status into v_status_control
    from public.email_messages where id = '77777777-7777-7777-7777-777777777777';

  select count(*) into v_claimed_count from claimed;

  -- THE ASSERTION. Suppression named ada.one@; the message went to ada.two@.
  -- Before 0120 this was claimed and sent.
  if v_status_suppressed <> 'suppressed' then
    raise exception
      'FAIL: a message to a suppressed CONTACT''s second address was %, not suppressed',
      v_status_suppressed;
  end if;

  -- THE CONTROL. Without this, a predicate that suppressed everything would
  -- pass the assertion above while being catastrophically wrong.
  if v_status_control <> 'sending' then
    raise exception
      'FAIL: the unsuppressed control message was %, expected sending', v_status_control;
  end if;

  if v_claimed_count <> 1 then
    raise exception 'FAIL: expected exactly 1 claimed message, got %', v_claimed_count;
  end if;

  raise notice 'PASS: contact-level suppression stopped the second address; control unaffected';
end
$$;

rollback;
