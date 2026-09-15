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
--
-- ⚠️ AND IT WAS RUN AGAINST 0106 AS A NEGATIVE CONTROL, which is the half that
-- makes the pass mean anything. Against the shipping function the check "a
-- message to a suppressed contact's second address is suppressed" fails — so
-- the bug was real, and this test can detect it.
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. `if <bad> then raise` skips silently
-- when <bad> is NULL — a missing row, a missing JSON key — and a printed `ok`
-- column fails nothing. So each check goes into `smoke_checks` through
-- `coalesce(…, false)`, and the gate at the end raises unless exactly the
-- expected number were recorded and every one is true. check-migration.sh
-- refuses a smoke file whose gate never reported SMOKE PASSED.
--
-- Run it with:
--   scripts/check-migration.sh supabase/migrations/0120_suppress_by_contact.sql \
--     supabase/migrations/smoke/0120_suppress_by_contact.smoke.sql
--
-- If Docker is unavailable, the same thing runs against a throwaway local
-- cluster: `initdb` a temp PGDATA, start it on a unix socket, replay the same
-- scaffold and prerequisites, then apply and run these two files. On macOS with
-- PostgreSQL 16 that needs `LC_ALL` set to a valid locale, or the postmaster
-- dies at startup with "became multithreaded" — the server log says so itself.

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

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
  (id, workspace_id, owner_user_id, provider, display_name, from_email, from_domain, from_name, status)
values ('44444444-4444-4444-4444-444444444444',
        '22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', 'smtp', 'Smoke sender',
        'sender@example.com', 'example.com', 'Sender', 'ready');

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
  insert into smoke_checks (label, ok)
  values ('a message to a suppressed contact''s second address is suppressed',
          coalesce(v_status_suppressed = 'suppressed', false));

  -- THE CONTROL. Without this, a predicate that suppressed everything would
  -- pass the assertion above while being catastrophically wrong.
  insert into smoke_checks (label, ok)
  values ('the unsuppressed control message is sending',
          coalesce(v_status_control = 'sending', false));

  insert into smoke_checks (label, ok)
  values ('exactly 1 message was claimed', coalesce(v_claimed_count = 1, false));
end
$$;

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 3;
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
