-- Smoke test for 0088 — campaigns, sequences and enrollments (M6 Phase 15).
--
-- The claim under test is the one the constitution names directly: step state
-- lives on the ENROLLMENT, so one real person can be in several sequences at
-- once without being duplicated — and a reply stops all of them AND cancels
-- their queued mail in a single call.

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
values ('e0000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'smtp','workspace','11111111-1111-1111-1111-111111111111','Sales','sales@acme.example','acme.example');

-- ONE contact. This is the whole point.
-- `full_name` is required by crm_contacts_has_identity: a contact needs a
-- name or a LinkedIn identity key, not just name parts.
insert into public.crm_contacts (id, workspace_id, first_name, last_name, full_name)
values ('c0000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Dana','Reyes','Dana Reyes');

insert into public.email_campaigns (id, workspace_id, name, type, status, account_id) values
  ('ca000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Q3 outbound','sales_sequence','running','e0000000-0000-0000-0000-000000000001'),
  ('ca000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Partner intro','sales_sequence','running','e0000000-0000-0000-0000-000000000001'),
  ('ca000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Monthly newsletter','marketing_broadcast','running','e0000000-0000-0000-0000-000000000001');

insert into public.email_sequence_steps
  (workspace_id, campaign_id, step_index, wait_hours, subject, body_text)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ca000000-0000-0000-0000-000000000001',0,0,'Hello','b'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ca000000-0000-0000-0000-000000000001',1,72,'Following up','b'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ca000000-0000-0000-0000-000000000001',2,168,'Last note','b');

-- ---------------------------------------------------------------------------
-- ONE PERSON, THREE SEQUENCES, ONE CONTACT ROW.
-- ---------------------------------------------------------------------------

insert into public.email_enrollments
  (id, workspace_id, campaign_id, contact_id, to_email, current_step, next_action_at)
values
  ('eb000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'ca000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',
   'dana@buyer.example', 1, now() + interval '3 days'),
  ('eb000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'ca000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001',
   'dana@buyer.example', 0, now() + interval '1 day'),
  ('eb000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'ca000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000001',
   'dana@buyer.example', 0, now() + interval '2 days');

select 'ONE contact row despite three enrollments' as check,
       count(*) = 1 as pass
from public.crm_contacts
where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select 'THREE independent step pointers for one person' as check,
       count(*) = 3 as pass,
       count(distinct current_step) = 2 as steps_differ
from public.email_enrollments
where contact_id = 'c0000000-0000-0000-0000-000000000001';

-- ...and the same person cannot be enrolled twice in one campaign.
do $$
begin
  insert into public.email_enrollments
    (workspace_id, campaign_id, contact_id, to_email)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ca000000-0000-0000-0000-000000000001',
          'c0000000-0000-0000-0000-000000000001','dana@buyer.example');
  raise exception 'FAIL: a second active enrollment was accepted';
exception
  when unique_violation then
    raise notice 'PASS duplicate active enrollment rejected';
end
$$;

-- ---------------------------------------------------------------------------
-- A STOPPED ENROLLMENT MUST SAY WHY.
-- ---------------------------------------------------------------------------

do $$
begin
  update public.email_enrollments
     set status = 'stopped', stopped_at = now()
   where id = 'eb000000-0000-0000-0000-000000000002';
  raise exception 'FAIL: an enrollment was stopped with no reason';
exception
  when check_violation then
    raise notice 'PASS a stop without a reason is rejected';
end
$$;

-- ---------------------------------------------------------------------------
-- CRITERION 1 groundwork — a reply stops every live sequence AND cancels the
-- mail already sitting in the queue.
-- ---------------------------------------------------------------------------

-- ⚠️ `sent_at` is set in the INSERT, not by a later UPDATE. 0086's
-- immutability trigger refuses to let a sent message's sent_at change — which
-- is the trigger doing its job, and worth leaving proven here.
insert into public.email_messages
  (workspace_id, account_id, enrollment_id, to_email, subject, body_text,
   idempotency_key, status, scheduled_at, sent_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-000000000001',
   'eb000000-0000-0000-0000-000000000001','dana@buyer.example','Following up','b',
   'q-1','queued', now() + interval '3 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-000000000001',
   'eb000000-0000-0000-0000-000000000002','dana@buyer.example','Hello','b',
   'q-2','queued', now() + interval '1 day', null),
  -- Already sent: must NOT be touched by a stop.
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-000000000001',
   'eb000000-0000-0000-0000-000000000001','dana@buyer.example','Hello','b',
   'q-3','sent', now() - interval '3 days', now() - interval '3 days');

select 'REPLY stops every live sales enrollment' as check,
       public.stop_enrollments_for_email(
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dana@buyer.example', 'replied') = 3 as pass;

select 'STOPPED enrollments record the reason and the time' as check,
       count(*) = 3 as pass
from public.email_enrollments
where contact_id = 'c0000000-0000-0000-0000-000000000001'
  and status = 'stopped'
  and stop_reason = 'replied'
  and replied_at is not null
  and next_action_at is null;

select 'QUEUED mail for those enrollments is cancelled' as check,
       count(*) = 2 as pass
from public.email_messages
where status = 'cancelled'
  and error_code = 'ENROLLMENT_STOPPED';

select 'ALREADY-SENT mail is untouched by a stop' as check,
       status = 'sent' as pass
from public.email_messages where idempotency_key = 'q-3';

-- ---------------------------------------------------------------------------
-- Scoping: a stop aimed at one campaign leaves the others alone.
-- ---------------------------------------------------------------------------

insert into public.crm_contacts (id, workspace_id, first_name, last_name, full_name)
values ('c0000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Sam','Okafor','Sam Okafor');

insert into public.email_enrollments (workspace_id, campaign_id, contact_id, to_email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ca000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000002','sam@buyer.example'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ca000000-0000-0000-0000-000000000003',
   'c0000000-0000-0000-0000-000000000002','sam@buyer.example');

select 'A CAMPAIGN-SCOPED stop touches only that campaign' as check,
       public.stop_enrollments_for_email(
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','sam@buyer.example','unsubscribed',
         'ca000000-0000-0000-0000-000000000003') = 1 as pass;

select 'The other campaign’s enrollment survives' as check,
       status = 'active' as pass
from public.email_enrollments
where contact_id = 'c0000000-0000-0000-0000-000000000002'
  and campaign_id = 'ca000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- Re-enrollment after an enrollment has ended is allowed.
-- ---------------------------------------------------------------------------

insert into public.email_enrollments (workspace_id, campaign_id, contact_id, to_email)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ca000000-0000-0000-0000-000000000001',
        'c0000000-0000-0000-0000-000000000001','dana@buyer.example');

select 'RE-ENROLLMENT is allowed once the previous one ended' as check,
       count(*) = 2 as pass
from public.email_enrollments
where contact_id = 'c0000000-0000-0000-0000-000000000001'
  and campaign_id = 'ca000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- Step ordering is unique per campaign.
-- ---------------------------------------------------------------------------

do $$
begin
  insert into public.email_sequence_steps
    (workspace_id, campaign_id, step_index, subject, body_text)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ca000000-0000-0000-0000-000000000001',
          1,'Duplicate position','b');
  raise exception 'FAIL: two steps took the same position';
exception
  when unique_violation then
    raise notice 'PASS duplicate step index rejected';
end
$$;

rollback;
