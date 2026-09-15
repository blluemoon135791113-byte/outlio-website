-- Smoke test for 0091 — the append-only / ON DELETE SET NULL conflict.
--
-- Proves the bug is gone and that the erasure path works, which is the one
-- that actually mattered: a GDPR right-to-erasure request would have failed
-- with a raw database error.
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. The `select … as pass` rows here used
-- to fail nothing: an `f` printed and the harness exited 0. Each check now goes
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
do $$
begin
  perform public.record_email_event(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'replied', 'dana@buyer.example',
    null, 'eb000000-0000-0000-0000-000000000001',
    'ca000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001');
end
$$;

-- ---------------------------------------------------------------------------
-- The deletion is now REFUSED cleanly, rather than failing with an
-- append-only error nobody could interpret.
-- ---------------------------------------------------------------------------

do $$
declare
  v_fk boolean := false;
begin
  begin
    delete from public.email_enrollments where id = 'eb000000-0000-0000-0000-000000000001';
  exception
    when foreign_key_violation then
      -- The RIGHT error: "something still references this", not "this table is
      -- append-only", which was a confusing symptom of the wrong cause.
      v_fk := true;
    when others then
      raise exception 'FAIL: wrong error (%): %', sqlstate, sqlerrm;
  end;

  insert into smoke_checks (label, ok)
  values ('DELETING a referenced enrollment is refused as an FK violation', v_fk);
end
$$;

-- ---------------------------------------------------------------------------
-- THE CASE THAT ACTUALLY MATTERED — erasure now completes.
-- ---------------------------------------------------------------------------

do $$
declare
  v_done boolean := false;
begin
  begin
    perform set_config('outlio.erasure', 'on', true);
    delete from public.email_events where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    delete from public.email_enrollments where id = 'eb000000-0000-0000-0000-000000000001';
    perform set_config('outlio.erasure', 'off', true);
    v_done := true;
  exception
    when others then
      raise notice 'erasure path broke (%): %', sqlstate, sqlerrm;
  end;

  insert into smoke_checks (label, ok)
  values ('ERASURE can remove events and their enrollments', v_done);
end
$$;

insert into smoke_checks (label, ok)
select 'ERASURE removed the events', coalesce(count(*) = 0, false)
from public.email_events where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- ---------------------------------------------------------------------------
-- Workspace teardown still cascades, which the guard permits by design.
-- ---------------------------------------------------------------------------

do $$
begin
  perform public.record_email_event(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sent', 'dana@buyer.example',
    null, null, 'ca000000-0000-0000-0000-000000000001');
end
$$;

do $$
declare
  v_done boolean := false;
begin
  begin
    delete from public.workspaces where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    v_done := true;
  exception
    when others then
      raise notice 'workspace teardown broke (%): %', sqlstate, sqlerrm;
  end;

  insert into smoke_checks (label, ok)
  values ('DELETING a workspace cascades through its events', v_done);
end
$$;

insert into smoke_checks (label, ok)
select 'WORKSPACE teardown removed everything', coalesce(count(*) = 0, false)
from public.email_events;

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 5;
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
