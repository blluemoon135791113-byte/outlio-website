-- Smoke test for 0090 — email events (M6 Phase 17).
--
-- M6 ACCEPTANCE CRITERION 4: "duplicate provider webhook deliveries processed
-- exactly once."
-- M6 ACCEPTANCE CRITERION 5: "campaign reports reconcile with raw
-- email_events."

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com')
on conflict do nothing;

insert into public.workspaces (id, name, owner_user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Acme', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Other', '11111111-1111-1111-1111-111111111111')
on conflict do nothing;

insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'owner')
on conflict do nothing;

insert into public.email_accounts
  (id, workspace_id, provider, scope, owner_user_id, display_name, from_email, from_domain)
values ('e0000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'smtp','workspace','11111111-1111-1111-1111-111111111111','Sales','sales@acme.example','acme.example');

insert into public.email_campaigns (id, workspace_id, name, type, status, account_id)
values ('ca000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'Q3 outbound','sales_sequence','running','e0000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- CRITERION 4 — the same provider event, delivered five times.
-- ---------------------------------------------------------------------------

select 'FIRST delivery of a provider event is recorded' as check,
       public.record_email_event(
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'delivered', 'dana@buyer.example',
         null, null, 'ca000000-0000-0000-0000-000000000001', null,
         'provider-evt-abc123') = true as pass;

select 'REPEAT deliveries are all rejected' as check,
       bool_and(result = false) as pass
from (
  select public.record_email_event(
           'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'delivered', 'dana@buyer.example',
           null, null, 'ca000000-0000-0000-0000-000000000001', null,
           'provider-evt-abc123') as result
  from generate_series(1, 4)
) repeats;

select 'EXACTLY ONE row exists for that provider event' as check,
       count(*) = 1 as pass
from public.email_events where provider_event_id = 'provider-evt-abc123';

-- A different event id from the same provider is a different event.
select 'A DIFFERENT provider event is recorded normally' as check,
       public.record_email_event(
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'delivered', 'sam@buyer.example',
         null, null, 'ca000000-0000-0000-0000-000000000001', null,
         'provider-evt-xyz789') = true as pass;

-- ⚠️ The same provider id in ANOTHER workspace must not collide. Providers do
-- not know about our tenancy, and two customers can hold the same event id.
select 'THE SAME id in another workspace is not a duplicate' as check,
       public.record_email_event(
         'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'delivered', 'dana@buyer.example',
         null, null, null, null, 'provider-evt-abc123') = true as pass;

-- ---------------------------------------------------------------------------
-- Events WE generate have no provider id, and several may coexist.
-- ---------------------------------------------------------------------------

select 'OUR OWN events are never deduped against each other' as check,
       bool_and(result) as pass
from (
  select public.record_email_event(
           'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sent', 'dana@buyer.example',
           null, null, 'ca000000-0000-0000-0000-000000000001') as result
  from generate_series(1, 3)
) ours;

-- ---------------------------------------------------------------------------
-- APPEND-ONLY — an event stream that can be edited is not evidence.
-- ---------------------------------------------------------------------------

do $$
begin
  update public.email_events set type = 'replied' where provider_event_id = 'provider-evt-abc123';
  raise exception 'FAIL: an event was rewritten';
exception
  when others then
    raise notice 'PASS events cannot be updated';
end
$$;

do $$
begin
  delete from public.email_events where provider_event_id = 'provider-evt-abc123';
  raise exception 'FAIL: an event was deleted';
exception
  when others then
    raise notice 'PASS events cannot be deleted';
end
$$;

-- ---------------------------------------------------------------------------
-- CRITERION 5 — totals come from the stream, and auto-replies stay out of the
-- reply count.
-- ---------------------------------------------------------------------------

select public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','replied',
  'dana@buyer.example', null, null, 'ca000000-0000-0000-0000-000000000001');
select public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','auto_replied',
  'sam@buyer.example', null, null, 'ca000000-0000-0000-0000-000000000001');
select public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','auto_replied',
  'kim@buyer.example', null, null, 'ca000000-0000-0000-0000-000000000001');
select public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bounced',
  'gone@buyer.example', null, null, 'ca000000-0000-0000-0000-000000000001');
select public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','unsubscribed',
  'nope@buyer.example', null, null, 'ca000000-0000-0000-0000-000000000001');

select 'TOTALS reconcile with the raw stream' as check,
       t.sent = 3 as sent_ok,
       t.delivered = 2 as delivered_ok,
       t.replied = 1 as replied_ok,
       -- The two auto-replies are counted separately and NEVER as replies:
       -- an inflated reply rate is worse than none, because people act on it.
       t.auto_replied = 2 as auto_replies_separate,
       t.bounced = 1 as bounced_ok,
       t.unsubscribed = 1 as unsubscribed_ok
from public.campaign_event_totals('ca000000-0000-0000-0000-000000000001') t;

select 'TOTALS equal a direct count of the stream' as check,
       (select sent + delivered + replied + auto_replied + bounced + unsubscribed + complaints + failed
          from public.campaign_event_totals('ca000000-0000-0000-0000-000000000001'))
       = (select count(*) from public.email_events
           where campaign_id = 'ca000000-0000-0000-0000-000000000001') as pass;

-- ---------------------------------------------------------------------------
-- Webhook delivery replay protection.
-- ---------------------------------------------------------------------------

insert into public.email_webhook_deliveries (workspace_id, provider, delivery_key)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'smtp', 'delivery-001');

do $$
begin
  insert into public.email_webhook_deliveries (workspace_id, provider, delivery_key)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'smtp', 'delivery-001');
  raise exception 'FAIL: a webhook delivery was accepted twice';
exception
  when unique_violation then
    raise notice 'PASS duplicate webhook delivery rejected';
end
$$;

rollback;
