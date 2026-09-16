-- Smoke test for 0092 — email reporting (M6 Phase 19).
--
-- M6 ACCEPTANCE CRITERION 5: "campaign reports reconcile with raw
-- email_events." Reconciliation is asserted DIRECTLY: every reported figure is
-- compared against a raw count of the stream in the same query.
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. The `select … as pass` rows here used
-- to fail nothing: an `f` printed and the harness exited 0, and a report that
-- returned no row printed nothing at all. Each check now goes into
-- `smoke_checks` through `coalesce(…, false)`, and the gate at the end raises
-- unless exactly the expected number were recorded and every one is true.

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','o@example.com') on conflict do nothing;
insert into public.workspaces (id, name, owner_user_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Acme','11111111-1111-1111-1111-111111111111')
on conflict do nothing;
insert into public.workspace_memberships (workspace_id, user_id, role)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','owner')
on conflict do nothing;

insert into public.email_accounts
  (id, workspace_id, provider, scope, owner_user_id, display_name, from_email, from_domain, health_score)
values ('e0000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'smtp','workspace','11111111-1111-1111-1111-111111111111','Sales',
        'sales@acme.example','acme.example', 88);

insert into public.email_campaigns (id, workspace_id, name, type, status, account_id)
values ('ca000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'Q3','sales_sequence','running','e0000000-0000-0000-0000-000000000001');

-- Five recipients: three normal, one suppressed, one bounced.
insert into public.crm_contacts (id, workspace_id, first_name, last_name, full_name)
select ('c0000000-0000-0000-0000-00000000000' || i)::uuid,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','P','Q','Person ' || i
from generate_series(1,5) i;

insert into public.email_enrollments
  (workspace_id, campaign_id, contact_id, to_email, status, stop_reason)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ca000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001','p1@buyer.example','active', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ca000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000002','p2@buyer.example','stopped','replied'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ca000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000003','p3@buyer.example','stopped','unsubscribed'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ca000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000004','p4@buyer.example','stopped','suppressed'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ca000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000005','p5@buyer.example','stopped','bounced');

-- The raw stream.
do $$
begin
  perform public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','sent','p1@buyer.example',
    null,null,'ca000000-0000-0000-0000-000000000001');
  perform public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','sent','p2@buyer.example',
    null,null,'ca000000-0000-0000-0000-000000000001');
  perform public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','sent','p3@buyer.example',
    null,null,'ca000000-0000-0000-0000-000000000001');
  perform public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','sent','p5@buyer.example',
    null,null,'ca000000-0000-0000-0000-000000000001');
  perform public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','delivered','p1@buyer.example',
    null,null,'ca000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001');
  perform public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','replied','p2@buyer.example',
    null,null,'ca000000-0000-0000-0000-000000000001');
  perform public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','auto_replied','p1@buyer.example',
    null,null,'ca000000-0000-0000-0000-000000000001');
  perform public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','auto_replied','p3@buyer.example',
    null,null,'ca000000-0000-0000-0000-000000000001');
  perform public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','unsubscribed','p3@buyer.example',
    null,null,'ca000000-0000-0000-0000-000000000001');
  perform public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bounced','p5@buyer.example',
    null,null,'ca000000-0000-0000-0000-000000000001');
end
$$;

-- ---------------------------------------------------------------------------
-- CRITERION 5 — every reported figure equals a raw count of the stream.
-- ---------------------------------------------------------------------------

insert into smoke_checks (label, ok) values
  ('CRITERION 5: sent reconciles with the raw stream',
   coalesce((select r.sent = (select count(*) from public.email_events
                               where campaign_id = 'ca000000-0000-0000-0000-000000000001' and type = 'sent')
               from public.email_campaign_report('ca000000-0000-0000-0000-000000000001') r), false)),
  ('CRITERION 5: delivered reconciles with the raw stream',
   coalesce((select r.delivered = (select count(*) from public.email_events
                                    where campaign_id = 'ca000000-0000-0000-0000-000000000001' and type = 'delivered')
               from public.email_campaign_report('ca000000-0000-0000-0000-000000000001') r), false)),
  ('CRITERION 5: replied reconciles with the raw stream',
   coalesce((select r.replied = (select count(*) from public.email_events
                                  where campaign_id = 'ca000000-0000-0000-0000-000000000001' and type = 'replied')
               from public.email_campaign_report('ca000000-0000-0000-0000-000000000001') r), false)),
  ('CRITERION 5: auto_replied reconciles with the raw stream',
   coalesce((select r.auto_replied = (select count(*) from public.email_events
                                       where campaign_id = 'ca000000-0000-0000-0000-000000000001' and type = 'auto_replied')
               from public.email_campaign_report('ca000000-0000-0000-0000-000000000001') r), false)),
  ('CRITERION 5: bounced reconciles with the raw stream',
   coalesce((select r.bounced = (select count(*) from public.email_events
                                  where campaign_id = 'ca000000-0000-0000-0000-000000000001' and type = 'bounced')
               from public.email_campaign_report('ca000000-0000-0000-0000-000000000001') r), false)),
  ('CRITERION 5: unsubscribed reconciles with the raw stream',
   coalesce((select r.unsubscribed = (select count(*) from public.email_events
                                       where campaign_id = 'ca000000-0000-0000-0000-000000000001' and type = 'unsubscribed')
               from public.email_campaign_report('ca000000-0000-0000-0000-000000000001') r), false));

-- ⚠️ THE REPLY RATE MUST NOT ABSORB THE TWO AUTO-REPLIES.
-- 1 real reply / 4 sent = 0.25. Counting auto-replies would give 0.75, and
-- someone would conclude this message is working and send more of it.
insert into smoke_checks (label, ok) values
  ('REPLY RATE excludes auto-replies (0.25)',
   coalesce((select r.reply_rate = 0.2500
               from public.email_campaign_report('ca000000-0000-0000-0000-000000000001') r), false)),
  ('REPLY RATE: the 2 auto-replies are counted separately',
   coalesce((select r.auto_replied = 2
               from public.email_campaign_report('ca000000-0000-0000-0000-000000000001') r), false));

-- ELIGIBLE excludes people who could never be mailed.
insert into smoke_checks (label, ok) values
  ('ELIGIBLE: 5 recipients in total',
   coalesce((select r.recipients = 5
               from public.email_campaign_report('ca000000-0000-0000-0000-000000000001') r), false)),
  ('ELIGIBLE excludes suppressed and bounced recipients (3)',
   coalesce((select r.eligible = 3
               from public.email_campaign_report('ca000000-0000-0000-0000-000000000001') r), false));

insert into smoke_checks (label, ok) values
  ('STOP REASONS: 1 stopped by a reply',
   coalesce((select r.stopped_replied = 1
               from public.email_campaign_report('ca000000-0000-0000-0000-000000000001') r), false)),
  ('STOP REASONS: 1 stopped by an unsubscribe',
   coalesce((select r.stopped_unsub = 1
               from public.email_campaign_report('ca000000-0000-0000-0000-000000000001') r), false)),
  ('STOP REASONS: 1 still active',
   coalesce((select r.still_active = 1
               from public.email_campaign_report('ca000000-0000-0000-0000-000000000001') r), false));

-- A campaign that has sent nothing has NO rate, not a zero rate.
insert into public.email_campaigns (id, workspace_id, name, type, status, account_id)
values ('ca000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'Unsent','sales_sequence','draft','e0000000-0000-0000-0000-000000000001');

insert into smoke_checks (label, ok)
values ('AN UNSENT campaign has a NULL rate, not 0%',
        coalesce((select reply_rate is null
                    from public.email_campaign_report('ca000000-0000-0000-0000-000000000002')), false));

-- ---------------------------------------------------------------------------
-- Mailbox report — last_healthy_send is the field that matters.
-- ---------------------------------------------------------------------------

insert into public.email_messages
  (workspace_id, account_id, contact_id, to_email, subject, body_text, idempotency_key, status, sent_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001','p1@buyer.example','s','b','r-1','sent', now() - interval '2 days'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000002','p2@buyer.example','s','b','r-2','sent', now() - interval '1 day'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000003','p3@buyer.example','s','b','r-3','failed', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000004','p4@buyer.example','s','b','r-4','needs_verification', null);

insert into smoke_checks (label, ok) values
  ('MAILBOX report surfaces 2 sends',
   coalesce((select sent = 2
               from public.email_mailbox_report('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                                (now() - interval '7 days')::date,
                                                (now() + interval '1 day')::date)), false)),
  ('MAILBOX report surfaces 1 failure',
   coalesce((select failed = 1
               from public.email_mailbox_report('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                                (now() - interval '7 days')::date,
                                                (now() + interval '1 day')::date)), false)),
  -- Surfaced per mailbox because one accumulating these has a problem a human
  -- must look at; at-most-once never retries them.
  ('MAILBOX report surfaces 1 needs_verification',
   coalesce((select needs_verification = 1
               from public.email_mailbox_report('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                                (now() - interval '7 days')::date,
                                                (now() + interval '1 day')::date)), false)),
  ('MAILBOX report knows the last healthy send',
   coalesce((select last_healthy_send is not null
               from public.email_mailbox_report('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                                (now() - interval '7 days')::date,
                                                (now() + interval '1 day')::date)), false));

-- ---------------------------------------------------------------------------
-- Contact timeline — messages and events in ONE ordered list.
-- ---------------------------------------------------------------------------

insert into smoke_checks (label, ok)
select 'TIMELINE has at least 2 entries', coalesce(count(*) >= 2, false)
from public.email_contact_timeline('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                   'c0000000-0000-0000-0000-000000000001');

insert into smoke_checks (label, ok)
select 'TIMELINE interleaves messages and events (both kinds present)',
       coalesce(count(distinct kind) = 2, false)
from public.email_contact_timeline('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                   'c0000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 20;
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
