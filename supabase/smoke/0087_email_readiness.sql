-- Smoke test for 0087 — email readiness and ramp (M5 Phase 13).
--
-- The claim being tested is the DOMAIN ROLLUP (M5 criterion 5): reputation is
-- shared across a sending domain, so the rollup must surface the WORST mailbox
-- rather than average it away.

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

select 'RAMP defaults are conservative and enabled' as check,
       bool_and(ramp_enabled) as pass,
       bool_and(ramp_initial_daily = 20) as initial_20,
       bool_and(ramp_daily_increment = 5) as increment_5,
       bool_and(ramp_target_daily = 200) as target_200
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

select 'ROLLUP surfaces the worst mailbox, not just the average' as check,
       worst_score = 30 as pass,
       -- The average is a healthy-looking 71.7, which is exactly why reporting
       -- it alone would hide the mailbox that needs stopping.
       average_score = 71.7 as average_would_have_hidden_it,
       mailboxes = 3 as counted_all_three,
       worst_state = 'warning' as worst_state_surfaced
from public.email_domain_health('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
where domain = 'acme.example';

select 'ROLLUP keeps domains separate' as check,
       count(*) = 2 as pass
from public.email_domain_health('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select 'ROLLUP orders worst domain first' as check,
       (array_agg(domain order by worst_score))[1] = 'acme.example' as pass
from public.email_domain_health('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- ---------------------------------------------------------------------------
-- Only the LATEST assessment counts.
-- ---------------------------------------------------------------------------

-- The damaged mailbox is fixed and re-assessed.
insert into public.email_readiness_checks
  (workspace_id, account_id, state, score, checked_at)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-00000000000c',
        'ready', 92, now());

select 'ROLLUP uses only the most recent check per mailbox' as check,
       worst_score = 90 as pass,
       worst_state = 'ready' as recovered
from public.email_domain_health('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
where domain = 'acme.example';

select 'HISTORY is retained, not overwritten' as check,
       count(*) = 2 as pass
from public.email_readiness_checks
where account_id = 'e0000000-0000-0000-0000-00000000000c';

-- ---------------------------------------------------------------------------
-- Severity ordering — the most severe state wins the domain.
-- ---------------------------------------------------------------------------

insert into public.email_readiness_checks
  (workspace_id, account_id, state, score, checked_at)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-00000000000a',
        'disconnected', 0, now() + interval '1 minute');

select 'SEVERITY: disconnected outranks ready' as check,
       worst_state = 'disconnected' as pass
from public.email_domain_health('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
where domain = 'acme.example';

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

select 'SENT TODAY excludes old and unsent messages' as check,
       public.email_sent_today('e0000000-0000-0000-0000-00000000000a', 'UTC') = 2 as pass;

select 'VOLUME counts sends and failures in the window' as check,
       sent = 2 as sent_ok,
       failed = 1 as failed_ok
from public.email_account_volume('e0000000-0000-0000-0000-00000000000a', now() - interval '7 days');

-- A hard bounce recorded AFTER the send still counts against that mailbox.
insert into public.email_suppressions (workspace_id, email, reason, created_at)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','p1@buyer.example','hard_bounce', now() + interval '1 minute');

select 'BOUNCE discovered later still counts against the sender' as check,
       bounced = 1 as pass
from public.email_account_volume('e0000000-0000-0000-0000-00000000000a', now() - interval '7 days');

rollback;
