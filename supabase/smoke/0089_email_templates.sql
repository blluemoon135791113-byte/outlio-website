-- Smoke test for 0089 — email templates (M6 Phase 16).
--
-- M6 ACCEPTANCE CRITERION 3: "editing a template never mutates previously sent
-- message history."
--
-- The point is that the guarantee is STRUCTURAL. Content is copied into the
-- message at queue time and frozen at send time, so there is no path by which
-- a template edit could reach a sent message — not a rule anyone has to obey.
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

insert into public.email_templates (id, workspace_id, name, subject, body_text, variables)
values ('7e000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'Opener v1', 'Quick question about {{company_name}}',
        'Hi {{first_name|there}} — worth a chat?', '{first_name,company_name}');

-- A message queued and sent from that template: content COPIED, not referenced.
insert into public.email_messages
  (workspace_id, account_id, template_id, to_email, subject, body_text,
   idempotency_key, status, sent_at)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','e0000000-0000-0000-0000-000000000001',
        '7e000000-0000-0000-0000-000000000001','dana@buyer.example',
        'Quick question about Northwind', 'Hi Dana — worth a chat?',
        'm-1','sent', now());

-- ---------------------------------------------------------------------------
-- CRITERION 3 — edit the template, then check the sent message.
-- ---------------------------------------------------------------------------

update public.email_templates
   set subject   = 'COMPLETELY REWRITTEN SUBJECT',
       body_text = 'Completely different body.'
 where id = '7e000000-0000-0000-0000-000000000001';

insert into smoke_checks (label, ok) values
  ('CRITERION 3: the sent subject is unchanged by a template edit',
   coalesce((select subject = 'Quick question about Northwind'
               from public.email_messages where idempotency_key = 'm-1'), false)),
  ('CRITERION 3: the sent body is unchanged by a template edit',
   coalesce((select body_text = 'Hi Dana — worth a chat?'
               from public.email_messages where idempotency_key = 'm-1'), false));

-- Deleting the template must not delete or blank the history either.
delete from public.email_templates where id = '7e000000-0000-0000-0000-000000000001';

insert into smoke_checks (label, ok)
select 'DELETING the template leaves the sent message intact', coalesce(count(*) = 1, false)
from public.email_messages
where idempotency_key = 'm-1'
  and subject = 'Quick question about Northwind'
  and template_id is null;   -- attribution is lost, the record is not

-- ---------------------------------------------------------------------------
-- And the message content itself remains frozen (0086's trigger still holds
-- with the new column in place).
-- ---------------------------------------------------------------------------

do $$
declare
  v_rejected boolean := false;
begin
  begin
    update public.email_messages
       set body_text = 'tampered'
     where idempotency_key = 'm-1';
  exception
    when check_violation then
      v_rejected := true;
  end;

  insert into smoke_checks (label, ok)
  values ('SENT message content is still immutable', v_rejected);
end
$$;

-- ---------------------------------------------------------------------------
-- The gate.
-- ---------------------------------------------------------------------------
select n, ok, label from smoke_checks order by n;

do $$
declare
  v_expected constant integer := 4;
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
