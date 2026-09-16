-- Smoke test for 0090 — email events (M6 Phase 17).
--
-- M6 ACCEPTANCE CRITERION 4: "duplicate provider webhook deliveries processed
-- exactly once."
-- M6 ACCEPTANCE CRITERION 5: "campaign reports reconcile with raw
-- email_events."
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. The `select … as pass` rows here used
-- to fail nothing: an `f` printed and the harness exited 0. Each check now goes
-- into `smoke_checks` through `coalesce(…, false)`, and the gate at the end
-- raises unless exactly the expected number were recorded and every one is true.
--
-- ⚠️ THE APPEND-ONLY REFUSALS CATCH restrict_violation, NOT `others`. The guard
-- is 0075's crm_guard_append_only; catching every error would also have passed
-- an update that failed for an unrelated reason, such as a renamed column.

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

insert into smoke_checks (label, ok)
values ('FIRST delivery of a provider event is recorded',
        coalesce(public.record_email_event(
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'delivered', 'dana@buyer.example',
          null, null, 'ca000000-0000-0000-0000-000000000001', null,
          'provider-evt-abc123') = true, false));

insert into smoke_checks (label, ok)
select 'CRITERION 4: REPEAT deliveries are all rejected', coalesce(bool_and(result = false), false)
from (
  select public.record_email_event(
           'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'delivered', 'dana@buyer.example',
           null, null, 'ca000000-0000-0000-0000-000000000001', null,
           'provider-evt-abc123') as result
  from generate_series(1, 4)
) repeats;

insert into smoke_checks (label, ok)
select 'CRITERION 4: EXACTLY ONE row exists for that provider event', coalesce(count(*) = 1, false)
from public.email_events where provider_event_id = 'provider-evt-abc123';

-- A different event id from the same provider is a different event.
insert into smoke_checks (label, ok)
values ('A DIFFERENT provider event is recorded normally',
        coalesce(public.record_email_event(
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'delivered', 'sam@buyer.example',
          null, null, 'ca000000-0000-0000-0000-000000000001', null,
          'provider-evt-xyz789') = true, false));

-- ⚠️ The same provider id in ANOTHER workspace must not collide. Providers do
-- not know about our tenancy, and two customers can hold the same event id.
insert into smoke_checks (label, ok)
values ('THE SAME id in another workspace is not a duplicate',
        coalesce(public.record_email_event(
          'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'delivered', 'dana@buyer.example',
          null, null, null, null, 'provider-evt-abc123') = true, false));

-- ---------------------------------------------------------------------------
-- Events WE generate have no provider id, and several may coexist.
-- ---------------------------------------------------------------------------

insert into smoke_checks (label, ok)
select 'OUR OWN events are never deduped against each other', coalesce(bool_and(result), false)
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
declare
  v_refused boolean := false;
begin
  begin
    update public.email_events set type = 'replied' where provider_event_id = 'provider-evt-abc123';
  exception
    when restrict_violation then
      v_refused := true;
  end;

  insert into smoke_checks (label, ok)
  values ('EVENTS cannot be updated', v_refused);
end
$$;

do $$
declare
  v_refused boolean := false;
begin
  begin
    delete from public.email_events where provider_event_id = 'provider-evt-abc123';
  exception
    when restrict_violation then
      v_refused := true;
  end;

  insert into smoke_checks (label, ok)
  values ('EVENTS cannot be deleted', v_refused);
end
$$;

-- ---------------------------------------------------------------------------
-- CRITERION 5 — totals come from the stream, and auto-replies stay out of the
-- reply count.
-- ---------------------------------------------------------------------------

do $$
begin
  perform public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','replied',
    'dana@buyer.example', null, null, 'ca000000-0000-0000-0000-000000000001');
  perform public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','auto_replied',
    'sam@buyer.example', null, null, 'ca000000-0000-0000-0000-000000000001');
  perform public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','auto_replied',
    'kim@buyer.example', null, null, 'ca000000-0000-0000-0000-000000000001');
  perform public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bounced',
    'gone@buyer.example', null, null, 'ca000000-0000-0000-0000-000000000001');
  perform public.record_email_event('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','unsubscribed',
    'nope@buyer.example', null, null, 'ca000000-0000-0000-0000-000000000001');
end
$$;

insert into smoke_checks (label, ok) values
  ('TOTALS: 3 sent',
   coalesce((select t.sent = 3
               from public.campaign_event_totals('ca000000-0000-0000-0000-000000000001') t), false)),
  ('TOTALS: 2 delivered',
   coalesce((select t.delivered = 2
               from public.campaign_event_totals('ca000000-0000-0000-0000-000000000001') t), false)),
  ('TOTALS: 1 replied',
   coalesce((select t.replied = 1
               from public.campaign_event_totals('ca000000-0000-0000-0000-000000000001') t), false)),
  -- The two auto-replies are counted separately and NEVER as replies: an
  -- inflated reply rate is worse than none, because people act on it.
  ('TOTALS: 2 auto-replies, counted separately',
   coalesce((select t.auto_replied = 2
               from public.campaign_event_totals('ca000000-0000-0000-0000-000000000001') t), false)),
  ('TOTALS: 1 bounced',
   coalesce((select t.bounced = 1
               from public.campaign_event_totals('ca000000-0000-0000-0000-000000000001') t), false)),
  ('TOTALS: 1 unsubscribed',
   coalesce((select t.unsubscribed = 1
               from public.campaign_event_totals('ca000000-0000-0000-0000-000000000001') t), false));

insert into smoke_checks (label, ok)
values ('CRITERION 5: TOTALS equal a direct count of the stream',
        coalesce(
          (select sent + delivered + replied + auto_replied + bounced + unsubscribed + complaints + failed
             from public.campaign_event_totals('ca000000-0000-0000-0000-000000000001'))
          = (select count(*) from public.email_events
              where campaign_id = 'ca000000-0000-0000-0000-000000000001'), false));

-- ---------------------------------------------------------------------------
-- Webhook delivery replay protection.
-- ---------------------------------------------------------------------------

insert into public.email_webhook_deliveries (workspace_id, provider, delivery_key)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'smtp', 'delivery-001');

do $$
declare
  v_rejected boolean := false;
begin
  begin
    insert into public.email_webhook_deliveries (workspace_id, provider, delivery_key)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'smtp', 'delivery-001');
  exception
    when unique_violation then
      v_rejected := true;
  end;

  insert into smoke_checks (label, ok)
  values ('DUPLICATE webhook delivery rejected', v_rejected);
end
$$;

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 16;
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
