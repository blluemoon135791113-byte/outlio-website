-- Smoke test for 0085 — email sending accounts (M5 Phase 11).
--
-- Proves the two things Phase 11 claims: an account's secret is unreachable
-- through the authenticated role no matter how it is asked for (M5 acceptance
-- criterion 1), and the table permits the cardinality the product needs and
-- refuses the cardinality it must not.
--
-- ⚠️ EVERY CHECK IS RECORDED, THEN GATED. The `select … as pass` rows here used
-- to fail nothing: an `f` printed and the harness exited 0. Each check now goes
-- into `smoke_checks` through `coalesce(…, false)`, and the gate at the end
-- raises unless exactly the expected number were recorded and every one is true.
--
-- ⚠️ ROLE-SCOPED CHECKS SWITCH ROLE INSIDE A DO BLOCK, read into a variable,
-- switch back, THEN record: `authenticated` cannot write to smoke_checks.

\set ON_ERROR_STOP on

begin;

create temp table smoke_checks (
  n     serial primary key,
  label text not null,
  ok    boolean not null
);

-- Two members of one workspace, plus an outsider.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'setter@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'outsider@example.com')
on conflict do nothing;

insert into public.workspaces (id, name, owner_user_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Acme', '11111111-1111-1111-1111-111111111111')
on conflict do nothing;

insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'setter')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- MANY MAILBOXES PER WORKSPACE — the whole reason this is not
-- integration_connections, whose unique (user_id, provider) forbids it.
-- ---------------------------------------------------------------------------

insert into public.email_accounts
  (id, workspace_id, provider, scope, owner_user_id, display_name, from_email, from_domain)
values
  ('e0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'gmail', 'personal', '11111111-1111-1111-1111-111111111111',
   'Owner primary', 'owner@acme.example', 'acme.example'),
  ('e0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'gmail', 'personal', '11111111-1111-1111-1111-111111111111',
   'Owner second', 'owner2@acme.example', 'acme.example'),
  ('e0000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'smtp', 'workspace', '11111111-1111-1111-1111-111111111111',
   'Shared sales', 'sales@acme.example', 'acme.example'),
  ('e0000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'smtp', 'personal', '22222222-2222-2222-2222-222222222222',
   'Setter mailbox', 'setter@acme.example', 'acme.example');

insert into smoke_checks (label, ok)
select 'CARDINALITY two gmail accounts for one user', coalesce(count(*) = 2, false)
from public.email_accounts
where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and provider = 'gmail'
  and owner_user_id = '11111111-1111-1111-1111-111111111111';

-- ...but the same ADDRESS twice in one workspace is a mistake, not a feature.
do $$
declare
  v_rejected boolean := false;
begin
  begin
    insert into public.email_accounts
      (workspace_id, provider, scope, owner_user_id, display_name, from_email, from_domain)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'smtp', 'personal',
            '11111111-1111-1111-1111-111111111111',
            'Duplicate', 'sales@acme.example', 'acme.example');
  exception
    when unique_violation then
      v_rejected := true;
  end;

  insert into smoke_checks (label, ok)
  values ('DUPLICATE live address rejected', v_rejected);
end
$$;

-- A soft-deleted account must not block reconnecting the same address.
update public.email_accounts
   set deleted_at = now()
 where id = 'e0000000-0000-0000-0000-000000000004';

insert into public.email_accounts
  (workspace_id, provider, scope, owner_user_id, display_name, from_email, from_domain)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'smtp', 'personal',
        '22222222-2222-2222-2222-222222222222',
        'Setter reconnected', 'setter@acme.example', 'acme.example');

-- Was `select … true as pass`, which could not print anything else.
insert into smoke_checks (label, ok)
select 'RECONNECT after soft delete allowed', coalesce(count(*) = 1, false)
from public.email_accounts
where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and from_email = 'setter@acme.example'
  and deleted_at is null;

-- ---------------------------------------------------------------------------
-- CRITERION 1 — the secret is unreachable through the authenticated role.
-- ---------------------------------------------------------------------------

insert into public.email_account_secrets (id, account_id, encrypted_payload)
select secret_reference, id, 'v1.aaaa.bbbb.cccc-PRETEND-ENVELOPE'
from public.email_accounts
where id = 'e0000000-0000-0000-0000-000000000001';

-- The service role can read it; that is how the send path works at all.
insert into smoke_checks (label, ok)
select 'SERVICE ROLE can read the envelope', coalesce(count(*) = 1, false)
from public.email_account_secrets;

/*
 * ⚠️ THE RESULT IS `permission denied`, NOT AN EMPTY SET — and that is the
 * stronger outcome. The grant was revoked from `authenticated` entirely, so
 * the query is refused before RLS is ever consulted. RLS with no policy would
 * have returned zero rows; this returns an error. Both satisfy criterion 1,
 * and having both is the point: two independent layers, either of which alone
 * would hold.
 *
 * Every shape below is a query a curious client could actually write, and each
 * must fail the same way — asserted rather than assumed, because "I could not
 * think of a query that works" is not evidence.
 */
do $$
declare
  attempts text[] := array[
    'select count(*) from public.email_account_secrets',
    'select count(*) from public.email_accounts a join public.email_account_secrets s on s.account_id = a.id',
    'select count(*) from public.email_account_secrets where id in (select secret_reference from public.email_accounts)',
    'select encrypted_payload from public.email_account_secrets limit 1'
  ];
  attempt text;
  blocked integer := 0;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;

  foreach attempt in array attempts loop
    begin
      execute attempt;
    exception
      when insufficient_privilege then
        blocked := blocked + 1;
    end;
  end loop;

  reset role;

  insert into smoke_checks (label, ok)
  values ('CRITERION 1: all 4 secret-read attempts denied to authenticated',
          blocked = array_length(attempts, 1));
end
$$;

-- ---------------------------------------------------------------------------
-- RLS on the accounts themselves.
-- ---------------------------------------------------------------------------

-- A setter sees the shared mailbox and their own, and NOT the owner's two
-- personal ones.
do $$
declare
  v_total  integer;
  v_shared integer;
  v_own    integer;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;

  select count(*),
         count(*) filter (where scope = 'workspace'),
         count(*) filter (where owner_user_id = '22222222-2222-2222-2222-222222222222')
    into v_total, v_shared, v_own
    from public.email_accounts
   where deleted_at is null;

  reset role;

  insert into smoke_checks (label, ok) values
    ('SETTER sees exactly 2 live mailboxes', v_total = 2),
    ('SETTER sees the shared mailbox', v_shared = 1),
    ('SETTER sees their own mailbox', v_own = 1);
end
$$;

-- The workspace owner is management: they see every mailbox, which is what the
-- per-mailbox health report needs.
do $$
declare
  v_total integer;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;

  select count(*) into v_total from public.email_accounts where deleted_at is null;

  reset role;

  insert into smoke_checks (label, ok)
  values ('OWNER sees every live mailbox', v_total = 4);
end
$$;

do $$
declare
  v_total integer;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  set local role authenticated;

  select count(*) into v_total from public.email_accounts;

  reset role;

  insert into smoke_checks (label, ok)
  values ('OUTSIDER sees nothing', v_total = 0);
end
$$;

-- ---------------------------------------------------------------------------
-- Constraints that stop nonsense configurations.
-- ---------------------------------------------------------------------------

do $$
declare
  v_rejected boolean := false;
begin
  begin
    insert into public.email_accounts
      (workspace_id, provider, scope, owner_user_id, display_name, from_email,
       from_domain, send_window_start, send_window_end)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'smtp', 'personal',
            '11111111-1111-1111-1111-111111111111', 'Backwards window',
            'backwards@acme.example', 'acme.example', '17:00', '09:00');
  exception
    when check_violation then
      v_rejected := true;
  end;

  insert into smoke_checks (label, ok)
  values ('INVERTED send window rejected', v_rejected);
end
$$;

do $$
declare
  v_rejected boolean := false;
begin
  begin
    insert into public.email_accounts
      (workspace_id, provider, scope, owner_user_id, display_name, from_email,
       from_domain, send_days)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'smtp', 'personal',
            '11111111-1111-1111-1111-111111111111', 'Day eight',
            'dayeight@acme.example', 'acme.example', '{8}');
  exception
    when check_violation then
      v_rejected := true;
  end;

  insert into smoke_checks (label, ok)
  values ('OUT-OF-RANGE weekday rejected', v_rejected);
end
$$;

do $$
declare
  v_rejected boolean := false;
begin
  begin
    insert into public.email_accounts
      (workspace_id, provider, scope, owner_user_id, display_name, from_email, from_domain)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'smtp', 'personal',
            '11111111-1111-1111-1111-111111111111', 'Shouty',
            'MixedCase@acme.example', 'acme.example');
  exception
    when check_violation then
      v_rejected := true;
  end;

  insert into smoke_checks (label, ok)
  values ('NON-LOWERCASED address rejected', v_rejected);
end
$$;

-- Deleting the account takes its secret with it. An orphaned envelope is a
-- credential nobody is watching.
delete from public.email_accounts where id = 'e0000000-0000-0000-0000-000000000001';

insert into smoke_checks (label, ok)
select 'CASCADE secret removed with its account', coalesce(count(*) = 0, false)
from public.email_account_secrets;

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 14;
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
