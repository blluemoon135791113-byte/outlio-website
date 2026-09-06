-- Smoke test for 0085 — email sending accounts (M5 Phase 11).
--
-- Proves the two things Phase 11 claims: an account's secret is unreachable
-- through the authenticated role no matter how it is asked for (M5 acceptance
-- criterion 1), and the table permits the cardinality the product needs and
-- refuses the cardinality it must not.

\set ON_ERROR_STOP on

begin;

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

select 'CARDINALITY two gmail accounts for one user' as check,
       count(*) = 2 as pass
from public.email_accounts
where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and provider = 'gmail'
  and owner_user_id = '11111111-1111-1111-1111-111111111111';

-- ...but the same ADDRESS twice in one workspace is a mistake, not a feature.
do $$
begin
  insert into public.email_accounts
    (workspace_id, provider, scope, owner_user_id, display_name, from_email, from_domain)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'smtp', 'personal',
          '11111111-1111-1111-1111-111111111111',
          'Duplicate', 'sales@acme.example', 'acme.example');
  raise exception 'FAIL: a duplicate live address was accepted';
exception
  when unique_violation then
    raise notice 'PASS duplicate live address rejected';
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

select 'RECONNECT after soft delete allowed' as check, true as pass;

-- ---------------------------------------------------------------------------
-- CRITERION 1 — the secret is unreachable through the authenticated role.
-- ---------------------------------------------------------------------------

insert into public.email_account_secrets (id, account_id, encrypted_payload)
select secret_reference, id, 'v1.aaaa.bbbb.cccc-PRETEND-ENVELOPE'
from public.email_accounts
where id = 'e0000000-0000-0000-0000-000000000001';

-- The service role can read it; that is how the send path works at all.
select 'SERVICE ROLE can read the envelope' as check,
       count(*) = 1 as pass
from public.email_account_secrets;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

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
  foreach attempt in array attempts loop
    begin
      execute attempt;
      raise exception 'FAIL: authenticated reached the secrets table with: %', attempt;
    exception
      when insufficient_privilege then
        blocked := blocked + 1;
    end;
  end loop;

  if blocked <> array_length(attempts, 1) then
    raise exception 'FAIL: only % of % attempts were blocked', blocked, array_length(attempts, 1);
  end if;

  raise notice 'PASS all % secret-read attempts denied to authenticated', blocked;
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- RLS on the accounts themselves.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- A setter sees the shared mailbox and their own, and NOT the owner's two
-- personal ones.
select 'SETTER sees shared + own only' as check,
       count(*) = 2 as pass,
       count(*) filter (where scope = 'workspace') = 1 as shared_visible,
       count(*) filter (where owner_user_id = '22222222-2222-2222-2222-222222222222') = 1 as own_visible
from public.email_accounts
where deleted_at is null;

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- The workspace owner is management: they see every mailbox, which is what the
-- per-mailbox health report needs.
select 'OWNER sees every live mailbox' as check,
       count(*) = 4 as pass
from public.email_accounts
where deleted_at is null;

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select 'OUTSIDER sees nothing' as check,
       count(*) = 0 as pass
from public.email_accounts;

reset role;

-- ---------------------------------------------------------------------------
-- Constraints that stop nonsense configurations.
-- ---------------------------------------------------------------------------

do $$
begin
  insert into public.email_accounts
    (workspace_id, provider, scope, owner_user_id, display_name, from_email,
     from_domain, send_window_start, send_window_end)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'smtp', 'personal',
          '11111111-1111-1111-1111-111111111111', 'Backwards window',
          'backwards@acme.example', 'acme.example', '17:00', '09:00');
  raise exception 'FAIL: an inverted send window was accepted';
exception
  when check_violation then
    raise notice 'PASS inverted send window rejected';
end
$$;

do $$
begin
  insert into public.email_accounts
    (workspace_id, provider, scope, owner_user_id, display_name, from_email,
     from_domain, send_days)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'smtp', 'personal',
          '11111111-1111-1111-1111-111111111111', 'Day eight',
          'dayeight@acme.example', 'acme.example', '{8}');
  raise exception 'FAIL: weekday 8 was accepted';
exception
  when check_violation then
    raise notice 'PASS out-of-range weekday rejected';
end
$$;

do $$
begin
  insert into public.email_accounts
    (workspace_id, provider, scope, owner_user_id, display_name, from_email, from_domain)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'smtp', 'personal',
          '11111111-1111-1111-1111-111111111111', 'Shouty',
          'MixedCase@acme.example', 'acme.example');
  raise exception 'FAIL: a non-lowercased address was accepted';
exception
  when check_violation then
    raise notice 'PASS non-lowercased address rejected';
end
$$;

-- Deleting the account takes its secret with it. An orphaned envelope is a
-- credential nobody is watching.
delete from public.email_accounts where id = 'e0000000-0000-0000-0000-000000000001';

select 'CASCADE secret removed with its account' as check,
       count(*) = 0 as pass
from public.email_account_secrets;

rollback;
