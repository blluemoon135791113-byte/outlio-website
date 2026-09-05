-- 0089 — email templates (M6 Phase 16)
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  A TEMPLATE IS A SOURCE, NOT A LIVE REFERENCE.                           ║
-- ║                                                                           ║
-- ║  M6 criterion 3: "editing a template never mutates previously sent        ║
-- ║  message history."                                                        ║
-- ║                                                                           ║
-- ║  The guarantee comes from WHEN rendering happens, not from a rule someone ║
-- ║  has to remember. A template is rendered into `email_messages.subject` /  ║
-- ║  `body_text` at QUEUE time, and 0086's trigger freezes those columns once ║
-- ║  the message is sent. `email_messages` therefore has NO foreign key to a  ║
-- ║  template — deliberately. A join would make history depend on a mutable   ║
-- ║  row, and editing a typo three months later would silently rewrite what   ║
-- ║  every prospect was told.                                                 ║
-- ║                                                                           ║
-- ║  `template_id` below is recorded for REPORTING only ("which template      ║
-- ║  performed best"), and is nullable and `on delete set null`: deleting a   ║
-- ║  template must never delete the record of what was sent.                 ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.email_templates (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,

  name          text not null check (length(trim(name)) between 1 and 200),
  subject       text not null,
  body_text     text not null,
  body_html     text,

  /*
   * The variables this template uses, extracted at save time. Stored so the
   * enrollment screen can warn "12 of these 40 contacts have no job title"
   * BEFORE launching, rather than failing per-message at send time.
   */
  variables     text[] not null default '{}',

  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists email_templates_workspace_idx
  on public.email_templates (workspace_id, name)
  where deleted_at is null;

drop trigger if exists email_templates_set_updated_at on public.email_templates;
create trigger email_templates_set_updated_at
  before update on public.email_templates
  for each row execute function public.set_updated_at();

alter table public.email_templates enable row level security;

drop policy if exists email_templates_select_member on public.email_templates;
create policy email_templates_select_member on public.email_templates
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_admin());

revoke all on table public.email_templates from public, anon, authenticated;
grant select on table public.email_templates to authenticated;
grant select, insert, update, delete on table public.email_templates to service_role;

-- Reporting attribution only. See the banner: NOT a content reference.
alter table public.email_messages
  add column if not exists template_id uuid references public.email_templates(id) on delete set null;

alter table public.email_sequence_steps
  add column if not exists template_id uuid references public.email_templates(id) on delete set null;

create index if not exists email_messages_template_idx
  on public.email_messages (template_id)
  where template_id is not null;

comment on table public.email_templates is
  'Reusable message sources. Rendered into email_messages at QUEUE time and '
  'never joined at read time, so editing a template cannot rewrite what was '
  'already sent (M6 criterion 3).';

comment on column public.email_messages.template_id is
  'Attribution for reporting only. The message content is a frozen copy; this '
  'column must never be used to re-render or display a sent message.';
