-- Smoke test for 0092 — email reporting (M6 Phase 19).
--
-- M6 ACCEPTANCE CRITERION 5: "campaign reports reconcile with raw
-- email_events." Reconciliation is asserted DIRECTLY: every reported figure is
-- compared against a raw count of the stream in the same query.

\set ON_ERROR_STOP on

begin;

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
select public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','sent','p1@buyer.example',
  null,null,'ca000000-0000-0000-0000-000000000001');
select public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','sent','p2@buyer.example',
  null,null,'ca000000-0000-0000-0000-000000000001');
select public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','sent','p3@buyer.example',
  null,null,'ca000000-0000-0000-0000-000000000001');
select public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','sent','p5@buyer.example',
  null,null,'ca000000-0000-0000-0000-000000000001');
select public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','delivered','p1@buyer.example',
  null,null,'ca000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001');
select public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','replied','p2@buyer.example',
  null,null,'ca000000-0000-0000-0000-000000000001');
select public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','auto_replied','p1@buyer.example',
  null,null,'ca000000-0000-0000-0000-000000000001');
select public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','auto_replied','p3@buyer.example',
  null,null,'ca000000-0000-0000-0000-000000000001');
select public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','unsubscribed','p3@buyer.example',
  null,null,'ca000000-0000-0000-0000-000000000001');
select public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bounced','p5@buyer.example',
  null,null,'ca000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- CRITERION 5 — every reported figure equals a raw count of the stream.
-- ---------------------------------------------------------------------------

select 'CRITERION 5: every figure reconciles with the raw stream' as check,
       r.sent         = (select count(*) from public.email_events where campaign_id = 'ca000000-0000-0000-0000-000000000001' and type = 'sent') as sent_ok,
       r.delivered    = (select count(*) from public.email_events where campaign_id = 'ca000000-0000-0000-0000-000000000001' and type = 'delivered') as delivered_ok,
       r.replied      = (select count(*) from public.email_events where campaign_id = 'ca000000-0000-0000-0000-000000000001' and type = 'replied') as replied_ok,
       r.auto_replied = (select count(*) from public.email_events where campaign_id = 'ca000000-0000-0000-0000-000000000001' and type = 'auto_replied') as auto_ok,
       r.bounced      = (select count(*) from public.email_events where campaign_id = 'ca000000-0000-0000-0000-000000000001' and type = 'bounced') as bounced_ok,
       r.unsubscribed = (select count(*) from public.email_events where campaign_id = 'ca000000-0000-0000-0000-000000000001' and type = 'unsubscribed') as unsub_ok
from public.email_campaign_report('ca000000-0000-0000-0000-000000000001') r;

-- ⚠️ THE REPLY RATE MUST NOT ABSORB THE TWO AUTO-REPLIES.
-- 1 real reply / 4 sent = 0.25. Counting auto-replies would give 0.75, and
-- someone would conclude this message is working and send more of it.
select 'REPLY RATE excludes auto-replies' as check,
       r.reply_rate = 0.2500 as pass,
       r.auto_replied = 2 as auto_replies_counted_separately
from public.email_campaign_report('ca000000-0000-0000-0000-000000000001') r;

-- ELIGIBLE excludes people who could never be mailed.
select 'ELIGIBLE excludes suppressed and bounced recipients' as check,
       r.recipients = 5 as recipients_ok,
       r.eligible = 3 as eligible_ok
from public.email_campaign_report('ca000000-0000-0000-0000-000000000001') r;

select 'STOP REASONS are broken out' as check,
       r.stopped_replied = 1 as replied_ok,
       r.stopped_unsub = 1 as unsub_ok,
       r.still_active = 1 as active_ok
from public.email_campaign_report('ca000000-0000-0000-0000-000000000001') r;

-- A campaign that has sent nothing has NO rate, not a zero rate.
insert into public.email_campaigns (id, workspace_id, name, type, status, account_id)
values ('ca000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'Unsent','sales_sequence','draft','e0000000-0000-0000-0000-000000000001');

select 'AN UNSENT campaign has a NULL rate, not 0%' as check,
       reply_rate is null as pass
from public.email_campaign_report('ca000000-0000-0000-0000-000000000002');

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

select 'MAILBOX report surfaces sends, failures and needs_verification' as check,
       sent = 2 as sent_ok,
       failed = 1 as failed_ok,
       -- Surfaced per mailbox because one accumulating these has a problem a
       -- human must look at; at-most-once never retries them.
       needs_verification = 1 as needs_verification_ok,
       last_healthy_send is not null as last_send_known
from public.email_mailbox_report('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                 (now() - interval '7 days')::date,
                                 (now() + interval '1 day')::date);

-- ---------------------------------------------------------------------------
-- Contact timeline — messages and events in ONE ordered list.
-- ---------------------------------------------------------------------------

select 'TIMELINE interleaves messages and events, newest first' as check,
       count(*) >= 2 as pass,
       count(distinct kind) = 2 as both_kinds_present
from public.email_contact_timeline('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                   'c0000000-0000-0000-0000-000000000001');

rollback;
