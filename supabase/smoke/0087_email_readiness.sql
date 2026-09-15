-- Smoke test for 0087 — email readiness and ramp (M5 Phase 13).
--
-- The claim being tested is the DOMAIN ROLLUP (M5 criterion 5): reputation is
-- shared across a sending domain, so the rollup must surface the WORST mailbox
-- rather than average it away.
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. The `select … as pass` rows here used
-- to fail nothing: an `f` printed and the harness exited 0, and a check whose
-- `where domain = …` matched no row printed nothing at all. Each check now goes
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

-- Three mailboxes on acme.example, one on a separate domain.
insert into public.email_accounts
  (id, workspace_id, provider, scope, owner_user_id, display_name, from_email, from_domain)
values
  ('e0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'smtp','workspace','11111111-1111-1111-1111-111111111111','A1','a1@acme.example','acme.example'),
  ('e0000000-0000-0000-0000-00000000000b', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'smtp','workspace','11111111-1111-1111-1111-111111111111','A2','a2@acme.example','acme.example'),
  ('e0000000-0000-0000-0000-00000000000c', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'smtp','workspace','11111111-1111-1111-1111-111111111111','A3','a3@acme.example','acme.example'),
  ('e0000000-0000-0000-0000-00000000000d', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'smtp','workspace','11111111-1111-1111-1111-111111111111','B1','b1@other.example','other.example');

-- ---------------------------------------------------------------------------
-- RAMP DEFAULTS — conservative, and actually applied.
-- ---------------------------------------------------------------------------

insert into smoke_checks (label, ok)
select 'RAMP is enabled by default', coalesce(bool_and(ramp_enabled), false)
from public.email_accounts;

insert into smoke_checks (label, ok)
select 'RAMP initial daily volume defaults to 20', coalesce(bool_and(ramp_initial_daily = 20), false)
from public.email_accounts;

insert into smoke_checks (label, ok)
select 'RAMP daily increment defaults to 5', coalesce(bool_and(ramp_daily_increment = 5), false)
from public.email_accounts;

insert into smoke_checks (label, ok)
select 'RAMP target daily volume defaults to 200', coalesce(bool_and(ramp_target_daily = 200), false)
from public.email_accounts;

-- ---------------------------------------------------------------------------
-- DOMAIN ROLLUP — the worst mailbox must not be averaged away.
-- ---------------------------------------------------------------------------

-- Two healthy mailboxes and one badly damaged one, all on acme.example.
insert into public.email_readiness_checks
  (workspace_id, account_id, state, score, sent_24h, sent_7d, checked_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-00000000000a',
   'ready',   95, 40, 300, now() - interval '1 hour'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-00000000000b',
   'ready',   90, 35, 280, now() - interval '1 hour'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-00000000000c',
   'warning', 30, 10,  90, now() - interval '1 hour'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-00000000000d',
   'ramping', 80,  5,  20, now() - interval '1 hour');

insert into smoke_checks (label, ok) values
  ('ROLLUP surfaces the worst mailbox score, 30',
   coalesce((select worst_score = 30
               from public.email_domain_health('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
              where domain = 'acme.example'), false)),
  -- The average is a healthy-looking 71.7, which is exactly why reporting it
  -- alone would hide the mailbox that needs stopping.
  ('ROLLUP average is 71.7, which alone would have hidden it',
   coalesce((select average_score = 71.7
               from public.email_domain_health('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
              where domain = 'acme.example'), false)),
  ('ROLLUP counted all three acme mailboxes',
   coalesce((select mailboxes = 3
               from public.email_domain_health('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
              where domain = 'acme.example'), false)),
  ('ROLLUP surfaces the worst state, warning',
   coalesce((select worst_state = 'warning'
               from public.email_domain_health('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
              where domain = 'acme.example'), false));

insert into smoke_checks (label, ok)
select 'ROLLUP keeps domains separate', coalesce(count(*) = 2, false)
from public.email_domain_health('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into smoke_checks (label, ok)
select 'ROLLUP orders worst domain first',
       coalesce((array_agg(domain order by worst_score))[1] = 'acme.example', false)
from public.email_domain_health('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- ---------------------------------------------------------------------------
-- Only the LATEST assessment counts.
-- ---------------------------------------------------------------------------

-- The damaged mailbox is fixed and re-assessed.
insert into public.email_readiness_checks
  (workspace_id, account_id, state, score, checked_at)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-00000000000c',
        'ready', 92, now());

insert into smoke_checks (label, ok) values
  ('ROLLUP uses only the most recent check per mailbox (worst score now 90)',
   coalesce((select worst_score = 90
               from public.email_domain_health('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
              where domain = 'acme.example'), false)),
  ('ROLLUP shows the recovered domain as ready',
   coalesce((select worst_state = 'ready'
               from public.email_domain_health('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
              where domain = 'acme.example'), false));

insert into smoke_checks (label, ok)
select 'HISTORY is retained, not overwritten', coalesce(count(*) = 2, false)
from public.email_readiness_checks
where account_id = 'e0000000-0000-0000-0000-00000000000c';

-- ---------------------------------------------------------------------------
-- Severity ordering — the most severe state wins the domain.
-- ---------------------------------------------------------------------------

insert into public.email_readiness_checks
  (workspace_id, account_id, state, score, checked_at)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-00000000000a',
        'disconnected', 0, now() + interval '1 minute');

insert into smoke_checks (label, ok)
values ('SEVERITY: disconnected outranks ready',
        coalesce((select worst_state = 'disconnected'
                    from public.email_domain_health('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
                   where domain = 'acme.example'), false));

-- ---------------------------------------------------------------------------
-- Volume counting — "today" is the MAILBOX's day, not the server's.
-- ---------------------------------------------------------------------------

insert into public.email_messages
  (workspace_id, account_id, to_email, subject, body_text, idempotency_key, status, sent_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-00000000000a',
   'p1@buyer.example','s','b','v-1','sent', now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-00000000000a',
   'p2@buyer.example','s','b','v-2','sent', now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-00000000000a',
   'p3@buyer.example','s','b','v-3','sent', now() - interval '40 days'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-00000000000a',
   'p4@buyer.example','s','b','v-4','failed', now());

insert into smoke_checks (label, ok)
values ('SENT TODAY excludes old and unsent messages',
        coalesce(public.email_sent_today('e0000000-0000-0000-0000-00000000000a', 'UTC') = 2, false));

insert into smoke_checks (label, ok) values
  ('VOLUME counts 2 sends in the window',
   coalesce((select sent = 2
               from public.email_account_volume('e0000000-0000-0000-0000-00000000000a',
                                                now() - interval '7 days')), false)),
  ('VOLUME counts 1 failure in the window',
   coalesce((select failed = 1
               from public.email_account_volume('e0000000-0000-0000-0000-00000000000a',
                                                now() - interval '7 days')), false));

-- A hard bounce recorded AFTER the send still counts against that mailbox.
insert into public.email_suppressions (workspace_id, email, reason, created_at)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','p1@buyer.example','hard_bounce', now() + interval '1 minute');

insert into smoke_checks (label, ok)
values ('BOUNCE discovered later still counts against the sender',
        coalesce((select bounced = 1
                    from public.email_account_volume('e0000000-0000-0000-0000-00000000000a',
                                                     now() - interval '7 days')), false));

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 18;
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
