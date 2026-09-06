-- Smoke test for 0089 — email templates (M6 Phase 16).
--
-- M6 ACCEPTANCE CRITERION 3: "editing a template never mutates previously sent
-- message history."
--
-- The point is that the guarantee is STRUCTURAL. Content is copied into the
-- message at queue time and frozen at send time, so there is no path by which
-- a template edit could reach a sent message — not a rule anyone has to obey.

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

select 'CRITERION 3: the sent message is unchanged by a template edit' as check,
       subject   = 'Quick question about Northwind' as subject_intact,
       body_text = 'Hi Dana — worth a chat?' as body_intact
from public.email_messages where idempotency_key = 'm-1';

-- Deleting the template must not delete or blank the history either.
delete from public.email_templates where id = '7e000000-0000-0000-0000-000000000001';

select 'DELETING the template leaves the sent message intact' as check,
       count(*) = 1 as pass
from public.email_messages
where idempotency_key = 'm-1'
  and subject = 'Quick question about Northwind'
  and template_id is null;   -- attribution is lost, the record is not

-- ---------------------------------------------------------------------------
-- And the message content itself remains frozen (0086's trigger still holds
-- with the new column in place).
-- ---------------------------------------------------------------------------

do $$
begin
  update public.email_messages
     set body_text = 'tampered'
   where idempotency_key = 'm-1';
  raise exception 'FAIL: a sent message body was rewritten';
exception
  when check_violation then
    raise notice 'PASS sent message content is still immutable';
end
$$;

rollback;
