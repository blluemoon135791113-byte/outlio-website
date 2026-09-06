-- Smoke test for 0091 — the append-only / ON DELETE SET NULL conflict.
--
-- Proves the bug is gone and that the erasure path works, which is the one
-- that actually mattered: a GDPR right-to-erasure request would have failed
-- with a raw database error.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com') on conflict do nothing;
insert into public.workspaces (id, name, owner_user_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Acme', '11111111-1111-1111-1111-111111111111')
on conflict do nothing;
insert into public.workspace_memberships (workspace_id, user_id, role)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner')
on conflict do nothing;

insert into public.email_accounts
  (id, workspace_id, provider, scope, owner_user_id, display_name, from_email, from_domain)
values ('e0000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'smtp','workspace','11111111-1111-1111-1111-111111111111','Sales','s@acme.example','acme.example');

insert into public.crm_contacts (id, workspace_id, first_name, last_name, full_name)
values ('c0000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'Dana','Reyes','Dana Reyes');

insert into public.email_campaigns (id, workspace_id, name, type, status, account_id)
values ('ca000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'Q3','sales_sequence','running','e0000000-0000-0000-0000-000000000001');

insert into public.email_enrollments (id, workspace_id, campaign_id, contact_id, to_email)
values ('eb000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'ca000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',
        'dana@buyer.example');

-- An event pointing at all of it. This is the row that used to make every
-- referenced record permanently undeletable.
select public.record_email_event(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'replied', 'dana@buyer.example',
  null, 'eb000000-0000-0000-0000-000000000001',
  'ca000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- The deletion is now REFUSED cleanly, rather than failing with an
-- append-only error nobody could interpret.
-- ---------------------------------------------------------------------------

do $$
begin
  delete from public.email_enrollments where id = 'eb000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: an enrollment with events was deleted';
exception
  when foreign_key_violation then
    -- The RIGHT error: "something still references this", not "this table is
    -- append-only", which was a confusing symptom of the wrong cause.
    raise notice 'PASS deleting a referenced enrollment is refused as an FK violation';
  when others then
    raise exception 'FAIL: wrong error (%): %', sqlstate, sqlerrm;
end
$$;

-- ---------------------------------------------------------------------------
-- THE CASE THAT ACTUALLY MATTERED — erasure now completes.
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('outlio.erasure', 'on', true);
  delete from public.email_events where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  delete from public.email_enrollments where id = 'eb000000-0000-0000-0000-000000000001';
  perform set_config('outlio.erasure', 'off', true);
  raise notice 'PASS erasure can remove events and their enrollments';
exception
  when others then
    raise exception 'FAIL: erasure path broke (%): %', sqlstate, sqlerrm;
end
$$;

select 'ERASURE removed the events' as check,
       count(*) = 0 as pass
from public.email_events where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- ---------------------------------------------------------------------------
-- Workspace teardown still cascades, which the guard permits by design.
-- ---------------------------------------------------------------------------

select public.record_email_event(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sent', 'dana@buyer.example',
  null, null, 'ca000000-0000-0000-0000-000000000001');

do $$
begin
  delete from public.workspaces where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  raise notice 'PASS deleting a workspace cascades through its events';
exception
  when others then
    raise exception 'FAIL: workspace teardown broke (%): %', sqlstate, sqlerrm;
end
$$;

select 'WORKSPACE teardown removed everything' as check,
       (select count(*) from public.email_events) = 0 as pass;

rollback;
